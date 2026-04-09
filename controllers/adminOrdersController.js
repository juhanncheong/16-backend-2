const mongoose = require("mongoose");
const User = require("../models/User");
const OrderPool = require("../models/OrderPool");
const BonusRule = require("../models/BonusRule");
const UserOrder = require("../models/UserOrder");

// ✅ add order to pool
async function createPoolOrder(req, res) {
  try {
    const { orderNumber, orderName, price, imageUrl } = req.body;

    const created = await OrderPool.create({
      orderNumber,
      orderName,
      price,
      imageUrl,
      isActive: true,
    });

    return res.json({ ok: true, order: created });
  } catch (err) {
    console.error("createPoolOrder error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

// ✅ list pool orders (for admin pool page)
async function listPoolOrders(req, res) {
  try {
    const orders = await OrderPool.find().sort({ createdAt: -1 }).lean();
    return res.json({ ok: true, orders });
  } catch (err) {
    console.error("listPoolOrders error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

// ✅ toggle active/inactive
async function togglePoolOrder(req, res) {
  try {
    const { id } = req.params;

    const order = await OrderPool.findById(id);
    if (!order) return res.status(404).json({ ok: false, message: "Order not found" });

    order.isActive = !order.isActive;
    await order.save();

    return res.json({ ok: true, message: "Updated", order });
  } catch (err) {
    console.error("togglePoolOrder error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

/**
 * ✅ create/update bonus rule (USER-SPECIFIC)
 * Body:
 *  - userId (required)
 *  - triggerCount (required)
 *  - poolOrderId (required)
 *
 * ✅ IMPORTANT:
 * - We UPSERT (update if exists) by (userId + triggerCount)
 * - So admin can change the assigned order without creating duplicates
 */
async function createBonusRule(req, res) {
  try {
    const { uid, triggerCount, poolOrderId } = req.body;

    if (!uid || !triggerCount || !poolOrderId) {
      return res.status(400).json({
        ok: false,
        message: "uid, triggerCount, poolOrderId are required",
      });
    }

    const cleanUid = String(uid).trim();

    const user = await User.findOne({ uid: cleanUid });
    if (!user) {
      return res.status(404).json({ ok: false, message: "User not found" });
    }

    const poolOrder = await OrderPool.findById(poolOrderId);
    if (!poolOrder) return res.status(404).json({ ok: false, message: "Pool order not found" });

    // ✅ Upsert bonus rule for this specific user + triggerCount
    const updated = await BonusRule.findOneAndUpdate(
      { user: user._id, triggerCount: Number(triggerCount) },
      {
        $set: {
          poolOrder: poolOrder._id,
          isActive: true,
        },
      },
      { new: true, upsert: true }
    );

    return res.json({ ok: true, bonusRule: updated });
  } catch (err) {
    console.error("createBonusRule error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

// ✅ list bonus rules for a specific user + REAL status
async function listUserBonusRules(req, res) {
  try {
    const { userId } = req.params;

    const user = await User.findOne({ uid: String(userId).trim() }).select("_id uid");
    if (!user) {
      return res.status(404).json({ ok: false, message: "User not found" });
    }

    const rules = await BonusRule.find({ user: user._id })
      .populate("poolOrder")
      .sort({ triggerCount: 1 })
      .lean();

    // 2) Compute REAL status using UserOrder
    const poolOrderIds = rules
      .map((r) => r.poolOrder?._id)
      .filter(Boolean)
      .map((id) => id.toString());

    let userOrders = [];
    if (poolOrderIds.length) {
      userOrders = await UserOrder.find({
        user: user._id,
        isBonus: true,
        poolOrder: { $in: poolOrderIds },
      })
        .sort({ createdAt: -1 })
        .lean();
    }

    // Map latest UserOrder per poolOrder
    const latestByPoolOrder = new Map();
    for (const uo of userOrders) {
      const key = String(uo.poolOrder);
      if (!latestByPoolOrder.has(key)) latestByPoolOrder.set(key, uo);
    }

    const rulesWithStatus = rules.map((r) => {
      const poolId = r.poolOrder?._id ? String(r.poolOrder._id) : null;
      const hit = poolId ? latestByPoolOrder.get(poolId) : null;

      let status = "ACTIVE";
      if (hit?.status === "PENDING") status = "PENDING";
      if (hit?.status === "COMPLETED") status = "COMPLETED";

      return {
        ...r,
        status,
        userOrderId: hit?._id || null,
      };
    });

    return res.json({ ok: true, rules: rulesWithStatus });
  } catch (err) {
    console.error("listUserBonusRules error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

// ✅ disable bonus rule
async function disableBonusRule(req, res) {
  try {
    const { id } = req.params;

    const rule = await BonusRule.findById(id);
    if (!rule) return res.status(404).json({ ok: false, message: "Bonus rule not found" });

    rule.isActive = false;
    await rule.save();

    return res.json({ ok: true, message: "Disabled", rule });
  } catch (err) {
    console.error("disableBonusRule error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

// ✅ reset user orders (admin only)
async function resetUserOrders(req, res) {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ ok: false, message: "User not found" });

    user.ordersCompleted = 0;
    user.totalResetCount = Number(user.totalResetCount || 1) + 1;
    await user.save();

    // ✅ remove pending orders so user can search again
    // Status enum in UserOrder is: PENDING / COMPLETED
    await UserOrder.deleteMany({ user: userId, status: "PENDING" });

    return res.json({
      ok: true,
      message: "User order count reset to 0/40",
      ordersCompleted: user.ordersCompleted,
      ordersLimit: user.ordersLimit,
    });
  } catch (err) {
    console.error("resetUserOrders error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

// ✅ update order in pool (edit)
async function updatePoolOrder(req, res) {
  try {
    const { id } = req.params;
    const { orderNumber, orderName, price, imageUrl, isActive } = req.body;

    const order = await OrderPool.findById(id);
    if (!order) return res.status(404).json({ ok: false, message: "Order not found" });

    // ✅ only update fields that exist
    if (orderNumber !== undefined) order.orderNumber = String(orderNumber).trim();
    if (orderName !== undefined) order.orderName = String(orderName).trim();
    if (price !== undefined) order.price = Number(price);
    if (imageUrl !== undefined) order.imageUrl = String(imageUrl).trim();
    if (isActive !== undefined) order.isActive = Boolean(isActive);

    await order.save();

    return res.json({ ok: true, message: "Order updated", order });
  } catch (err) {
    console.error("updatePoolOrder error:", err);

    // ✅ duplicate orderNumber error
    if (err.code === 11000) {
      return res.status(400).json({
        ok: false,
        message: "Order number already exists. Please use another one.",
      });
    }

    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

// ✅ delete order from pool
async function deletePoolOrder(req, res) {
  try {
    const { id } = req.params;

    const deleted = await OrderPool.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ ok: false, message: "Order not found" });

    return res.json({ ok: true, message: "Order deleted" });
  } catch (err) {
    console.error("deletePoolOrder error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

// ✅ admin set user ordersCompleted to any number
async function setUserOrdersCount(req, res) {
  try {
    const { userId } = req.params;
    const { ordersCompleted } = req.body;

    const num = Number(ordersCompleted);

    if (!Number.isFinite(num) || num < 0) {
      return res.status(400).json({
        ok: false,
        message: "ordersCompleted must be a number >= 0",
      });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ ok: false, message: "User not found" });

    // ✅ optional: clamp to ordersLimit (recommended)
    const limit = Number(user.ordersLimit ?? 40);
    const finalValue = num > limit ? limit : Math.floor(num);

    user.ordersCompleted = finalValue;
    await user.save();

    // ✅ If setting count back, remove pending so they can continue
    await UserOrder.deleteMany({ user: userId, status: "PENDING" });

    return res.json({
      ok: true,
      message: `✅ User ordersCompleted set to ${finalValue}/${limit}`,
      ordersCompleted: user.ordersCompleted,
      ordersLimit: user.ordersLimit,
    });
  } catch (err) {
    console.error("setUserOrdersCount error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

// ✅ admin set user totalResetCount (round number)
async function setUserResetCount(req, res) {
  try {
    const { userId } = req.params;
    const { totalResetCount } = req.body;

    const num = Number(totalResetCount);

    if (!Number.isFinite(num) || num < 1) {
      return res.status(400).json({
        ok: false,
        message: "totalResetCount must be a number >= 1",
      });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ ok: false, message: "User not found" });

    user.totalResetCount = Math.floor(num);
    await user.save();

    return res.json({
      ok: true,
      message: `✅ User totalResetCount set to ${user.totalResetCount}`,
      totalResetCount: user.totalResetCount,
    });
  } catch (err) {
    console.error("setUserResetCount error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

module.exports = {
  createPoolOrder,
  listPoolOrders,
  togglePoolOrder,
  updatePoolOrder,
  deletePoolOrder,
  createBonusRule,
  listUserBonusRules,
  disableBonusRule,
  resetUserOrders,
  setUserOrdersCount,
  setUserResetCount,
};
