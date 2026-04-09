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
const { adminListDeposits } = require("../controllers/adminDepositsController");
const SigninClaim = require("../models/SigninClaim");
const UserOrder = require("../models/UserOrder");
const SigninRewardRule = require("../models/SigninRewardRule");

const router = express.Router();

// ✅ Get all users
router.get("/users", protect, adminOnly, async (req, res) => {
  try {
    const users = await User.find()
      .select("-password")
      .populate("referredBy", "phoneNumber referralCode")
      .sort({ createdAt: -1 })
      .lean();

    const userIds = users.map((u) => u._id);

    const counts = await User.aggregate([
      { $match: { referredBy: { $in: userIds } } },
      { $group: { _id: "$referredBy", count: { $sum: 1 } } },
    ]);

    const referralCountMap = new Map(
      counts.map((x) => [String(x._id), x.count])
    );

    const enrichedUsers = users.map((u) => ({
      ...u,
      referralCount: referralCountMap.get(String(u._id)) || 0,
    }));

    return res.json({ ok: true, users: enrichedUsers });
  } catch (err) {
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
// mode: "inc" -> balance += amount (can use -50 to subtract)
router.patch("/users/:id/balance", protect, adminOnly, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { mode, amount, note } = req.body;
    const num = Number(amount);

    if (!Number.isFinite(num)) {
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

    // ✅ Apply balance update
    if (mode === "set") {
      after = num;
      user.balance = after;
    } else if (mode === "inc") {
      after = before + num;
      user.balance = after;
    } else {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ ok: false, message: "Invalid mode" });
    }

    await user.save({ session });

    // ✅ Determine transaction type
    // Only admin deposits should show in "Deposits page"
    let txType = "ADMIN_ADJUST";
    if (mode === "inc" && num > 0) txType = "DEPOSIT";

    // ✅ Save transaction record
    await WalletTransaction.create(
      [
        {
          userId: user._id,
          type: txType, // DEPOSIT or ADMIN_ADJUST
          amount: num, // + or -
          balanceBefore: before,
          balanceAfter: after,
          note: String(note || ""),
          relatedOrderId: null,
        },
      ],
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    return res.json({
      ok: true,
      message: "✅ Balance updated + transaction recorded",
      user: {
        _id: user._id,
        phoneNumber: user.phoneNumber,
        balance: user.balance,
        role: user.role,
      },
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    return res.status(500).json({ ok: false, message: err.message });
  }
});

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
      balanceAfter: user.balance, // 
      note,
    });

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
    let config = await VipConfig.findOne().lean();

    // auto create if missing
    if (!config) config = await VipConfig.create({});

    return res.json({ ok: true, config });
  } catch (err) {
    console.error("Get VIP config error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

router.put("/vip/config", protect, adminOnly, async (req, res) => {
  try {
    const { ranks } = req.body;

    if (!Array.isArray(ranks) || ranks.length !== 3) {
      return res.status(400).json({
        ok: false,
        message: "ranks must be an array of 3 items (rank 1..3)",
      });
    }

    // validate each rank
    const cleaned = ranks.map((r) => {
      const rank = Number(r.rank);
      const ordersLimit = Number(r.ordersLimit);
      const commissionRate = Number(r.commissionRate);

      if (![1, 2, 3].includes(rank)) throw new Error("Invalid rank");
      if (!Number.isFinite(ordersLimit) || ordersLimit < 1) throw new Error("Invalid ordersLimit");
      if (!Number.isFinite(commissionRate) || commissionRate < 0) throw new Error("Invalid commissionRate");

      return { rank, ordersLimit, commissionRate };
    });

    let config = await VipConfig.findOne();
    if (!config) config = await VipConfig.create({ ranks: cleaned });
    else {
      config.ranks = cleaned;
      await config.save();
    }

    return res.json({ ok: true, message: "✅ VIP config updated", config });
  } catch (err) {
    console.error("Update VIP config error:", err);
    return res.status(500).json({ ok: false, message: err.message });
  }
});

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

module.exports = router;
