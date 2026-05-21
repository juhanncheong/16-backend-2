const mongoose = require("mongoose");
const User = require("../models/User");
const OrderPool = require("../models/OrderPool");
const BonusRule = require("../models/BonusRule");
const UserOrder = require("../models/UserOrder");
const VipConfig = require("../models/VipConfig");
const WalletTransaction = require("../models/WalletTransaction");
const LuckyDrawRule = require("../models/LuckyDrawRule");
const OrderImageMap = require("../models/OrderImageMap");

async function getTrialBonusRemaining(userId) {
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
    .select("_id orderNumber orderName price imageUrl imageKey isActive")
    .lean();
}

let VIP_CONFIG_CACHE = null;
let VIP_CONFIG_CACHE_AT = 0;

async function getVipSettings(user) {
  const now = Date.now();

  if (!VIP_CONFIG_CACHE || now - VIP_CONFIG_CACHE_AT > 60000) {
    let config = await VipConfig.findOne().lean();

    if (!config) {
      config = await VipConfig.create({
        bonusCommissionRate: 0.1,
        ranks: [
          { rank: 1, ordersLimit: 40, commissionRate: 0.01 },
          { rank: 2, ordersLimit: 60, commissionRate: 0.015 },
          { rank: 3, ordersLimit: 80, commissionRate: 0.02 },
        ],
      });

      config = config.toObject ? config.toObject() : config;
    }

    VIP_CONFIG_CACHE = config;
    VIP_CONFIG_CACHE_AT = now;
  }

  const rank = Number(user.vipRank || 1);
  const vip =
    VIP_CONFIG_CACHE.ranks.find((r) => Number(r.rank) === rank) ||
    VIP_CONFIG_CACHE.ranks[0];

  return {
    ...vip,
    bonusCommissionRate: Number(VIP_CONFIG_CACHE.bonusCommissionRate ?? 0.1),
  };
}

let IMAGE_MAP_CACHE = new Map();
let IMAGE_MAP_CACHE_AT = 0;

async function refreshImageMapCache(force = false) {
  const now = Date.now();

  if (!force && now - IMAGE_MAP_CACHE_AT < 60000) return;

  const maps = await OrderImageMap.find({ isActive: true })
    .select("key imageUrl")
    .lean();

  IMAGE_MAP_CACHE = new Map(
    maps.map((m) => [String(m.key || "").trim().toLowerCase(), m.imageUrl])
  );

  IMAGE_MAP_CACHE_AT = now;
}

async function resolveOrderImage(order) {
  if (!order) return "";

  const key = String(order.imageKey || "").trim().toLowerCase();
  if (!key) return order.imageUrl || "";

  await refreshImageMapCache();

  return IMAGE_MAP_CACHE.get(key) || order.imageUrl || "";
}

async function searchFlights(req, res) {
  try {
    const userId = req.user.userId;

    const user = await User.findById(userId).lean();
    if (!user) return res.status(404).json({ ok: false, message: "User not found" });

    const vip = await getVipSettings(user);

    if (user.isBanned) {
      return res.status(403).json({ ok: false, message: "User is banned" });
    }

    const realBalance = Number(user.balance || 0);
    const trialBonusRemaining = await getTrialBonusRemaining(userId);
    const availableBalance = realBalance + trialBonusRemaining;

    const existingPending = await UserOrder.findOne({
      user: userId,
      status: "PENDING",
    })
      .populate("poolOrder", "imageUrl imageKey")
      .lean();

    if (existingPending) {
      const pendingImageUrl =
        existingPending.imageUrl || (await resolveOrderImage(existingPending.poolOrder));

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
        imageUrl: pendingImageUrl,
        availableBalance: stats.availableBalance,
        shortBalance: stats.shortBalance,
        pendingAmount: stats.pendingAmount,
      });
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

    const completedCount = Number(user.ordersCompleted ?? 0);
    const safeCompleted = Number.isFinite(completedCount) ? completedCount : 0;
    const nextCount = safeCompleted + 1;

    const luckyDrawRule = await LuckyDrawRule.findOne({
      user: userId,
      triggerCount: nextCount,
      isActive: true,
      claimedAt: null,
    }).lean();

    if (luckyDrawRule) {
      return res.json({
        ok: true,
        showLuckyDraw: true,
        luckyDraw: {
          ruleId: luckyDrawRule._id,
          triggerCount: luckyDrawRule.triggerCount,
          title: luckyDrawRule.title || "Lucky Draw",
          description:
            luckyDrawRule.description || "Pick 1 egg and win your reward",
        },
      });
    }

    const bonusRule = await BonusRule.findOne({
      user: userId,
      triggerCount: nextCount,
      isActive: true,
    })
      .populate("poolOrder")
      .lean();

    let selected = null;
    let isBonus = false;
    let bonusCommissionRateToUse = Number(vip.bonusCommissionRate ?? 0);

    if (bonusRule?.poolOrder?.isActive) {
      selected = bonusRule.poolOrder;
      isBonus = true;

      if (
        bonusRule.useCustomCommissionRate === true &&
        Number.isFinite(Number(bonusRule.customCommissionRate)) &&
        Number(bonusRule.customCommissionRate) >= 0
      ) {
        bonusCommissionRateToUse = Number(bonusRule.customCommissionRate);
      }
    } else {
      const balance = availableBalance;

      const min1 = Math.floor(balance * 0.5);
      const max1 = Math.floor(balance * 0.9);

      const min2 = Math.floor(balance * 0.3);
      const max2 = Math.floor(balance * 0.95);

      const min3 = Math.floor(balance * 0.1);
      const max3 = Math.floor(balance * 1.0);

      selected =
        (await pickRandomOrderFast(min1, max1)) ||
        (await pickRandomOrderFast(min2, max2)) ||
        (await pickRandomOrderFast(min3, max3));

      if (!selected) {
        return res.status(404).json({
          ok: false,
          message: "No available flights right now. Please top up and try again.",
        });
      }
    }

    const rateToUse = isBonus ? bonusCommissionRateToUse : vip.commissionRate;
    const commission = calcCommission(selected.price, rateToUse);

    const resolvedImageUrl = await resolveOrderImage(selected);

    const created = await UserOrder.create({
      user: userId,
      poolOrder: selected._id,
      status: "PENDING",
      orderNumber: selected.orderNumber,
      orderName: selected.orderName,
      price: selected.price,
      commission,
      isBonus,
      imageUrl: resolvedImageUrl,
      imageKey: selected.imageKey || "",
    });

    const stats = buildPendingStats(
      created.price,
      created.commission,
      availableBalance,
      created.isBonus
    );

    try {
      const io = req.app.get("io");
    
      io?.to("admins").emit("admin:userBalanceUpdated", {
        userId: user._id.toString(),
        user: {
          _id: user._id.toString(),
          phoneNumber: user.phoneNumber,
    
          // real balance stays same
          balance: Number(user.balance || 0),
    
          // this is what admin should display live
          displayBalance: Number(stats.shortBalance || 0),
          availableBalance: Number(stats.availableBalance || 0),
          shortBalance: Number(stats.shortBalance || 0),
          pendingAmount: Number(stats.pendingAmount || 0),
    
          role: user.role,
        },
      });
    } catch (socketErr) {
      console.error("searchFlights socket emit failed:", socketErr.message);
    }

    return res.json({
      ok: true,
      status: created.status,
      orderNumber: created.orderNumber,
      orderName: created.orderName,
      price: created.price,
      commission: created.commission,
      isBonus: created.isBonus,
      imageUrl: resolvedImageUrl,
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
    if (!user) {
      return res.status(404).json({ ok: false, message: "User not found" });
    }

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

    const pending = await UserOrder.findOne({
      user: userId,
      status: "PENDING",
    });

    if (!pending) {
      return res.status(400).json({
        ok: false,
        message: "No pending order found",
      });
    }

    const triggerCountUsed = Number(user.ordersCompleted || 0) + 1;

    // ✅ Check available balance: real balance + remaining trial bonus
    const realBalance = Number(user.balance || 0);
    const trialBonusRemaining = await getTrialBonusRemaining(userId);
    const availableBalance = realBalance + trialBonusRemaining;

    if (availableBalance < pending.price) {
      return res.status(200).json({
        ok: false,
        message: "Insufficient balance",
        required: pending.price,
        balance: availableBalance,
        realBalance,
        trialBonusRemaining,
      });
    }

    // ✅ ONLY reward commission, do not deduct order price
    user.balance += pending.commission;
    user.ordersCompleted += 1;

    pending.status = "COMPLETED";
    pending.completedAt = new Date();

    if (pending.isBonus) {
      await BonusRule.updateOne(
        {
          user: user._id,
          triggerCount: triggerCountUsed,
          poolOrder: pending.poolOrder,
          isActive: true,
        },
        {
          $set: { isActive: false },
        }
      );
    }

    // ✅ Auto trial reversal when user finishes required orders
    if (user.ordersCompleted >= vip.ordersLimit) {
      const trialRows = await WalletTransaction.aggregate([
        {
          $match: {
            userId: new mongoose.Types.ObjectId(user._id),
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

      let trialTotal = 0;
      let reversedTotal = 0;

      for (const row of trialRows) {
        if (row._id === "TRIAL_CREDIT") {
          trialTotal = Number(row.total || 0);
        }

        if (row._id === "TRIAL_REVERSAL") {
          reversedTotal = Math.abs(Number(row.total || 0));
        }
      }

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

    user.ordersLimit = vip.ordersLimit;

    await user.save();
    await pending.save();

    // ✅ Socket: notify admin panel balance + order count changed after user completed order
    try {
      const io = req.app.get("io");
    
      io?.to("admins").emit("admin:userBalanceUpdated", {
        userId: user._id.toString(),
        user: {
          _id: user._id.toString(),
          phoneNumber: user.phoneNumber,
          balance: Number(user.balance || 0),
          displayBalance: Number(user.balance || 0),
          availableBalance: Number(user.balance || 0),
          role: user.role,
        },
      });
    
      io?.to("admins").emit("admin:userOrdersUpdated", {
        userId: user._id.toString(),
        ordersCompleted: Number(user.ordersCompleted || 0),
        ordersLimit: Number(user.ordersLimit || vip.ordersLimit || 40),
      });
    } catch (socketErr) {
      console.error("submitOrder socket emit failed:", socketErr.message);
    }

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
  const startedAt = Date.now();

  try {
    const userId = req.user.userId;

    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limitRaw = Number.parseInt(req.query.limit, 10) || 10;
    const limit = Math.min(50, Math.max(1, limitRaw));
    const skip = (page - 1) * limit;

    const status = String(req.query.status || "").trim().toUpperCase();

    const query = { user: userId };

    if (status && ["PENDING", "COMPLETED"].includes(status)) {
      query.status = status;
    }

    console.time("HISTORY_FIND_AND_COUNT");

    const [orders, total] = await Promise.all([
      UserOrder.find(query)
        .select(
          "_id status orderNumber orderName price commission isBonus completedAt createdAt updatedAt imageUrl imageKey poolOrder"
        )
        .populate("poolOrder", "imageUrl imageKey")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),

      UserOrder.countDocuments(query),
    ]);

    console.timeEnd("HISTORY_FIND_AND_COUNT");

    console.time("HISTORY_NORMALIZE");

    const normalizedOrders = orders.map((order) => {
      const imageUrl =
        order.imageUrl ||
        order.poolOrder?.imageUrl ||
        "";

      return {
        _id: order._id,
        status: order.status,
        orderNumber: order.orderNumber,
        orderName: order.orderName,
        price: order.price,
        commission: order.commission,
        isBonus: order.isBonus,
        completedAt: order.completedAt,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
        imageUrl,
        imageKey: order.imageKey || order.poolOrder?.imageKey || "",
      };
    });

    console.timeEnd("HISTORY_NORMALIZE");

    console.log(`✅ /orders/history finished in ${Date.now() - startedAt}ms`);

    return res.json({
      ok: true,
      orders: normalizedOrders,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasPrev: page > 1,
        hasNext: page * limit < total,
      },
    });
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

    const availableBalance = Number(user.balance || 0);

    const pending = await UserOrder.findOne({
      user: userId,
      status: "PENDING",
    })
      .populate("poolOrder", "imageUrl imageKey")
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

    const pendingImageUrl =
      pending.imageUrl || (await resolveOrderImage(pending.poolOrder));

    return res.json({
      ok: true,
      pending: {
        status: pending.status,
        orderNumber: pending.orderNumber,
        orderName: pending.orderName,
        price: pending.price,
        commission: pending.commission,
        isBonus: pending.isBonus,
        imageUrl: pendingImageUrl,
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