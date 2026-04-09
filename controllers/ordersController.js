const mongoose = require("mongoose");
const User = require("../models/User");
const OrderPool = require("../models/OrderPool");
const BonusRule = require("../models/BonusRule");
const UserOrder = require("../models/UserOrder");
const VipConfig = require("../models/VipConfig");
const { getLedgerTotal } = require("../utils/balance");
const WalletTransaction = require("../models/WalletTransaction");

let ACTIVE_POOL_CACHE = [];
let LAST_POOL_REFRESH = 0;

async function refreshOrderPoolCache(force = false) {
  const now = Date.now();
  if (!force && now - LAST_POOL_REFRESH < 5000) return; // refresh max once per 5s

  ACTIVE_POOL_CACHE = await OrderPool.find({ isActive: true })
    .select("_id orderNumber orderName price imageUrl isActive")
    .lean();

  LAST_POOL_REFRESH = now;
}

function calcCommission(price, rate) {
  return Math.round(price * rate * 100) / 100;
}

function buildPendingStats(price, commission, availableBalance, isBonus) {
  const safePrice = Number(price || 0);
  const safeCommission = Number(commission || 0);
  const safeAvailable = Number(availableBalance || 0);

  return {
    availableBalance: safeAvailable,
    shortBalance: isBonus ? safeAvailable - safePrice : safeAvailable,
    pendingAmount: isBonus ? safePrice + safeCommission : 0,
  };
}

async function pickRandomOrderFast(min, max) {
  const query = {
    isActive: true,
    price: { $gte: min, $lte: max },
  };

  const count = await OrderPool.countDocuments(query);
  if (count === 0) return null;

  const skip = Math.floor(Math.random() * count);

  return OrderPool.findOne(query)
    .skip(skip)
    .select("_id orderNumber orderName price imageUrl")
    .lean();
}

async function getVipSettings(user) {
  let config = await VipConfig.findOne().lean();

  // auto create default config if missing
  if (!config) {
    config = await VipConfig.create({
      ranks: [
        { rank: 1, ordersLimit: 40, commissionRate: 0.01 },
        { rank: 2, ordersLimit: 60, commissionRate: 0.015 },
        { rank: 3, ordersLimit: 80, commissionRate: 0.02 },
      ],
    });
  }

  const rank = Number(user.vipRank || 1);
  const vip = config.ranks.find((r) => r.rank === rank) || config.ranks[0];

  return vip; // { rank, ordersLimit, commissionRate }
}

async function searchFlights(req, res) {
  try {
    const userId = req.user.userId; // ✅ from protect()

    const user = await User.findById(userId).lean();
    if (!user) return res.status(404).json({ ok: false, message: "User not found" });

    const vip = await getVipSettings(user);

    if (user.isBanned) {
      return res.status(403).json({ ok: false, message: "User is banned" });
    }

    const ledgerTotal = await getLedgerTotal(user._id);
    const availableBalance = Number(user.balance || 0) + Number(ledgerTotal || 0);

     // ✅ only 1 pending per user
    const existingPending = await UserOrder.findOne({
      user: userId,
      status: "PENDING",
    })
      .populate("poolOrder", "imageUrl")
      .lean();

    if (existingPending) {
      const stats = buildPendingStats(
        existingPending.price,
        existingPending.commission,
        availableBalance,
        existingPending.isBonus
      );

      return res.json({
        ok: true,
        status: existingPending.status,
        orderNumber: existingPending.orderNumber,
        orderName: existingPending.orderName,
        price: existingPending.price,
        commission: existingPending.commission,
        isBonus: existingPending.isBonus,
        imageUrl: existingPending.poolOrder?.imageUrl || "",
        availableBalance: stats.availableBalance,
        shortBalance: stats.shortBalance,
        pendingAmount: stats.pendingAmount,
      });
    }

    // ✅ hard cap AFTER pending check
    if (user.ordersCompleted >= vip.ordersLimit) {
      return res.status(403).json({
        ok: false,
        message: "Order limit reached. Upgrade VIP or contact admin.",
        completedOrders: user.ordersCompleted,
        limit: vip.ordersLimit,
        vipRank: vip.rank,
      });
    }

    const completedCount = Number(user.ordersCompleted ?? 0);
    const safeCompleted = Number.isFinite(completedCount) ? completedCount : 0;
    const nextCount = safeCompleted + 1;

    
    // ✅ bonus trigger priority
    const bonusRule = await BonusRule.findOne({
     user: userId,
     triggerCount: nextCount,
     isActive: true,
   })
  .populate("poolOrder")
  .lean();

    let selected = null;
    let isBonus = false;

    if (bonusRule?.poolOrder?.isActive) {
      selected = bonusRule.poolOrder;
      isBonus = true;
    } else {
      const balance = availableBalance;

      const min1 = Math.floor(balance * 0.5);
      const max1 = Math.floor(balance * 0.9);

      const min2 = Math.floor(balance * 0.3);
      const max2 = Math.floor(balance * 0.95);

      const min3 = Math.floor(balance * 0.1);
      const max3 = Math.floor(balance * 1.0);

      await refreshOrderPoolCache();

const candidates1 = ACTIVE_POOL_CACHE.filter(
  (o) => o.price >= min1 && o.price <= max1
);

const candidates2 = ACTIVE_POOL_CACHE.filter(
  (o) => o.price >= min2 && o.price <= max2
);

const candidates3 = ACTIVE_POOL_CACHE.filter(
  (o) => o.price >= min3 && o.price <= max3
);

const candidates = candidates1.length
  ? candidates1
  : candidates2.length
  ? candidates2
  : candidates3;

selected = candidates[Math.floor(Math.random() * candidates.length)] || null;


  if (!selected) {
    return res.status(404).json({
      ok: false,
      message: "No available flights right now. Please top up and try again.",
    });
  }
}

    const rateToUse = isBonus ? 0.1 : vip.commissionRate; 
    const commission = calcCommission(selected.price, rateToUse);

    const created = await UserOrder.create({
      user: userId,
      poolOrder: selected._id,
      status: "PENDING",
      orderNumber: selected.orderNumber,
      orderName: selected.orderName,
      price: selected.price,
      commission,
      isBonus,
    });

    const stats = buildPendingStats(
      created.price,
      created.commission,
      availableBalance,
      created.isBonus
    );

    return res.json({
      ok: true,
      status: created.status,
      orderNumber: created.orderNumber,
      orderName: created.orderName,
      price: created.price,
      commission: created.commission,
      isBonus: created.isBonus,
      imageUrl: selected.imageUrl || "",
      availableBalance: stats.availableBalance,
      shortBalance: stats.shortBalance,
      pendingAmount: stats.pendingAmount,
    });
  } catch (err) {
    console.error("searchFlights error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

async function submitOrder(req, res) {
  try {
    const userId = req.user.userId;

const user = await User.findById(userId);
if (!user) return res.status(404).json({ ok: false, message: "User not found" });

const vip = await getVipSettings(user);


    if (user.isBanned) {
      return res.status(403).json({ ok: false, message: "User is banned" });
    }

    if (user.ordersCompleted >= vip.ordersLimit) {
     return res.status(403).json({
       ok: false,
       message: "Order limit reached. Upgrade VIP or contact admin.",
       completedOrders: user.ordersCompleted,
       limit: vip.ordersLimit,
       vipRank: vip.rank,
     });
   }

    const pending = await UserOrder.findOne({ user: userId, status: "PENDING" });
    if (!pending) {
      return res.status(400).json({ ok: false, message: "No pending order found" });
    }

    // ✅ insufficient points
    const ledgerTotal = await getLedgerTotal(user._id);
    const availableBalance = Number(user.balance || 0) + Number(ledgerTotal || 0);

    if (availableBalance < pending.price) {
      return res.status(200).json({
        ok: false,
        message: "Insufficient points",
        required: pending.price,
        balance: availableBalance,
      });
    }

    // ✅ ONLY reward commission (do not deduct price)
    user.balance += pending.commission;
    user.ordersCompleted += 1;
    pending.status = "COMPLETED";
    pending.completedAt = new Date();

    // ✅ Auto trial reversal when user finishes required orders
if (user.ordersCompleted >= vip.ordersLimit) {
  const trialRows = await WalletTransaction.aggregate([
    {
      $match: {
        userId: new mongoose.Types.ObjectId(user._id),
        type: "TRIAL_CREDIT",
      },
    },
    { $group: { _id: null, total: { $sum: "$amount" } } },
  ]);

  const trialTotal = Number(trialRows[0]?.total || 0);

  if (trialTotal > 0) {
    // Prevent duplicate reversals: only reverse if not already reversed fully
    const revRows = await WalletTransaction.aggregate([
      {
        $match: {
          userId: new mongoose.Types.ObjectId(user._id),
          type: "TRIAL_REVERSAL",
        },
      },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);

    const reversedTotal = Math.abs(Number(revRows[0]?.total || 0));
    const remaining = Math.max(0, trialTotal - reversedTotal);

    if (remaining > 0) {
      await WalletTransaction.create({
        userId: user._id,
        type: "TRIAL_REVERSAL",
        amount: -remaining,
        balanceBefore: user.balance,
        balanceAfter: user.balance,
        note: "Trial bonus expired (orders completed)",
      });
    }
  }
}

    user.ordersLimit = vip.ordersLimit;
    await user.save();
    await pending.save();

    return res.json({
      ok: true,
      message: "Order completed",
      newBalance: user.balance,
      commissionEarned: pending.commission,
      completedOrders: user.ordersCompleted,
      limit: vip.ordersLimit,
      vipRank: vip.rank,
    });
  } catch (err) {
    console.error("submitOrder error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

async function orderHistory(req, res) {
  try {
    const userId = req.user.userId;

    const orders = await UserOrder.find({ user: userId })
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ ok: true, orders });
  } catch (err) {
    console.error("orderHistory error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

async function currentOrder(req, res) {
  try {
    const userId = req.user.userId;

    const user = await User.findById(userId).lean();
    if (!user) {
      return res.status(404).json({ ok: false, message: "User not found" });
    }

    const ledgerTotal = await getLedgerTotal(user._id);
    const availableBalance = Number(user.balance || 0) + Number(ledgerTotal || 0);

    const pending = await UserOrder.findOne({
      user: userId,
      status: "PENDING",
    })
      .populate("poolOrder", "imageUrl")
      .lean();

    if (!pending) {
      return res.json({
        ok: true,
        pending: null,
        availableBalance,
      });
    }

    const stats = buildPendingStats(
      pending.price,
      pending.commission,
      availableBalance,
      pending.isBonus
    );

    return res.json({
      ok: true,
      pending: {
        status: pending.status,
        orderNumber: pending.orderNumber,
        orderName: pending.orderName,
        price: pending.price,
        commission: pending.commission,
        isBonus: pending.isBonus,
        imageUrl: pending.poolOrder?.imageUrl || "",
        availableBalance: stats.availableBalance,
        shortBalance: stats.shortBalance,
        pendingAmount: stats.pendingAmount,
      },
    });
  } catch (err) {
    console.error("currentOrder error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

module.exports = { searchFlights, submitOrder, orderHistory, currentOrder };