const express = require("express");
const mongoose = require("mongoose");

const User = require("../models/User");
const UserOrder = require("../models/UserOrder");
const VipConfig = require("../models/VipConfig");
const WalletTransaction = require("../models/WalletTransaction");
const { protect } = require("../middleware/auth");

const router = express.Router();

// ✅ AGENT PANEL: view only my referred users
router.get("/users", protect, async (req, res) => {
  try {
    const loggedInUserId = req.user.userId;

    const loggedInUser = await User.findById(loggedInUserId)
      .select("_id phoneNumber uid role referralCode")
      .lean();

    if (!loggedInUser) {
      return res.status(404).json({ message: "User not found" });
    }

    const users = await User.find({
      referredBy: loggedInUserId,
    })
      .select("-password")
      .populate("referredBy", "phoneNumber uid referralCode")
      .sort({ createdAt: -1 })
      .lean();

    let config = await VipConfig.findOne().lean();
    if (!config) config = await VipConfig.create({});

    const ranks = Array.isArray(config.ranks) ? config.ranks : [];
    const userIds = users.map((u) => u._id);

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
        ? pending.isBonus
          ? Number(pending.price || 0) + Number(pending.commission || 0)
          : 0
        : 0;

      const vipRank = Number(u.vipRank || 1);
      const vip = ranks.find((r) => Number(r.rank) === vipRank) || ranks[0];

      const derivedOrdersLimit = Number(
        vip?.ordersLimit || u.ordersLimit || 30
      );

      return {
        ...u,
        ordersLimit: derivedOrdersLimit,
        balance: cleanBalance,
        availableBalance,
        displayBalance,
        pendingAmount,
        currentPendingOrder: pending,
      };
    });

    return res.json({
      ok: true,
      users: enrichedUsers,
      agent: {
        _id: loggedInUser._id,
        phoneNumber: loggedInUser.phoneNumber,
        uid: loggedInUser.uid,
        role: loggedInUser.role,
        referralCode: loggedInUser.referralCode,
      },
    });
  } catch (err) {
    console.error("GET /api/agent/users error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// ✅ AGENT PANEL: own invitation code + own referred users' invitation codes
router.get("/referral-users", protect, async (req, res) => {
  try {
    const loggedInUserId = req.user.userId;

    const me = await User.findById(loggedInUserId)
      .select("_id phoneNumber uid role referralCode createdAt")
      .lean();

    if (!me) {
      return res.status(404).json({ message: "User not found" });
    }

    const users = await User.find({
      referredBy: loggedInUserId,
    })
      .select("_id phoneNumber uid referralCode referredBy createdAt")
      .populate("referredBy", "phoneNumber uid referralCode")
      .sort({ createdAt: -1 })
      .lean();

    const referredUserIds = users.map((u) => u._id);

    const referralCounts = await User.aggregate([
      {
        $match: {
          referredBy: { $in: referredUserIds },
        },
      },
      {
        $group: {
          _id: "$referredBy",
          count: { $sum: 1 },
        },
      },
    ]);

    const countMap = new Map(
      referralCounts.map((item) => [String(item._id), Number(item.count || 0)])
    );

    const usersWithCounts = users.map((u) => ({
      ...u,
      referralCount: countMap.get(String(u._id)) || 0,
    }));

    return res.json({
      ok: true,
      me: {
        _id: me._id,
        phoneNumber: me.phoneNumber,
        uid: me.uid,
        role: me.role,
        referralCode: me.referralCode,
        createdAt: me.createdAt,
      },
      users: usersWithCounts,
    });
  } catch (err) {
    console.error("GET /api/agent/referral-users error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// ✅ AGENT PANEL: trial bonus list for own referred users only
router.get("/trial-users", protect, async (req, res) => {
  try {
    const loggedInUserId = req.user.userId;

    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 10)));
    const skip = (page - 1) * limit;

    const q = String(req.query.q || "").trim();

    const userMatch = {
      referredBy: loggedInUserId,
    };

    if (q) {
      userMatch.$or = [
        { phoneNumber: { $regex: q, $options: "i" } },
        { uid: { $regex: q, $options: "i" } },
      ];
    }

    const total = await User.countDocuments(userMatch);

    const users = await User.find(userMatch)
      .select("_id uid phoneNumber createdAt")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const userIds = users.map((u) => u._id);

    const txAgg = await WalletTransaction.aggregate([
      {
        $match: {
          userId: { $in: userIds },
          type: { $in: ["TRIAL_CREDIT", "TRIAL_REVERSAL"] },
        },
      },
      {
        $group: {
          _id: {
            userId: "$userId",
            type: "$type",
          },
          total: { $sum: "$amount" },
          lastAt: { $max: "$createdAt" },
        },
      },
    ]);

    const summaryMap = new Map();

    for (const item of txAgg) {
      const userId = String(item._id.userId);
      const type = item._id.type;

      const existing = summaryMap.get(userId) || {
        credited: 0,
        reversed: 0,
        lastCreditAt: null,
        lastReversalAt: null,
      };

      if (type === "TRIAL_CREDIT") {
        existing.credited = Number(item.total || 0);
        existing.lastCreditAt = item.lastAt || null;
      }

      if (type === "TRIAL_REVERSAL") {
        existing.reversed = Math.abs(Number(item.total || 0));
        existing.lastReversalAt = item.lastAt || null;
      }

      summaryMap.set(userId, existing);
    }

    const rows = users.map((u) => {
      const summary = summaryMap.get(String(u._id)) || {
        credited: 0,
        reversed: 0,
        lastCreditAt: null,
        lastReversalAt: null,
      };

      const credited = Number(summary.credited || 0);
      const reversed = Number(summary.reversed || 0);
      const remaining = Math.max(0, credited - reversed);

      return {
        userId: String(u._id),
        uid: u.uid || "",
        phoneNumber: u.phoneNumber || "",
        credited,
        reversed,
        remaining,
        lastCreditAt: summary.lastCreditAt,
        lastReversalAt: summary.lastReversalAt,
        hasTrial: credited > 0,
        isFullyRevoked: credited > 0 && remaining <= 0,
      };
    });

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
    console.error("GET /api/agent/trial-users error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// ✅ AGENT PANEL: refresh one referred user's trial summary only
router.get("/users/:userId/trial-summary", protect, async (req, res) => {
  try {
    const loggedInUserId = req.user.userId;
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: "Invalid userId" });
    }

    const user = await User.findOne({
      _id: userId,
      referredBy: loggedInUserId,
    })
      .select("_id uid phoneNumber")
      .lean();

    if (!user) {
      return res.status(403).json({
        message: "You can only view trial bonus for your own referred users",
      });
    }

    const creditAgg = await WalletTransaction.aggregate([
      {
        $match: {
          userId: new mongoose.Types.ObjectId(userId),
          type: "TRIAL_CREDIT",
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$amount" },
          lastAt: { $max: "$createdAt" },
        },
      },
    ]);

    const reversalAgg = await WalletTransaction.aggregate([
      {
        $match: {
          userId: new mongoose.Types.ObjectId(userId),
          type: "TRIAL_REVERSAL",
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$amount" },
          lastAt: { $max: "$createdAt" },
        },
      },
    ]);

    const credited = Number(creditAgg[0]?.total || 0);
    const reversed = Math.abs(Number(reversalAgg[0]?.total || 0));
    const remaining = Math.max(0, credited - reversed);

    return res.json({
      ok: true,
      userId: String(user._id),
      uid: user.uid || "",
      phoneNumber: user.phoneNumber || "",
      credited,
      reversed,
      remaining,
      lastCreditAt: creditAgg[0]?.lastAt || null,
      lastReversalAt: reversalAgg[0]?.lastAt || null,
      hasTrial: credited > 0,
      isFullyRevoked: credited > 0 && remaining <= 0,
    });
  } catch (err) {
    console.error("GET /api/agent/users/:userId/trial-summary error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;