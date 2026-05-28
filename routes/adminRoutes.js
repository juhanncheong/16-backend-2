const express = require("express");
const User = require("../models/User");
const { protect, adminOnly } = require("../middleware/auth");
const bcrypt = require("bcryptjs");
const {
  resetUserOrders,
  setUserOrdersCount,
  setUserResetCount,
} = require("../controllers/adminOrdersController");

const adminWithdrawalsController = require("../controllers/adminWithdrawalsController");
const Withdrawal = require("../models/Withdrawal");
const VipConfig = require("../models/VipConfig");

const WalletTransaction = require("../models/WalletTransaction");
const mongoose = require("mongoose");
const {
  adminListDeposits,
  adminDepositRanks,
} = require("../controllers/adminDepositsController");
const SigninClaim = require("../models/SigninClaim");
const UserOrder = require("../models/UserOrder");
const SigninRewardRule = require("../models/SigninRewardRule");
const Content = require("../models/Content");
const AdminPopup = require("../models/AdminPopup");
const AdminPopupUserState = require("../models/AdminPopupUserState");
const TargetedBonusOffer = require("../models/TargetedBonusOffer");
const AdminEmailTemplate = require("../models/AdminEmailTemplate");
const AdminEmailLog = require("../models/AdminEmailLog");
const BonusOfferTemplate = require("../models/BonusOfferTemplate");

const {
  deleteEntrepreneurOfferAfterFirstDeposit,
} = require("../utils/entrepreneurBonusAutomation");

const router = express.Router();

const REFERRAL_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const ENTREPRENEUR_TEMPLATE_KEY = "entrepreneur_default";

const DEFAULT_ENTREPRENEUR_TEMPLATE = {
  key: ENTREPRENEUR_TEMPLATE_KEY,
  eventType: "entrepreneur",
  title: "Entrepreneur Application",
  description: "Pick a tier - Cash in - Get extra bonus.",
  options: [
    {
      tierTitle: "Beginner Entrepreneur",
      depositAmount: 200,
      bonusAmount: 30,
      isFull: false,
    },
    {
      tierTitle: "Advance Entrepreneur",
      depositAmount: 500,
      bonusAmount: 80,
      isFull: false,
    },
    {
      tierTitle: "Superior Entrepreneur",
      depositAmount: 1000,
      bonusAmount: 170,
      isFull: false,
    },
  ],
};

function cleanBonusTemplateOptions(options) {
  if (!Array.isArray(options) || options.length < 1) {
    throw new Error("At least one package option is required");
  }

  return options.map((item) => {
    const tierTitle = String(item.tierTitle || "").trim();
    const depositAmount = Number(item.depositAmount);
    const bonusAmount = Number(item.bonusAmount);

    if (!tierTitle) {
      throw new Error("Each entrepreneur package needs a title");
    }

    if (!Number.isFinite(depositAmount) || depositAmount <= 0) {
      throw new Error("Each deposit amount must be more than 0");
    }

    if (!Number.isFinite(bonusAmount) || bonusAmount < 0) {
      throw new Error("Each bonus amount must be 0 or more");
    }

    return {
      tierTitle,
      depositAmount,
      bonusAmount,
      isFull: Boolean(item.isFull),
    };
  });
}

async function getTrialBonusRemainingForUser(userId) {
  const rows = await WalletTransaction.aggregate([
    {
      $match: {
        userId: new mongoose.Types.ObjectId(userId),
        type: { $in: ["TRIAL_CREDIT", "TRIAL_REVERSAL"] },
      },
    },
    {
      $group: {
        _id: "$type",
        total: { $sum: "$amount" },
      },
    },
  ]);

  let credited = 0;
  let reversed = 0;

  for (const row of rows) {
    if (row._id === "TRIAL_CREDIT") {
      credited = Number(row.total || 0);
    }

    if (row._id === "TRIAL_REVERSAL") {
      reversed = Math.abs(Number(row.total || 0));
    }
  }

  return Math.max(0, credited - reversed);
}

async function emitUserWalletUpdate(req, userId) {
  try {
    const io = req.app.get("io");
    if (!io || !userId) return;

    const user = await User.findById(userId)
      .select("_id phoneNumber balance role")
      .lean();

    if (!user) return;

    const trialBonusRemaining = await getTrialBonusRemainingForUser(user._id);

    io.to(`user:${user._id.toString()}`).emit("user:wallet:update", {
      userId: user._id.toString(),
      phoneNumber: user.phoneNumber,
      balance: Number(user.balance || 0),
      availableBalance: Number(user.balance || 0),
      trialBonusRemaining: Number(trialBonusRemaining || 0),
      role: user.role,
    });
  } catch (socketErr) {
    console.error("user:wallet:update socket emit failed:", socketErr.message);
  }
}

function emitAdminUserBalanceUpdated(req, user) {
  try {
    const io = req.app.get("io");
    if (!io || !user) return;

    io.to("admins").emit("admin:userBalanceUpdated", {
      userId: user._id.toString(),
      user: {
        _id: user._id.toString(),
        uid: user.uid || "",
        phoneNumber: user.phoneNumber,
        balance: Number(user.balance || 0),
        displayBalance: Number(user.balance || 0),
        availableBalance: Number(user.balance || 0),
        role: user.role,
      },
    });
  } catch (socketErr) {
    console.error("admin:userBalanceUpdated socket emit failed:", socketErr.message);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableMongoTransactionError(err) {
  const labels = err?.errorLabels || [];

  return (
    labels.includes("TransientTransactionError") ||
    labels.includes("UnknownTransactionCommitResult") ||
    /Write conflict/i.test(err?.message || "") ||
    /Please retry/i.test(err?.message || "")
  );
}

async function runMongoTransactionWithRetry(work, maxAttempts = 3) {
  let lastErr;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const session = await mongoose.startSession();

    try {
      let result;

      await session.withTransaction(
        async () => {
          result = await work(session);
        },
        {
          readConcern: { level: "snapshot" },
          writeConcern: { w: "majority" },
        }
      );

      session.endSession();
      return result;
    } catch (err) {
      session.endSession();
      lastErr = err;

      if (!isRetryableMongoTransactionError(err) || attempt >= maxAttempts) {
        throw err;
      }

      console.warn(`Mongo transaction retry ${attempt}/${maxAttempts}:`, err.message);

      await sleep(80 * attempt);
    }
  }

  throw lastErr;
}

function generateReferralCode(length = 8) {
  let code = "";
  for (let i = 0; i < length; i++) {
    const idx = Math.floor(Math.random() * REFERRAL_CHARS.length);
    code += REFERRAL_CHARS[idx];
  }
  return code;
}

async function createUniqueReferralCode() {
  let code;
  let exists = true;

  while (exists) {
    code = generateReferralCode(8);
    exists = await User.findOne({ referralCode: code }).lean();
  }

  return code;
}

// ✅ Admin manually create user (no invitation code required)
router.post("/users", protect, adminOnly, async (req, res) => {
  try {
    const { phoneNumber, password, role } = req.body || {};

    if (!phoneNumber || !password) {
      return res.status(400).json({
        ok: false,
        message: "phoneNumber and password are required",
      });
    }

    const cleanPhone = String(phoneNumber).trim();

    if (cleanPhone.length < 3) {
      return res.status(400).json({
        ok: false,
        message: "Invalid phone number",
      });
    }

    if (String(password).length < 6) {
      return res.status(400).json({
        ok: false,
        message: "Password must be at least 6 characters",
      });
    }

    const exists = await User.findOne({ phoneNumber: cleanPhone }).lean();
    if (exists) {
      return res.status(409).json({
        ok: false,
        message: "Phone number already registered",
      });
    }

    const hashedPassword = await bcrypt.hash(String(password), 10);
    const referralCode = await createUniqueReferralCode();

    const user = await User.create({
      phoneNumber: cleanPhone,
      password: hashedPassword,
      referralCode,
      referredBy: null,
      referredByCode: null,
      role: role === "admin" ? "admin" : "user",
      registeredIp: "ADMIN_CREATED",
      registeredCountry: "ADMIN_CREATED",
    });

    const safeUser = await User.findById(user._id)
      .select("-password")
      .lean();

    // ✅ Socket: notify admin panel new user created by admin
    try {
      const io = req.app.get("io");
    
      io?.to("admins").emit("admin:userCreated", {
        user: {
          ...safeUser,
          balance: Number(safeUser.balance || 0),
          displayBalance: Number(safeUser.balance || 0),
          pendingAmount: 0,
          currentPendingOrder: null,
          referralCount: 0,
          availableBalance: Number(safeUser.balance || 0),
          referredBy: null,
        },
      });
    } catch (socketErr) {
      console.error("admin:userCreated socket emit failed:", socketErr.message);
    }

    return res.status(201).json({
      ok: true,
      message: "✅ User created successfully",
      user: safeUser,
    });
  } catch (err) {
    console.error("admin create user error:", err);
    return res.status(500).json({
      ok: false,
      message: err.message || "Server error",
    });
  }
});

// ✅ Get all users
router.get("/users", protect, async (req, res) => {
  try {
    const users = await User.find()
      .select("-password")
      .populate("referredBy", "phoneNumber referralCode")
      .sort({ createdAt: -1 })
      .lean();

    let config = await VipConfig.findOne().lean();
    if (!config) config = await VipConfig.create({});

    const ranks = Array.isArray(config.ranks) ? config.ranks : [];

    const userIds = users.map((u) => u._id);

    const counts = await User.aggregate([
      { $match: { referredBy: { $in: userIds } } },
      { $group: { _id: "$referredBy", count: { $sum: 1 } } },
    ]);

    const referralCountMap = new Map(
      counts.map((x) => [String(x._id), x.count])
    );

    const pendingOrders = await UserOrder.find({
      user: { $in: userIds },
      status: "PENDING",
    })
      .select("user status orderNumber orderName price commission isBonus createdAt")
      .sort({ createdAt: -1 })
      .lean();

    const pendingMap = new Map();
    for (const order of pendingOrders) {
      const key = String(order.user);
      if (!pendingMap.has(key)) {
        pendingMap.set(key, order);
      }
    }

    const enrichedUsers = users.map((u) => {
      const pending = pendingMap.get(String(u._id)) || null;

      const cleanBalance = Number(u.balance || 0);
      const availableBalance = cleanBalance;

      let displayBalance = cleanBalance;
      if (pending && pending.isBonus) {
        displayBalance = cleanBalance - Number(pending.price || 0);
      }

      const pendingAmount = pending
        ? (pending.isBonus
            ? Number(pending.price || 0) + Number(pending.commission || 0)
            : 0)
        : 0;

      const vipRank = Number(u.vipRank || 1);
      const vip = ranks.find((r) => Number(r.rank) === vipRank) || ranks[0];
      const derivedOrdersLimit = Number(vip?.ordersLimit || u.ordersLimit || 40);

      return {
        ...u,
        ordersLimit: derivedOrdersLimit,
        balance: cleanBalance,
        referralCount: referralCountMap.get(String(u._id)) || 0,
        currentPendingOrder: pending,
        availableBalance,
        displayBalance,
        pendingAmount,
      };
    });

    return res.json({ ok: true, users: enrichedUsers });
  } catch (err) {
    console.error("admin /users error:", err);
    return res.status(500).json({ ok: false, message: err.message });
  }
});

// ✅ Update user role
router.patch("/users/:id/role", protect, adminOnly, async (req, res) => {
  try {
    const { role } = req.body;

    if (!["user", "admin"].includes(role)) {
      return res.status(400).json({ ok: false, message: "Invalid role" });
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { role },
      { new: true }
    ).select("-password");

    if (!user) {
      return res.status(404).json({ ok: false, message: "User not found" });
    }

    return res.json({ ok: true, user });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message });
  }
});

// ✅ Update user balance
// mode: "set" -> balance = amount
// mode: "inc" -> balance += amount
// mode: "dec" -> balance -= amount
router.patch("/users/:id/balance", protect, adminOnly, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const rawMode = String(req.body.mode || "").trim().toLowerCase();
    const num = Number(req.body.amount);
    const note = String(req.body.note || "").trim();

    const modeMap = {
      set: "set",

      inc: "inc",
      add: "inc",
      deposit: "inc",
      increase: "inc",

      dec: "dec",
      deduct: "dec",
      subtract: "dec",
      decrease: "dec",
    };

    const mode = modeMap[rawMode];

    if (!["set", "inc", "dec"].includes(mode)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ ok: false, message: "Invalid mode" });
    }

    if (!Number.isFinite(num) || num <= 0) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ ok: false, message: "Invalid amount" });
    }

    const user = await User.findById(req.params.id).session(session);

    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ ok: false, message: "User not found" });
    }

    const before = Number(user.balance || 0);
    let after = before;

    if (mode === "set") {
      after = num;
    }

    if (mode === "inc") {
      after = before + num;
    }

    if (mode === "dec") {
      after = before - num;
    }

    user.balance = after;
    await user.save({ session });

    let txType = "ADMIN_ADJUST";

    if (mode === "inc") {
      txType = "DEPOSIT";
    }

    const txAmount = mode === "dec" ? -num : mode === "set" ? after - before : num;

    await WalletTransaction.create(
      [
        {
          userId: user._id,
          type: txType,
          amount: txAmount,
          balanceBefore: before,
          balanceAfter: after,
          note:
            note ||
            (mode === "dec"
              ? "Admin deducted balance"
              : mode === "set"
              ? "Admin set balance"
              : "Admin added balance"),
          relatedOrderId: null,
        },
      ],
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    // ✅ Auto-delete entrepreneur event only after user's FIRST EVER deposit
    let entrepreneurBonusDeleteResult = null;
    
    if (txType === "DEPOSIT" && txAmount > 0) {
      try {
        entrepreneurBonusDeleteResult = await deleteEntrepreneurOfferAfterFirstDeposit({
          userId: user._id,
        });
      } catch (bonusErr) {
        console.error("entrepreneur bonus auto-delete error:", bonusErr);
      }
    }

    try {
      const io = req.app.get("io");

      io?.to("admins").emit("admin:userBalanceUpdated", {
        userId: user._id,
        user: {
          _id: user._id,
          phoneNumber: user.phoneNumber,
          balance: Number(user.balance || 0),
          displayBalance: Number(user.balance || 0),
          availableBalance: Number(user.balance || 0),
          role: user.role,
        },
      });
    } catch (socketErr) {
      console.error("admin:userBalanceUpdated socket emit failed:", socketErr.message);
    }

    await emitUserWalletUpdate(req, user._id);

    return res.json({
      ok: true,
      message: "✅ Balance updated + transaction recorded",
      user: {
        _id: user._id,
        phoneNumber: user.phoneNumber,
        balance: user.balance,
        displayBalance: Number(user.balance || 0),
        availableBalance: Number(user.balance || 0),
        role: user.role,
      },
      entrepreneurBonusDelete: entrepreneurBonusDeleteResult,
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    return res.status(500).json({ ok: false, message: err.message });
  }
});

router.get("/deposits/ranks", protect, adminOnly, adminDepositRanks);
router.get("/deposits", protect, adminOnly, adminListDeposits);

// ✅ Admin give trial bonus (virtual, non-withdrawable)
router.post("/users/:id/trial-credit", protect, adminOnly, async (req, res) => {
  try {
    const userId = req.params.id;
    const amount = Number(req.body.amount || 0);
    const note = String(req.body.note || "Trial bonus");

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({
        ok: false,
        message: "amount must be a positive number",
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ ok: false, message: "User not found" });
    }

    // ❌ Prevent giving trial twice
    const existing = await WalletTransaction.findOne({
      userId: user._id,
      type: "TRIAL_CREDIT",
    });

    if (existing) {
      return res.status(409).json({
        ok: false,
        message: "Trial bonus already granted to this user",
      });
    }

    await WalletTransaction.create({
      userId: user._id,
      type: "TRIAL_CREDIT",
      amount,
      balanceBefore: user.balance,
      balanceAfter: user.balance,
      note,
    });

    await emitUserWalletUpdate(req, user._id);

    return res.json({
      ok: true,
      message: "✅ Trial bonus granted",
      userId: user._id,
      trialAmount: amount,
    });
  } catch (err) {
    console.error("admin trial-credit error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

// ✅ Admin revoke trial bonus (remove remaining virtual trial credit)
router.post("/users/:id/trial-revoke", protect, adminOnly, async (req, res) => {
  try {
    const userId = req.params.id;
    const note = String(req.body.note || "Admin revoked trial bonus");

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ ok: false, message: "User not found" });

    // Total trial credited
    const creditAgg = await WalletTransaction.aggregate([
      {
        $match: {
          userId: new mongoose.Types.ObjectId(user._id),
          type: "TRIAL_CREDIT",
        },
      },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);

    const credited = Number(creditAgg[0]?.total || 0);

    // Total already reversed (stored as negative numbers)
    const revAgg = await WalletTransaction.aggregate([
      {
        $match: {
          userId: new mongoose.Types.ObjectId(user._id),
          type: "TRIAL_REVERSAL",
        },
      },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);

    const reversedAbs = Math.abs(Number(revAgg[0]?.total || 0));

    const remaining = Math.max(0, credited - reversedAbs);

    if (remaining <= 0) {
      return res.json({
        ok: true,
        message: "No remaining trial bonus to revoke",
        credited,
        reversed: reversedAbs,
        remaining: 0,
      });
    }

    await WalletTransaction.create({
      userId: user._id,
      type: "TRIAL_REVERSAL",
      amount: -remaining,
      balanceBefore: user.balance,
      balanceAfter: user.balance,
      note,
    });

    await emitUserWalletUpdate(req, user._id);

    return res.json({
      ok: true,
      message: "✅ Trial bonus revoked",
      credited,
      reversed: reversedAbs + remaining,
      remaining: 0,
      revokedAmount: remaining,
    });
  } catch (err) {
    console.error("admin trial-revoke error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

// ✅ Deposit withdrawal total per user
router.get("/users/:id/wallet-summary", protect, adminOnly, async (req, res) => {
  try {
    const userId = req.params.id;

    const user = await User.findById(userId).select("_id phoneNumber balance");
    if (!user) {
      return res.status(404).json({ ok: false, message: "User not found" });
    }

    const [depositAgg, withdrawalAgg] = await Promise.all([
      WalletTransaction.aggregate([
        {
          $match: {
            userId: new mongoose.Types.ObjectId(userId),
            type: "DEPOSIT",
          },
        },
        {
          $group: {
            _id: null,
            totalDeposit: { $sum: "$amount" },
            depositCount: { $sum: 1 },
          },
        },
      ]),
      Withdrawal.aggregate([
        {
          $match: {
            user: new mongoose.Types.ObjectId(userId),
            status: "APPROVED",
          },
        },
        {
          $group: {
            _id: null,
            totalWithdrawal: { $sum: "$amount" },
            withdrawalCount: { $sum: 1 },
          },
        },
      ]),
    ]);

    return res.json({
      ok: true,
      user: {
        _id: user._id,
        phoneNumber: user.phoneNumber,
        balance: Number(user.balance || 0),
      },
      summary: {
        totalDeposit: Number(depositAgg[0]?.totalDeposit || 0),
        depositCount: Number(depositAgg[0]?.depositCount || 0),
        totalWithdrawal: Number(withdrawalAgg[0]?.totalWithdrawal || 0),
        withdrawalCount: Number(withdrawalAgg[0]?.withdrawalCount || 0),
      },
    });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message });
  }
});

router.get("/trial-users", protect, adminOnly, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.max(1, parseInt(req.query.limit || "10", 10));
    const q = String(req.query.q || "").trim();

    const skip = (page - 1) * limit;

    const userMatch = {};
    if (q) {
      userMatch.$or = [
        { uid: { $regex: q, $options: "i" } },
        { phoneNumber: { $regex: q, $options: "i" } },
      ];
    }

    const pipeline = [
      {
        $match: {
          type: { $in: ["TRIAL_CREDIT", "TRIAL_REVERSAL"] },
        },
      },
      {
        $group: {
          _id: "$userId",
          creditedRaw: {
            $sum: {
              $cond: [{ $eq: ["$type", "TRIAL_CREDIT"] }, "$amount", 0],
            },
          },
          reversedRaw: {
            $sum: {
              $cond: [{ $eq: ["$type", "TRIAL_REVERSAL"] }, "$amount", 0],
            },
          },
          lastCreditAt: {
            $max: {
              $cond: [{ $eq: ["$type", "TRIAL_CREDIT"] }, "$createdAt", null],
            },
          },
          lastReversalAt: {
            $max: {
              $cond: [{ $eq: ["$type", "TRIAL_REVERSAL"] }, "$createdAt", null],
            },
          },
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "user",
        },
      },
      { $unwind: "$user" },
      ...(q ? [{ $match: userMatch }] : []),
      {
        $project: {
          _id: 0,
          userId: "$user._id",
          uid: { $ifNull: ["$user.uid", "-"] },
          phoneNumber: { $ifNull: ["$user.phoneNumber", "-"] },
          credited: { $ifNull: ["$creditedRaw", 0] },
          reversed: { $abs: { $ifNull: ["$reversedRaw", 0] } },
          remaining: {
            $max: [
              0,
              {
                $subtract: [
                  { $ifNull: ["$creditedRaw", 0] },
                  { $abs: { $ifNull: ["$reversedRaw", 0] } },
                ],
              },
            ],
          },
          lastCreditAt: 1,
          lastReversalAt: 1,
          hasTrial: {
            $gt: [{ $ifNull: ["$creditedRaw", 0] }, 0],
          },
          isFullyRevoked: {
            $and: [
              { $gt: [{ $ifNull: ["$creditedRaw", 0] }, 0] },
              {
                $lte: [
                  {
                    $max: [
                      0,
                      {
                        $subtract: [
                          { $ifNull: ["$creditedRaw", 0] },
                          { $abs: { $ifNull: ["$reversedRaw", 0] } },
                        ],
                      },
                    ],
                  },
                  0,
                ],
              },
            ],
          },
        },
      },
      { $sort: { lastCreditAt: -1, lastReversalAt: -1, uid: 1 } },
    ];

    const countPipeline = [...pipeline, { $count: "total" }];
    const rowsPipeline = [...pipeline, { $skip: skip }, { $limit: limit }];

    const [rows, countResult] = await Promise.all([
      WalletTransaction.aggregate(rowsPipeline),
      WalletTransaction.aggregate(countPipeline),
    ]);

    const total = Number(countResult[0]?.total || 0);

    return res.json({
      ok: true,
      rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (err) {
    console.error("trial-users error:", err);
    return res.status(500).json({
      ok: false,
      message: err.message || "Server error",
    });
  }
});

// ✅ Admin trial summary (credited / reversed / remaining)
router.get("/users/:id/trial-summary", protect, adminOnly, async (req, res) => {
  try {
    const userId = req.params.id;

    const user = await User.findById(userId).select("_id phoneNumber balance");
    if (!user) return res.status(404).json({ ok: false, message: "User not found" });

    // Total trial credited
    const creditAgg = await WalletTransaction.aggregate([
      {
        $match: {
          userId: new mongoose.Types.ObjectId(user._id),
          type: "TRIAL_CREDIT",
        },
      },
      { $group: { _id: null, total: { $sum: "$amount" }, lastAt: { $max: "$createdAt" } } },
    ]);

    const credited = Number(creditAgg[0]?.total || 0);
    const lastCreditAt = creditAgg[0]?.lastAt || null;

    // Total already reversed (stored as negative)
    const revAgg = await WalletTransaction.aggregate([
      {
        $match: {
          userId: new mongoose.Types.ObjectId(user._id),
          type: "TRIAL_REVERSAL",
        },
      },
      { $group: { _id: null, total: { $sum: "$amount" }, lastAt: { $max: "$createdAt" } } },
    ]);

    const reversedAbs = Math.abs(Number(revAgg[0]?.total || 0));
    const lastReversalAt = revAgg[0]?.lastAt || null;

    const remaining = Math.max(0, credited - reversedAbs);

    return res.json({
      ok: true,
      userId: user._id,
      phoneNumber: user.phoneNumber,
      credited,
      reversed: reversedAbs,
      remaining,
      lastCreditAt,
      lastReversalAt,
      hasTrial: credited > 0,
      isFullyRevoked: remaining <= 0 && credited > 0,
    });
  } catch (err) {
    console.error("admin trial-summary error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

// Delete user
router.delete("/users/:id", protect, adminOnly, async (req, res) => {
  try {
    // prevent deleting yourself
    if (req.user.userId === req.params.id) {
      return res.status(400).json({ ok: false, message: "You cannot delete yourself" });
    }

    const user = await User.findByIdAndDelete(req.params.id);

    if (!user) return res.status(404).json({ ok: false, message: "User not found" });

    return res.json({ ok: true, message: "✅ User deleted" });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message });
  }
});

// ✅ Admin update user credit score
router.patch("/users/:id/credit-score", protect, adminOnly, async (req, res) => {
  try {
    const score = Number(req.body.creditScore);

    if (!Number.isFinite(score)) {
      return res.status(400).json({
        ok: false,
        message: "creditScore must be a number",
      });
    }

    if (score < 0 || score > 100) {
      return res.status(400).json({
        ok: false,
        message: "creditScore must be between 0 and 100",
      });
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      {
        creditScore: score,
      },
      {
        new: true,
        runValidators: true,
      }
    ).select("-password");

    if (!user) {
      return res.status(404).json({
        ok: false,
        message: "User not found",
      });
    }

    return res.json({
      ok: true,
      message: "✅ Credit score updated successfully",
      user,
    });
  } catch (err) {
    console.error("admin credit-score error:", err);
    return res.status(500).json({
      ok: false,
      message: err.message || "Server error",
    });
  }
});

router.patch("/users/:id/withdrawal-block", protect, adminOnly, async (req, res) => {
  try {
    const { blocked, reason } = req.body;

    const user = await User.findById(req.params.id).select("-password");
    if (!user) {
      return res.status(404).json({ ok: false, message: "User not found" });
    }

    user.withdrawalBlocked = Boolean(blocked);
    user.withdrawalBlockedAt = blocked ? new Date() : null;
    user.withdrawalBlockedReason = blocked ? String(reason || "").trim() : "";
    user.withdrawalBlockedBy = blocked ? req.user.userId : null;

    await user.save();

    return res.json({
      ok: true,
      message: blocked
        ? "✅ Withdrawal blocked successfully"
        : "✅ Withdrawal unblocked successfully",
      user,
    });
  } catch (err) {
    console.error("admin withdrawal-block error:", err);
    return res.status(500).json({ ok: false, message: err.message || "Server error" });
  }
});

// ✅ Admin block/unblock user from starting orders only
router.patch("/users/:id/order-start-block", protect, adminOnly, async (req, res) => {
  try {
    const { blocked, message } = req.body;

    // prevent blocking yourself
    if (req.user.userId === req.params.id) {
      return res.status(400).json({
        ok: false,
        message: "You cannot block yourself from starting orders",
      });
    }

    const isBlocked = Boolean(blocked);

    const user = await User.findById(req.params.id).select("-password");
    if (!user) {
      return res.status(404).json({
        ok: false,
        message: "User not found",
      });
    }

    user.orderStartBlocked = isBlocked;
    user.orderStartBlockMessage = isBlocked
      ? String(message || "Your account is temporarily unable to start orders. Please contact customer service.").trim()
      : "";
    user.orderStartBlockedAt = isBlocked ? new Date() : null;
    user.orderStartBlockedBy = isBlocked ? req.user.userId : null;

    await user.save();

    return res.json({
      ok: true,
      message: isBlocked
        ? "✅ User blocked from starting orders"
        : "✅ User unblocked from starting orders",
      user,
    });
  } catch (err) {
    console.error("admin order-start-block error:", err);
    return res.status(500).json({
      ok: false,
      message: err.message || "Server error",
    });
  }
});

// Ban or unban user
router.patch("/users/:id/ban", protect, adminOnly, async (req, res) => {
  try {
    const { isBanned, reason } = req.body;

    // prevent banning yourself
    if (req.user.userId === req.params.id) {
      return res.status(400).json({ ok: false, message: "You cannot ban yourself" });
    }

    const update = {
      isBanned: Boolean(isBanned),
      bannedAt: isBanned ? new Date() : null,
      banReason: isBanned ? String(reason || "") : "",
    };

    const user = await User.findByIdAndUpdate(req.params.id, update, { new: true })
      .select("-password");

    if (!user) return res.status(404).json({ ok: false, message: "User not found" });

    return res.json({ ok: true, message: "✅ Ban status updated", user });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message });
  }
});

// Reset user password
router.patch("/users/:id/reset-password", protect, adminOnly, async (req, res) => {
  try {
    const { newPassword } = req.body;

    if (!newPassword || String(newPassword).length < 6) {
      return res.status(400).json({
        ok: false,
        message: "newPassword is required (min 6 characters)",
      });
    }

    const hashedPassword = await bcrypt.hash(String(newPassword), 10);

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { password: hashedPassword },
      { new: true }
    ).select("-password");

    if (!user) return res.status(404).json({ ok: false, message: "User not found" });

    return res.json({ ok: true, message: "✅ Password reset successful", user });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message });
  }
});

// Reset user phone number
router.patch("/users/:id/reset-phone", protect, adminOnly, async (req, res) => {
  try {
    const { newPhoneNumber } = req.body;

    if (!newPhoneNumber || String(newPhoneNumber).trim().length < 3) {
      return res.status(400).json({
        ok: false,
        message: "newPhoneNumber is required",
      });
    }

    const cleanPhone = String(newPhoneNumber).trim();

    // check duplicate phone number
    const exists = await User.findOne({ phoneNumber: cleanPhone });
    if (exists) {
      return res.status(400).json({
        ok: false,
        message: "Phone number already exists",
      });
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { phoneNumber: cleanPhone },
      { new: true }
    ).select("-password");

    if (!user) return res.status(404).json({ ok: false, message: "User not found" });

    return res.json({ ok: true, message: "✅ Phone number updated", user });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message });
  }
});

/**
 * ============================
 * ✅ ADMIN ORDER COUNT CONTROL
 * ============================
 */

// ✅ Reset user order count to 0 (button)
router.post("/users/:userId/orders/reset", protect, adminOnly, resetUserOrders);

// ✅ Set user order count (input)
router.patch("/users/:userId/orders/set", protect, adminOnly, setUserOrdersCount);
router.patch("/users/:userId/reset-count/set", protect, adminOnly, setUserResetCount);


/**
 * ============================
 * ✅ WITHDRAWALS
 * ============================
 */

router.get("/withdrawals", protect, adminOnly, adminWithdrawalsController.adminListWithdrawals);
router.put("/withdrawals/:id/approve", protect, adminOnly, adminWithdrawalsController.adminApproveWithdrawal);
router.put("/withdrawals/:id/reject", protect, adminOnly, adminWithdrawalsController.adminRejectWithdrawal);

router.patch(
  "/withdrawals/:id/progress",
  protect,
  adminOnly,
  adminWithdrawalsController.adminUpdateWithdrawalProgress
);

router.get(
  "/withdrawal-methods",
  protect,
  adminOnly,
  adminWithdrawalsController.adminListWithdrawalMethodConfigs
);

router.patch(
  "/withdrawal-methods/:method",
  protect,
  adminOnly,
  adminWithdrawalsController.adminToggleWithdrawalMethod
);

router.get(
  "/recent-withdrawal-addresses",
  protect,
  adminOnly,
  adminWithdrawalsController.adminListRecentWithdrawalAddresses
);

router.patch(
  "/recent-withdrawal-addresses/:id",
  protect,
  adminOnly,
  adminWithdrawalsController.adminUpdateRecentWithdrawalAddress
);

router.delete(
  "/recent-withdrawal-addresses/:id",
  protect,
  adminOnly,
  adminWithdrawalsController.adminDeleteRecentWithdrawalAddress
);

router.patch(
  "/users/:id/withdraw-pin/reset",
  protect,
  adminOnly,
  adminWithdrawalsController.adminResetUserWithdrawPin
);

/**
 * ============================
 * ✅ SIGN-IN REWARDS (ADMIN)
 * ============================
 */

const ET_ZONE = "America/New_York";

// Helper: ensure YYYY-MM-DD format
function isValidDateStr(dateStr) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ""));
}

// ✅ Admin view claim records
// GET /admin/signin/claims?userId=&from=YYYY-MM-DD&to=YYYY-MM-DD
router.get("/signin/claims", protect, adminOnly, async (req, res) => {
  try {
    const { userId, from, to } = req.query;

    const filter = {};

    if (userId) filter.userId = userId;

    // localDate here is ET day string YYYY-MM-DD
    if (from && isValidDateStr(from)) {
      filter.localDate = { ...(filter.localDate || {}), $gte: from };
    }
    if (to && isValidDateStr(to)) {
      filter.localDate = { ...(filter.localDate || {}), $lte: to };
    }

    const claims = await SigninClaim.find(filter)
      .populate("userId", "phoneNumber balance role")
      .sort({ createdAt: -1 })
      .limit(300)
      .lean();

    return res.json({
      ok: true,
      timezone: ET_ZONE,
      total: claims.length,
      claims,
    });
  } catch (err) {
    console.error("Admin signin claims error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

// ✅ Admin summary
// GET /admin/signin/summary?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get("/signin/summary", protect, adminOnly, async (req, res) => {
  try {
    const { from, to } = req.query;

    const match = {};

    if (from && isValidDateStr(from)) {
      match.localDate = { ...(match.localDate || {}), $gte: from };
    }
    if (to && isValidDateStr(to)) {
      match.localDate = { ...(match.localDate || {}), $lte: to };
    }

    const result = await SigninClaim.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalClaims: { $sum: 1 },
          uniqueUsers: { $addToSet: "$userId" },
          totalRewardAmount: { $sum: "$rewardAmount" },
        },
      },
      {
        $project: {
          _id: 0,
          totalClaims: 1,
          uniqueUsers: { $size: "$uniqueUsers" },
          totalRewardAmount: 1,
        },
      },
    ]);

    return res.json({
      ok: true,
      timezone: ET_ZONE,
      summary: result[0] || { totalClaims: 0, uniqueUsers: 0, totalRewardAmount: 0 },
    });
  } catch (err) {
    console.error("Admin signin summary error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

// ✅ Admin check if a user claimed TODAY (ET)
// GET /admin/signin/user/:id/today
router.get("/signin/user/:id/today", protect, adminOnly, async (req, res) => {
  try {
    const userId = req.params.id;

    const etDate = DateTime.now().setZone(ET_ZONE).toFormat("yyyy-MM-dd");

    const claim = await SigninClaim.findOne({ userId, localDate: etDate }).lean();

    return res.json({
      ok: true,
      timezone: ET_ZONE,
      etDate,
      claimedToday: !!claim,
      claim: claim || null,
    });
  } catch (err) {
    console.error("Admin signin user today error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

// ✅ Admin calculate how many completed orders user did TODAY (ET)
// GET /admin/signin/user/:id/orders-today
router.get("/signin/user/:id/orders-today", protect, adminOnly, async (req, res) => {
  try {
    const userId = req.params.id;

    const etDate = DateTime.now().setZone(ET_ZONE).toFormat("yyyy-MM-dd");

    const startET = DateTime.fromFormat(etDate, "yyyy-MM-dd", { zone: ET_ZONE }).startOf("day");
    const endET = startET.plus({ days: 1 });

    const startUTC = startET.toUTC().toJSDate();
    const endUTC = endET.toUTC().toJSDate();

    const completedOrders = await UserOrder.countDocuments({
      user: userId,
      status: "COMPLETED",
      completedAt: { $gte: startUTC, $lt: endUTC },
    });

    return res.json({
      ok: true,
      timezone: ET_ZONE,
      etDate,
      completedOrders,
    });
  } catch (err) {
    console.error("Admin orders today error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

// ✅ Get current reward config
// GET /api/admin/signin/rewards-config
router.get("/signin/rewards-config", protect, adminOnly, async (req, res) => {
  try {
    let rule = await SigninRewardRule.findOne({ isActive: true }).lean();

    // if missing, create default
    if (!rule) {
      rule = await SigninRewardRule.create({
        dayRewards: [300, 0, 0, 0, 0, 0],
        isActive: true,
      });
    }

    return res.json({ ok: true, rule });
  } catch (err) {
    console.error("Admin get rewards-config error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

// ✅ Update reward config
// PUT /api/admin/signin/rewards-config
router.put("/signin/rewards-config", protect, adminOnly, async (req, res) => {
  try {
    const incoming = req.body?.dayRewards;

    if (!Array.isArray(incoming) || incoming.length !== 6) {
      return res.status(400).json({
        ok: false,
        message: "dayRewards must be an array of 6 numbers (Day1..Day6)",
      });
    }

    const cleaned = incoming.map((x) => {
      const n = Number(x);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    });

    let rule = await SigninRewardRule.findOne({ isActive: true });

    if (!rule) {
      rule = await SigninRewardRule.create({ dayRewards: cleaned, isActive: true });
    } else {
      rule.dayRewards = cleaned;
      await rule.save();
    }

    return res.json({ ok: true, message: "✅ Rewards updated", rule });
  } catch (err) {
    console.error("Admin update rewards-config error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

router.get("/vip/config", protect, adminOnly, async (req, res) => {
  try {
    let config = await VipConfig.findOne();

    if (!config) {
      config = await VipConfig.create({});
    }

    config = normalizeVipConfig(config);

    await config.save();

    return res.json({
      ok: true,
      config,
    });
  } catch (err) {
    console.error("Get VIP config error:", err);
    return res.status(500).json({
      ok: false,
      message: "Server error",
    });
  }
});

router.put("/vip/config", protect, adminOnly, async (req, res) => {
  try {
    const { ranks, bonusCommissionRate } = req.body;

    const cleanBonusCommissionRate = Number(bonusCommissionRate);

    if (
      !Number.isFinite(cleanBonusCommissionRate) ||
      cleanBonusCommissionRate < 0
    ) {
      return res.status(400).json({
        ok: false,
        message: "Invalid bonusCommissionRate",
      });
    }

    if (!Array.isArray(ranks) || ranks.length !== 3) {
      return res.status(400).json({
        ok: false,
        message: "ranks must be an array of 3 items (rank 1..3)",
      });
    }

    const cleaned = ranks
      .map((r) => {
        const rank = Number(r.rank);
        const ordersLimit = Number(r.ordersLimit);
        const commissionRate = Number(r.commissionRate);
        const depositRequirement = Number(r.depositRequirement);

        if (![1, 2, 3].includes(rank)) {
          throw new Error("Invalid rank");
        }

        if (!Number.isFinite(ordersLimit) || ordersLimit < 1) {
          throw new Error("Invalid ordersLimit");
        }

        if (!Number.isFinite(commissionRate) || commissionRate < 0) {
          throw new Error("Invalid commissionRate");
        }

        if (!Number.isFinite(depositRequirement) || depositRequirement < 0) {
          throw new Error("Invalid depositRequirement");
        }

        return {
          rank,
          ordersLimit,
          commissionRate,
          depositRequirement,
        };
      })
      .sort((a, b) => a.rank - b.rank);

    let config = await VipConfig.findOne();

    if (!config) {
      config = await VipConfig.create({
        bonusCommissionRate: cleanBonusCommissionRate,
        ranks: cleaned,
      });
    } else {
      config.bonusCommissionRate = cleanBonusCommissionRate;
      config.ranks = cleaned;
      await config.save();
    }

    return res.json({
      ok: true,
      message: "✅ VIP config updated",
      config,
    });
  } catch (err) {
    console.error("Update VIP config error:", err);
    return res.status(500).json({
      ok: false,
      message: err.message || "Server error",
    });
  }
});

function normalizeVipConfig(config) {
  const defaultRanks = [
    { rank: 1, ordersLimit: 40, commissionRate: 0.01, depositRequirement: 50 },
    { rank: 2, ordersLimit: 60, commissionRate: 0.015, depositRequirement: 500 },
    { rank: 3, ordersLimit: 80, commissionRate: 0.02, depositRequirement: 5000 },
  ];

  const existingRanks = Array.isArray(config.ranks) ? config.ranks : [];

  config.ranks = defaultRanks.map((def) => {
    const found = existingRanks.find((r) => Number(r.rank) === def.rank);

    return {
      rank: def.rank,
      ordersLimit: Number(found?.ordersLimit ?? def.ordersLimit),
      commissionRate: Number(found?.commissionRate ?? def.commissionRate),
      depositRequirement: Number(
        found?.depositRequirement ?? def.depositRequirement
      ),
    };
  });

  return config;
}

router.patch("/users/:id/vip-rank", protect, adminOnly, async (req, res) => {
  try {
    const rank = Number(req.body.vipRank);

    if (![1, 2, 3].includes(rank)) {
      return res.status(400).json({ ok: false, message: "vipRank must be 1,2,3" });
    }

    let config = await VipConfig.findOne().lean();
    if (!config) config = await VipConfig.create({});

    const vip = config.ranks.find((r) => r.rank === rank) || config.ranks[0];

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { vipRank: rank, ordersLimit: vip.ordersLimit },
      { new: true }
    ).select("-password");

    if (!user) return res.status(404).json({ ok: false, message: "User not found" });

    return res.json({ ok: true, message: "✅ VIP rank updated", user });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message });
  }
});

/**
 * ============================
 * ✅ CONTENT MANAGEMENT
 * ============================
 */

// GET /api/admin/content/:key
router.get("/content/:key", protect, adminOnly, async (req, res) => {
  try {
    const key = String(req.params.key || "").trim().toLowerCase();

    const allowedKeys = ["terms", "privacy-security", "platform-rules"];
    if (!allowedKeys.includes(key)) {
      return res.status(404).json({ ok: false, message: "Content not found" });
    }

    let content = await Content.findOne({ key }).lean();

    // optional auto-create empty doc
    if (!content) {
      const defaultTitleMap = {
        terms: "Terms & Conditions",
        "privacy-security": "Privacy & Security",
        "platform-rules": "Platform Rules",
      };

      const created = await Content.create({
        key,
        title: defaultTitleMap[key] || "Content",
        summary: "",
        version: "v1.0",
        lastUpdated: null,
        sections: [],
        isPublished: true,
      });

      content = created.toObject();
    }

    return res.json({
      ok: true,
      content: {
        key: content.key,
        title: content.title,
        summary: content.summary,
        version: content.version,
        lastUpdated: content.lastUpdated || null,
        isPublished: content.isPublished,
        updatedAt: content.lastUpdated || content.updatedAt,
        sections: content.sections || [],
      },
    });
  } catch (err) {
    console.error("Admin get content error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

// PUT /api/admin/content/:key
router.put("/content/:key", protect, adminOnly, async (req, res) => {
  try {
    const key = String(req.params.key || "").trim().toLowerCase();

    const allowedKeys = ["terms", "privacy-security", "platform-rules"];
    if (!allowedKeys.includes(key)) {
      return res.status(404).json({ ok: false, message: "Content not found" });
    }

    const {
      title,
      summary,
      version,
      lastUpdated,
      sections,
      isPublished,
    } = req.body || {};

    if (!title || !String(title).trim()) {
      return res.status(400).json({
        ok: false,
        message: "title is required",
      });
    }

    let parsedLastUpdated = null;
    if (lastUpdated) {
      const dt = new Date(lastUpdated);
      if (Number.isNaN(dt.getTime())) {
        return res.status(400).json({
          ok: false,
          message: "lastUpdated must be a valid date",
        });
      }
      parsedLastUpdated = dt;
    }

    const cleanedSections = Array.isArray(sections)
      ? sections.map((section) => ({
          heading: String(section?.heading || "").trim(),
          paragraphs: Array.isArray(section?.paragraphs)
            ? section.paragraphs
                .map((p) => String(p || "").trim())
                .filter(Boolean)
            : [],
        }))
      : [];

    const updated = await Content.findOneAndUpdate(
      { key },
      {
        key,
        title: String(title).trim(),
        summary: String(summary || "").trim(),
        version: String(version || "v1.0").trim(),
        lastUpdated: parsedLastUpdated,
        sections: cleanedSections,
        isPublished: typeof isPublished === "boolean" ? isPublished : true,
      },
      {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
      }
    ).lean();

    return res.json({
      ok: true,
      message: "✅ Content updated",
      content: {
        key: updated.key,
        title: updated.title,
        summary: updated.summary,
        version: updated.version,
        lastUpdated: updated.lastUpdated || null,
        isPublished: updated.isPublished,
        updatedAt: updated.lastUpdated || updated.updatedAt,
        sections: updated.sections || [],
      },
    });
  } catch (err) {
    console.error("Admin update content error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

router.post("/users/:id/bonus", protect, adminOnly, async (req, res) => {
  try {
    const amount = Number(req.body.amount);
    const note = String(req.body.note || "Admin bonus").trim();

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({
        ok: false,
        message: "amount must be a positive number",
      });
    }

    const result = await runMongoTransactionWithRetry(async (session) => {
      const user = await User.findById(req.params.id).session(session);

      if (!user) {
        const err = new Error("User not found");
        err.statusCode = 404;
        throw err;
      }

      const before = Number(user.balance || 0);
      const after = before + amount;

      user.balance = after;
      await user.save({ session });

      await WalletTransaction.create(
        [
          {
            userId: user._id,
            type: "BONUS",
            amount,
            balanceBefore: before,
            balanceAfter: after,
            note,
            relatedOrderId: null,
          },
        ],
        { session }
      );

      return {
        userId: user._id,
        user: {
          _id: user._id,
          uid: user.uid,
          phoneNumber: user.phoneNumber,
          balance: user.balance,
          role: user.role,
        },
      };
    });

    emitAdminUserBalanceUpdated(req, result.user);
    await emitUserWalletUpdate(req, result.userId);

    return res.json({
      ok: true,
      message: "✅ Bonus added successfully",
      transactionType: "BONUS",
      user: result.user,
    });
  } catch (err) {
    console.error("admin bonus error:", err);

    return res.status(err.statusCode || 500).json({
      ok: false,
      message: err.message || "Server error",
    });
  }
});

router.get("/users/:id/bonus-history", protect, adminOnly, async (req, res) => {
  try {
    const userId = req.params.id;
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.max(1, parseInt(req.query.limit || "10", 10));
    const q = String(req.query.q || "").trim();

    const filter = {
      userId,
      type: "BONUS",
    };

    if (q) {
      filter.$or = [
        { note: { $regex: q, $options: "i" } },
      ];
    }

    const skip = (page - 1) * limit;

    const [rows, total] = await Promise.all([
      WalletTransaction.find(filter)
        .sort({ createdAt: -1 })
        .populate("userId", "uid phoneNumber")
        .skip(skip)
        .limit(limit)
        .lean(),
      WalletTransaction.countDocuments(filter),
    ]);

    return res.json({
      ok: true,
      rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (err) {
    console.error("bonus-history error:", err);
    return res.status(500).json({
      ok: false,
      message: err.message || "Server error",
    });
  }
});

router.get("/bonus-history", protect, adminOnly, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.max(1, parseInt(req.query.limit || "10", 10));
    const q = String(req.query.q || "").trim();
    const uid = String(req.query.uid || "").trim();

    const skip = (page - 1) * limit;

    let userFilterId = null;

    if (uid) {
      const user = await User.findOne({ uid }).select("_id uid phoneNumber").lean();
      if (!user) {
        return res.json({
          ok: true,
          rows: [],
          user: null,
          pagination: {
            page,
            limit,
            total: 0,
            totalPages: 1,
          },
        });
      }
      userFilterId = user._id;
    }

    const filter = {
      type: "BONUS",
    };

    if (userFilterId) {
      filter.userId = userFilterId;
    }

    if (q) {
      filter.note = { $regex: q, $options: "i" };
    }

    const [rows, total] = await Promise.all([
      WalletTransaction.find(filter)
        .sort({ createdAt: -1 })
        .populate("userId", "uid phoneNumber")
        .skip(skip)
        .limit(limit)
        .lean(),
      WalletTransaction.countDocuments(filter),
    ]);

    let pickedUser = null;
    if (userFilterId) {
      pickedUser = await User.findById(userFilterId)
        .select("_id uid phoneNumber balance")
        .lean();
    }

    return res.json({
      ok: true,
      user: pickedUser,
      rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (err) {
    console.error("bonus-history error:", err);
    return res.status(500).json({
      ok: false,
      message: err.message || "Server error",
    });
  }
});

router.post("/users/:id/borrow", protect, adminOnly, async (req, res) => {
  try {
    const amount = Number(req.body.amount);
    const note = String(req.body.note || "Admin borrow credit").trim();

    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({
        ok: false,
        message: "amount must be a positive number",
      });
    }

    const result = await runMongoTransactionWithRetry(async (session) => {
      const user = await User.findById(req.params.id).session(session);

      if (!user) {
        const err = new Error("User not found");
        err.statusCode = 404;
        throw err;
      }

      const before = Number(user.balance || 0);
      const after = before + amount;

      user.balance = after;
      await user.save({ session });

      await WalletTransaction.create(
        [
          {
            userId: user._id,
            type: "BORROW",
            amount,
            balanceBefore: before,
            balanceAfter: after,
            note,
            relatedOrderId: null,
          },
        ],
        { session }
      );

      return {
        userId: user._id,
        user: {
          _id: user._id,
          uid: user.uid,
          phoneNumber: user.phoneNumber,
          balance: user.balance,
          role: user.role,
        },
      };
    });

    emitAdminUserBalanceUpdated(req, result.user);
    await emitUserWalletUpdate(req, result.userId);

    return res.json({
      ok: true,
      message: "✅ Borrow credit added successfully",
      transactionType: "BORROW",
      user: result.user,
    });
  } catch (err) {
    console.error("admin borrow error:", err);

    return res.status(err.statusCode || 500).json({
      ok: false,
      message: err.message || "Server error",
    });
  }
});

router.get("/users/:id/borrow-history", protect, adminOnly, async (req, res) => {
  try {
    const userId = req.params.id;
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.max(1, parseInt(req.query.limit || "10", 10));
    const q = String(req.query.q || "").trim();

    const filter = {
      userId,
      type: "BORROW",
    };

    if (q) {
      filter.note = { $regex: q, $options: "i" };
    }

    const skip = (page - 1) * limit;

    const [rows, total] = await Promise.all([
      WalletTransaction.find(filter)
        .sort({ createdAt: -1 })
        .populate("userId", "uid phoneNumber")
        .skip(skip)
        .limit(limit)
        .lean(),
      WalletTransaction.countDocuments(filter),
    ]);

    return res.json({
      ok: true,
      rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (err) {
    console.error("borrow-history error:", err);
    return res.status(500).json({
      ok: false,
      message: err.message || "Server error",
    });
  }
});

router.get("/borrow-history", protect, adminOnly, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.max(1, parseInt(req.query.limit || "10", 10));
    const q = String(req.query.q || "").trim();
    const uid = String(req.query.uid || "").trim();

    const skip = (page - 1) * limit;

    let userFilterId = null;

    if (uid) {
      const user = await User.findOne({ uid }).select("_id uid phoneNumber").lean();
      if (!user) {
        return res.json({
          ok: true,
          rows: [],
          user: null,
          pagination: {
            page,
            limit,
            total: 0,
            totalPages: 1,
          },
        });
      }

      userFilterId = user._id;
    }

    const filter = {
      type: "BORROW",
    };

    if (userFilterId) {
      filter.userId = userFilterId;
    }

    if (q) {
      filter.note = { $regex: q, $options: "i" };
    }

    const [rows, total] = await Promise.all([
      WalletTransaction.find(filter)
        .sort({ createdAt: -1 })
        .populate("userId", "uid phoneNumber")
        .skip(skip)
        .limit(limit)
        .lean(),
      WalletTransaction.countDocuments(filter),
    ]);

    let pickedUser = null;
    if (userFilterId) {
      pickedUser = await User.findById(userFilterId)
        .select("_id uid phoneNumber balance")
        .lean();
    }

    return res.json({
      ok: true,
      user: pickedUser,
      rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (err) {
    console.error("borrow-history error:", err);
    return res.status(500).json({
      ok: false,
      message: err.message || "Server error",
    });
  }
});

router.post("/popups", protect, adminOnly, async (req, res) => {
  try {
    const { title, message, targetType, targetUsers, isActive } = req.body || {};

    if (!title || !String(title).trim()) {
      return res.status(400).json({ ok: false, message: "title is required" });
    }

    if (!message || !String(message).trim()) {
      return res.status(400).json({ ok: false, message: "message is required" });
    }

    const cleanTargetType = targetType === "specific" ? "specific" : "all";

    let cleanTargetUsers = [];
    if (cleanTargetType === "specific") {
      if (!Array.isArray(targetUsers) || targetUsers.length === 0) {
        return res.status(400).json({
          ok: false,
          message: "targetUsers is required when targetType is specific",
        });
      }

      cleanTargetUsers = [...new Set(targetUsers.map(String))];
    }

    const popup = await AdminPopup.create({
      title: String(title).trim(),
      message: String(message).trim(),
      targetType: cleanTargetType,
      targetUsers: cleanTargetUsers,
      isActive: typeof isActive === "boolean" ? isActive : true,
      createdBy: req.user.userId,
    });

    return res.status(201).json({
      ok: true,
      message: "✅ Popup created",
      popup,
    });
  } catch (err) {
    console.error("create popup error:", err);
    return res.status(500).json({ ok: false, message: err.message || "Server error" });
  }
});

router.get("/popups", protect, adminOnly, async (req, res) => {
  try {
    const popups = await AdminPopup.find()
      .populate("targetUsers", "_id uid phoneNumber")
      .populate("createdBy", "_id uid phoneNumber role")
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ ok: true, popups });
  } catch (err) {
    console.error("list popups error:", err);
    return res.status(500).json({ ok: false, message: err.message || "Server error" });
  }
});

router.put("/popups/:id", protect, adminOnly, async (req, res) => {
  try {
    const { title, message, targetType, targetUsers, isActive } = req.body || {};

    const popup = await AdminPopup.findById(req.params.id);
    if (!popup) {
      return res.status(404).json({ ok: false, message: "Popup not found" });
    }

    if (title !== undefined) {
      if (!String(title).trim()) {
        return res.status(400).json({ ok: false, message: "title cannot be empty" });
      }
      popup.title = String(title).trim();
    }

    if (message !== undefined) {
      if (!String(message).trim()) {
        return res.status(400).json({ ok: false, message: "message cannot be empty" });
      }
      popup.message = String(message).trim();
    }

    if (targetType !== undefined) {
      popup.targetType = targetType === "specific" ? "specific" : "all";
    }

    if (popup.targetType === "specific") {
      if (!Array.isArray(targetUsers) || targetUsers.length === 0) {
        return res.status(400).json({
          ok: false,
          message: "targetUsers is required when targetType is specific",
        });
      }
      popup.targetUsers = [...new Set(targetUsers.map(String))];
    } else {
      popup.targetUsers = [];
    }

    if (typeof isActive === "boolean") {
      popup.isActive = isActive;
    }

    await popup.save();

    return res.json({
      ok: true,
      message: "✅ Popup updated",
      popup,
    });
  } catch (err) {
    console.error("update popup error:", err);
    return res.status(500).json({ ok: false, message: err.message || "Server error" });
  }
});

router.delete("/popups/:id", protect, adminOnly, async (req, res) => {
  try {
    const popup = await AdminPopup.findByIdAndDelete(req.params.id);
    if (!popup) {
      return res.status(404).json({ ok: false, message: "Popup not found" });
    }

    await AdminPopupUserState.deleteMany({ popupId: popup._id });

    return res.json({
      ok: true,
      message: "✅ Popup deleted",
    });
  } catch (err) {
    console.error("delete popup error:", err);
    return res.status(500).json({ ok: false, message: err.message || "Server error" });
  }
});

router.patch("/popups/:id/active", protect, adminOnly, async (req, res) => {
  try {
    const { isActive } = req.body || {};

    const popup = await AdminPopup.findById(req.params.id);
    if (!popup) {
      return res.status(404).json({ ok: false, message: "Popup not found" });
    }

    popup.isActive = Boolean(isActive);
    await popup.save();

    return res.json({
      ok: true,
      message: `✅ Popup ${popup.isActive ? "activated" : "deactivated"}`,
      popup,
    });
  } catch (err) {
    console.error("toggle popup active error:", err);
    return res.status(500).json({ ok: false, message: err.message || "Server error" });
  }
});

/**
 * ============================
 * ✅ TARGETED BONUS OFFER
 * ============================
 */

// ✅ Admin create targeted bonus offer for specific user by UID
router.post("/users/:uid/targeted-bonus-offers", protect, adminOnly, async (req, res) => {
  try {
    const uid = String(req.params.uid || "").trim();
    const {
      title,
      description,
      options,
      eventType,
    } = req.body || {};

    if (!uid) {
      return res.status(400).json({
        ok: false,
        message: "uid is required",
      });
    }

    if (!title || !String(title).trim()) {
      return res.status(400).json({
        ok: false,
        message: "title is required",
      });
    }

    if (!description || !String(description).trim()) {
      return res.status(400).json({
        ok: false,
        message: "description is required",
      });
    }

    if (!Array.isArray(options) || options.length === 0) {
      return res.status(400).json({
        ok: false,
        message: "At least one deposit/bonus option is required",
      });
    }

    const user = await User.findOne({ uid }).select("_id uid phoneNumber");
    if (!user) {
      return res.status(404).json({
        ok: false,
        message: "User not found",
      });
    }

    const requestedEventType = String(eventType || "").trim();

    if (requestedEventType === "entrepreneur") {
      return res.status(400).json({
        ok: false,
        message:
          "Entrepreneur offers are automated. Edit the presaved entrepreneur package instead.",
      });
    }

    const cleanOptions = options.map((item) => {
      const tierTitle = String(item.tierTitle || "").trim();
      const depositAmount = Number(item.depositAmount);
      const bonusAmount = Number(item.bonusAmount);
    
      if (!Number.isFinite(depositAmount) || depositAmount <= 0) {
        throw new Error("Invalid deposit amount");
      }
    
      if (!Number.isFinite(bonusAmount) || bonusAmount < 0) {
        throw new Error("Invalid bonus amount");
      }
    
      return {
        tierTitle,
        depositAmount,
        bonusAmount,
        isFull: Boolean(item.isFull),
      };
    });

    const cleanEventType = ["targeted", "anniversary"].includes(requestedEventType)
      ? requestedEventType
      : "targeted";
    
    const offer = await TargetedBonusOffer.create({
      user: user._id,
      eventType: cleanEventType,
      title: String(title).trim(),
      description: String(description).trim(),
      options: cleanOptions,
      createdByAdmin: req.user?.userId || null,
    });

    return res.status(201).json({
      ok: true,
      message: "✅ Targeted bonus offer created",
      offer,
      targetUser: {
        _id: user._id,
        uid: user.uid,
        phoneNumber: user.phoneNumber,
      },
    });
  } catch (err) {
    console.error("create targeted bonus offer error:", err);
    return res.status(500).json({
      ok: false,
      message: err.message || "Server error",
    });
  }
});

// ✅ Admin list targeted bonus offers
router.get("/targeted-bonus-offers", protect, adminOnly, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.max(1, parseInt(req.query.limit || "10", 10));
    const uid = String(req.query.uid || "").trim();
    const status = String(req.query.status || "").trim();
    const eventType = String(req.query.eventType || "").trim();

    const skip = (page - 1) * limit;

    const filter = {};

    if (status && ["active", "reserved", "cancelled"].includes(status)) {
      filter.status = status;
    }

    if (
      eventType &&
      ["targeted", "anniversary", "entrepreneur"].includes(eventType)
    ) {
      filter.eventType = eventType;
    }

    if (uid) {
      const user = await User.findOne({ uid }).select("_id uid phoneNumber").lean();

      if (!user) {
        return res.json({
          ok: true,
          rows: [],
          user: null,
          pagination: {
            page,
            limit,
            total: 0,
            totalPages: 1,
          },
        });
      }

      filter.user = user._id;
    }

    const [rows, total] = await Promise.all([
      TargetedBonusOffer.find(filter)
        .populate("user", "_id uid phoneNumber")
        .populate("createdByAdmin", "_id uid phoneNumber role")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),

      TargetedBonusOffer.countDocuments(filter),
    ]);

    return res.json({
      ok: true,
      rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (err) {
    console.error("list targeted bonus offers error:", err);
    return res.status(500).json({
      ok: false,
      message: err.message || "Server error",
    });
  }
});

// ✅ Admin cancel targeted bonus offer
router.patch("/targeted-bonus-offers/:id/cancel", protect, adminOnly, async (req, res) => {
  try {
    const offer = await TargetedBonusOffer.findById(req.params.id);

    if (!offer) {
      return res.status(404).json({
        ok: false,
        message: "Targeted bonus offer not found",
      });
    }

    if (offer.status === "reserved" || offer.isReserved) {
      return res.status(400).json({
        ok: false,
        message: "Cannot cancel this offer because user already reserved it",
      });
    }

    offer.status = "cancelled";
    await offer.save();

    return res.json({
      ok: true,
      message: "✅ Targeted bonus offer cancelled",
      offer,
    });
  } catch (err) {
    console.error("cancel targeted bonus offer error:", err);
    return res.status(500).json({
      ok: false,
      message: err.message || "Server error",
    });
  }
});

// ✅ Admin get one targeted bonus offer detail
router.get("/targeted-bonus-offers/:id", protect, adminOnly, async (req, res) => {
  try {
    const offer = await TargetedBonusOffer.findById(req.params.id)
      .populate("user", "_id uid phoneNumber balance")
      .populate("createdByAdmin", "_id uid phoneNumber role")
      .lean();

    if (!offer) {
      return res.status(404).json({
        ok: false,
        message: "Targeted bonus offer not found",
      });
    }

    return res.json({
      ok: true,
      offer,
    });
  } catch (err) {
    console.error("get targeted bonus offer detail error:", err);
    return res.status(500).json({
      ok: false,
      message: err.message || "Server error",
    });
  }
});

// ✅ Admin reset user's selected targeted bonus choice
router.patch(
  "/targeted-bonus-offers/:id/reset-selection",
  protect,
  adminOnly,
  async (req, res) => {
    try {
      const offer = await TargetedBonusOffer.findById(req.params.id);

      if (!offer) {
        return res.status(404).json({
          ok: false,
          message: "Targeted bonus offer not found",
        });
      }

      if (!offer.isReserved && offer.status !== "reserved" && !offer.selectedOption) {
        return res.status(400).json({
          ok: false,
          message: "This offer has no selected choice to reset",
        });
      }

      offer.selectedOption = undefined;
      offer.isReserved = false;
      offer.reservedAt = null;
      offer.status = "active";

      await offer.save();

      return res.json({
        ok: true,
        message: "✅ User selected choice removed. User can select again.",
        offer,
      });
    } catch (err) {
      console.error("reset targeted bonus selection error:", err);
      return res.status(500).json({
        ok: false,
        message: err.message || "Server error",
      });
    }
  }
);

// ✅ Admin delete targeted bonus offer
router.delete("/targeted-bonus-offers/:id", protect, adminOnly, async (req, res) => {
  try {
    const offer = await TargetedBonusOffer.findByIdAndDelete(req.params.id);

    if (!offer) {
      return res.status(404).json({
        ok: false,
        message: "Targeted bonus offer not found",
      });
    }

    return res.json({
      ok: true,
      message: "✅ Targeted bonus offer deleted",
      deletedId: req.params.id,
    });
  } catch (err) {
    console.error("delete targeted bonus offer error:", err);
    return res.status(500).json({
      ok: false,
      message: err.message || "Server error",
    });
  }
});

// ✅ Admin get entrepreneur presaved package
router.get("/bonus-offer-templates/entrepreneur", protect, adminOnly, async (req, res) => {
  try {
    let template = await BonusOfferTemplate.findOne({
      key: ENTREPRENEUR_TEMPLATE_KEY,
      eventType: "entrepreneur",
    }).lean();

    if (!template) {
      template = await BonusOfferTemplate.create(DEFAULT_ENTREPRENEUR_TEMPLATE);
      template = template.toObject();
    }

    return res.json({
      ok: true,
      template,
    });
  } catch (err) {
    console.error("get entrepreneur template error:", err);
    return res.status(500).json({
      ok: false,
      message: err.message || "Server error",
    });
  }
});

// ✅ Admin update entrepreneur presaved package
router.put("/bonus-offer-templates/entrepreneur", protect, adminOnly, async (req, res) => {
  try {
    const title = String(req.body.title || "").trim();
    const description = String(req.body.description || "").trim();
    const options = cleanBonusTemplateOptions(req.body.options);

    if (!title) {
      return res.status(400).json({
        ok: false,
        message: "Title is required",
      });
    }

    if (!description) {
      return res.status(400).json({
        ok: false,
        message: "Description is required",
      });
    }

    const template = await BonusOfferTemplate.findOneAndUpdate(
      {
        key: ENTREPRENEUR_TEMPLATE_KEY,
        eventType: "entrepreneur",
      },
      {
        $set: {
          title,
          description,
          options,
          updatedByAdmin: req.user?.userId || req.user?._id || null,
        },
        $setOnInsert: {
          key: ENTREPRENEUR_TEMPLATE_KEY,
          eventType: "entrepreneur",
        },
      },
      {
        upsert: true,
        new: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      }
    ).lean();

    return res.json({
      ok: true,
      message: "Entrepreneur package saved",
      template,
    });
  } catch (err) {
    console.error("update entrepreneur template error:", err);
    return res.status(400).json({
      ok: false,
      message: err.message || "Failed to save entrepreneur package",
    });
  }
});

function isValidEmailAddress(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

async function ensureDefaultAdminEmailTemplates() {
  const defaults = [
    {
      key: "credit_score_withdrawal_notice",
      name: "Credit Score Withdrawal Notice",
      subject: "Withdrawal Review Notice",
      brevoTemplateIdEnv: "BREVO_CREDIT_SCORE_TEMPLATE_ID",
      description:
        "Notify a recipient that their withdrawal request requires further review because the credit score is below the required score.",
      requiredParams: ["uid", "creditScore", "supportUrl"],
      isActive: true,
    },

    {
      key: "tax_withholding_notice",
      name: "Tax Notice",
      subject: "Tax Notice Regarding Your Withdrawal",
      brevoTemplateIdEnv: "BREVO_TAX_WITHHOLDING_TEMPLATE_ID",
      description:
        "Notify a recipient that a withdrawal requires tax withholding review and show withdrawal amount, withholding rate, withholding amount.",
      requiredParams: [
        "uid",
        "withdrawalAmount",
        "taxRate",
        "taxAmount",
        "supportUrl",
      ],
      isActive: true,
    },

  ];

  for (const item of defaults) {
    await AdminEmailTemplate.findOneAndUpdate(
      { key: item.key },
      { $setOnInsert: item },
      { upsert: true, new: true }
    );
  }
}

async function sendBrevoTemplateEmail({ toEmail, templateId, params }) {
  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.BREVO_SENDER_EMAIL;
  const senderName = process.env.BREVO_SENDER_NAME || "Additive";

  if (!apiKey) throw new Error("Missing BREVO_API_KEY");
  if (!senderEmail) throw new Error("Missing BREVO_SENDER_EMAIL");
  if (!templateId) throw new Error("Missing Brevo template ID");

  const resp = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify({
      sender: {
        name: senderName,
        email: senderEmail,
      },
      to: [
        {
          email: toEmail,
        },
      ],
      templateId,
      params,
    }),
  });

  const data = await resp.json().catch(() => ({}));

  if (!resp.ok) {
    console.error("Brevo dynamic email failed:", resp.status, data);
    throw new Error(data?.message || "Failed to send email");
  }

  return data;
}

async function sendBrevoCreditScoreEmail({ toEmail, uid, creditScore, supportUrl }) {
  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.BREVO_SENDER_EMAIL;
  const senderName = process.env.BREVO_SENDER_NAME || "Additive";
  const templateId = Number(process.env.BREVO_CREDIT_SCORE_TEMPLATE_ID);

  if (!apiKey) {
    throw new Error("Missing BREVO_API_KEY");
  }

  if (!senderEmail) {
    throw new Error("Missing BREVO_SENDER_EMAIL");
  }

  if (!templateId) {
    throw new Error("Missing BREVO_CREDIT_SCORE_TEMPLATE_ID");
  }

  const resp = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify({
      sender: {
        name: senderName,
        email: senderEmail,
      },
      to: [
        {
          email: toEmail,
        },
      ],
      templateId,
      params: {
        uid,
        creditScore,
        supportUrl,
      },
    }),
  });

  const data = await resp.json().catch(() => ({}));

  if (!resp.ok) {
    console.error("Brevo credit score email failed:", resp.status, data);
    throw new Error(data?.message || "Failed to send credit score email");
  }

  return data;
}

// ✅ Admin send credit score withdrawal notice email
router.post("/users/:id/send-credit-score-email", protect, adminOnly, async (req, res) => {
  try {
    const { supportUrl } = req.body || {};

    const user = await User.findById(req.params.id).select(
      "uid phoneNumber email emailVerified creditScore"
    );

    if (!user) {
      return res.status(404).json({
        ok: false,
        message: "User not found",
      });
    }

    if (!user.email) {
      return res.status(400).json({
        ok: false,
        message: "This user has no email address saved",
      });
    }

    if (!user.emailVerified) {
      return res.status(400).json({
        ok: false,
        message: "This user's email is not verified",
      });
    }

    const creditScore = Number(user.creditScore || 0);

    await sendBrevoCreditScoreEmail({
      toEmail: user.email,
      uid: user.uid,
      creditScore,
      supportUrl: String(supportUrl || "").trim() || "https://additive-travel.com/chat",
    });

    return res.json({
      ok: true,
      message: "Credit score notice email sent successfully",
      user: {
        _id: user._id,
        uid: user.uid,
        phoneNumber: user.phoneNumber,
        email: user.email,
        emailVerified: user.emailVerified,
        creditScore,
      },
    });
  } catch (err) {
    console.error("send credit score email error:", err);
    return res.status(500).json({
      ok: false,
      message: err.message || "Server error",
    });
  }
});

/**
 * ============================
 * ✅ ADMIN EMAIL CENTER
 * ============================
 */

// ✅ List available email templates
router.get("/email/templates", protect, adminOnly, async (req, res) => {
  try {
    await ensureDefaultAdminEmailTemplates();

    const templates = await AdminEmailTemplate.find({ isActive: true })
      .sort({ createdAt: 1 })
      .lean();

    return res.json({
      ok: true,
      templates,
    });
  } catch (err) {
    console.error("admin email templates error:", err);
    return res.status(500).json({
      ok: false,
      message: err.message || "Server error",
    });
  }
});

// ✅ List sent email logs
router.get("/email/logs", protect, adminOnly, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || "10", 10)));
    const q = String(req.query.q || "").trim();

    const skip = (page - 1) * limit;

    const filter = {};

    if (q) {
      filter.$or = [
        { toEmail: { $regex: q, $options: "i" } },
        { targetUid: { $regex: q, $options: "i" } },
        { targetPhoneNumber: { $regex: q, $options: "i" } },
        { templateName: { $regex: q, $options: "i" } },
        { subject: { $regex: q, $options: "i" } },
      ];
    }

    const [logs, total] = await Promise.all([
      AdminEmailLog.find(filter)
        .populate("sentBy", "uid phoneNumber role")
        .populate("targetUser", "uid phoneNumber email emailVerified")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),

      AdminEmailLog.countDocuments(filter),
    ]);

    return res.json({
      ok: true,
      logs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (err) {
    console.error("admin email logs error:", err);
    return res.status(500).json({
      ok: false,
      message: err.message || "Server error",
    });
  }
});

// ✅ Search user by UID for email sending
router.get("/email/users/search", protect, adminOnly, async (req, res) => {
  try {
    const uid = String(req.query.uid || "").trim();

    if (!uid) {
      return res.status(400).json({
        ok: false,
        message: "UID is required",
      });
    }

    const user = await User.findOne({ uid })
      .select("uid phoneNumber email emailVerified creditScore role")
      .lean();

    if (!user) {
      return res.status(404).json({
        ok: false,
        message: "User not found",
      });
    }

    return res.json({
      ok: true,
      user,
    });
  } catch (err) {
    console.error("admin email user search error:", err);
    return res.status(500).json({
      ok: false,
      message: err.message || "Server error",
    });
  }
});

// ✅ Send dynamic admin email
router.post("/email/send", protect, adminOnly, async (req, res) => {
  let logDoc = null;

  try {
    await ensureDefaultAdminEmailTemplates();

    const {
      templateKey,
      recipientType,
      uid,
      guestEmail,
      params,
    } = req.body || {};

    const cleanTemplateKey = String(templateKey || "").trim();
    const cleanRecipientType = String(recipientType || "").trim().toUpperCase();

    if (!cleanTemplateKey) {
      return res.status(400).json({
        ok: false,
        message: "templateKey is required",
      });
    }

    if (!["USER", "GUEST"].includes(cleanRecipientType)) {
      return res.status(400).json({
        ok: false,
        message: "recipientType must be USER or GUEST",
      });
    }

    const template = await AdminEmailTemplate.findOne({
      key: cleanTemplateKey,
      isActive: true,
    }).lean();

    if (!template) {
      return res.status(404).json({
        ok: false,
        message: "Email template not found",
      });
    }

    const templateId = Number(process.env[template.brevoTemplateIdEnv]);

    if (!templateId) {
      return res.status(500).json({
        ok: false,
        message: `Missing ${template.brevoTemplateIdEnv}`,
      });
    }

    let targetUser = null;
    let toEmail = "";
    let targetUid = "";
    let targetPhoneNumber = "";

    if (cleanRecipientType === "USER") {
      const cleanUid = String(uid || "").trim();

      if (!cleanUid) {
        return res.status(400).json({
          ok: false,
          message: "UID is required",
        });
      }

      targetUser = await User.findOne({ uid: cleanUid }).select(
        "uid phoneNumber email emailVerified creditScore"
      );

      if (!targetUser) {
        return res.status(404).json({
          ok: false,
          message: "User not found",
        });
      }

      if (!targetUser.email || !targetUser.emailVerified) {
        return res.status(400).json({
          ok: false,
          message: "This user does not have a verified email",
        });
      }

      toEmail = targetUser.email;
      targetUid = targetUser.uid;
      targetPhoneNumber = targetUser.phoneNumber || "";
    }

    if (cleanRecipientType === "GUEST") {
      toEmail = String(guestEmail || "").trim().toLowerCase();
    
      if (!isValidEmailAddress(toEmail)) {
        return res.status(400).json({
          ok: false,
          message: "Valid guestEmail is required",
        });
      }
    
      targetUid = String(params?.uid || "").trim();
    
      if (!targetUid) {
        return res.status(400).json({
          ok: false,
          message: "UID is required for guest email",
        });
      }
    
      targetPhoneNumber = "";
    }

    const finalParams = {
      ...(params || {}),
      uid: targetUid || String(params?.uid || "").trim(),
      supportUrl: params?.supportUrl || "https://additive-travel.com/chat",
    };

    if (template.key === "credit_score_withdrawal_notice") {
      finalParams.creditScore = Number(
        params?.creditScore ??
          targetUser?.creditScore ??
          0
      );
    }

    if (template.key === "tax_withholding_notice") {
      const withdrawalAmount = Number(params?.withdrawalAmount || 0);
      const taxRate = Number(params?.taxRate || 0);
    
      if (!Number.isFinite(withdrawalAmount) || withdrawalAmount <= 0) {
        return res.status(400).json({
          ok: false,
          message: "withdrawalAmount must be a positive number",
        });
      }
    
      if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) {
        return res.status(400).json({
          ok: false,
          message: "taxRate must be between 0 and 100",
        });
      }
    
      const taxAmount = Number((withdrawalAmount * (taxRate / 100)).toFixed(2));
    
      const moneyFormat = new Intl.NumberFormat("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      
      finalParams.withdrawalAmount = moneyFormat.format(withdrawalAmount);
      finalParams.taxRate = taxRate.toFixed(2);
      finalParams.taxAmount = moneyFormat.format(taxAmount);
    }

    for (const key of template.requiredParams || []) {
      if (
        finalParams[key] === undefined ||
        finalParams[key] === null ||
        String(finalParams[key]).trim() === ""
      ) {
        return res.status(400).json({
          ok: false,
          message: `Missing required template param: ${key}`,
        });
      }
    }

    logDoc = await AdminEmailLog.create({
      templateKey: template.key,
      templateName: template.name,
      subject: template.subject,
      toEmail,
      recipientType: cleanRecipientType,
      targetUser: targetUser?._id || null,
      targetUid,
      targetPhoneNumber,
      params: finalParams,
      sentBy: req.user.userId,
      status: "SENT",
    });

    const brevoData = await sendBrevoTemplateEmail({
      toEmail,
      templateId,
      params: finalParams,
    });

    logDoc.brevoResponse = brevoData;
    logDoc.brevoMessageId = brevoData?.messageId || "";
    logDoc.status = "SENT";
    await logDoc.save();

    return res.json({
      ok: true,
      message: "Email sent successfully",
      log: logDoc,
    });
  } catch (err) {
    console.error("admin dynamic email send error:", err);

    if (logDoc) {
      logDoc.status = "FAILED";
      logDoc.errorMessage = err.message || "Failed to send email";
      await logDoc.save().catch(() => {});
    }

    return res.status(500).json({
      ok: false,
      message: err.message || "Server error",
    });
  }
});

module.exports = router;