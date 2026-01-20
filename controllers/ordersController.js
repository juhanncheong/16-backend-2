const mongoose = require("mongoose");
const User = require("../models/User");
const OrderPool = require("../models/OrderPool");
const BonusRule = require("../models/BonusRule");
const UserOrder = require("../models/UserOrder");

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

function calcCommission(price, isBonus) {
  const rate = isBonus ? 0.1 : 0.01;
  return Math.round(price * rate * 100) / 100;
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

async function searchFlights(req, res) {
  try {
    const userId = req.user.userId; // ✅ from protect()

    const user = await User.findById(userId).lean();
    if (!user) return res.status(404).json({ ok: false, message: "User not found" });

    if (user.isBanned) {
      return res.status(403).json({ ok: false, message: "User is banned" });
    }

    // ✅ hard cap
    if (user.ordersCompleted >= user.ordersLimit) {
      return res.status(403).json({
        ok: false,
        message: "Order limit reached. Contact admin.",
        completedOrders: user.ordersCompleted,
        limit: user.ordersLimit,
      });
    }

    // ✅ only 1 pending per user
    const existingPending = await UserOrder.findOne({
     user: userId,
     status: "PENDING",
   })
  .populate("poolOrder", "imageUrl")
  .lean();


    if (existingPending) {
      return res.json({
        ok: true,
        status: existingPending.status,
        orderNumber: existingPending.orderNumber,
        orderName: existingPending.orderName,
        price: existingPending.price,
        commission: existingPending.commission,
        isBonus: existingPending.isBonus,
        imageUrl: existingPending.poolOrder?.imageUrl || "",
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
  const balance = Number(user.balance || 0);

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

    const commission = calcCommission(selected.price, isBonus);

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

    return res.json({
      ok: true,
      status: created.status,
      orderNumber: created.orderNumber,
      orderName: created.orderName,
      price: created.price,
      commission: created.commission,
      isBonus: created.isBonus,
      imageUrl: selected.imageUrl || "",
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

    if (user.isBanned) {
      return res.status(403).json({ ok: false, message: "User is banned" });
    }

    if (user.ordersCompleted >= user.ordersLimit) {
      return res.status(403).json({ ok: false, message: "Order limit reached. Contact admin." });
    }

    const pending = await UserOrder.findOne({ user: userId, status: "PENDING" });
    if (!pending) {
      return res.status(400).json({ ok: false, message: "No pending order found" });
    }

    // ✅ insufficient points
    if (user.balance < pending.price) {
      return res.status(200).json({
        ok: false,
        message: "Insufficient points",
        required: pending.price,
        balance: user.balance,
      });
    }

    // ✅ ONLY reward commission (do not deduct price)
    user.balance += pending.commission;
    user.ordersCompleted += 1;

    pending.status = "COMPLETED";
    pending.completedAt = new Date();

    await user.save();
    await pending.save();

    return res.json({
      ok: true,
      message: "Order completed",
      newBalance: user.balance,
      commissionEarned: pending.commission,
      completedOrders: user.ordersCompleted,
      limit: user.ordersLimit,
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

module.exports = { searchFlights, submitOrder, orderHistory };
