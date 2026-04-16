const mongoose = require("mongoose");
const User = require("../models/User");
const OrderPool = require("../models/OrderPool");
const BonusRule = require("../models/BonusRule");
const UserOrder = require("../models/UserOrder");
const OrderImageMap = require("../models/OrderImageMap");
const VipConfig = require("../models/VipConfig");

// ✅ add order to pool
async function createPoolOrder(req, res) {
  try {
    const { orderNumber, orderName, price, imageUrl, imageKey } = req.body;

    const finalImageKey =
      String(imageKey || "").trim() || getImageKeyFromOrderName(orderName);

    const created = await OrderPool.create({
      orderNumber,
      orderName,
      price,
      imageUrl: String(imageUrl || "").trim(), // fallback only
      imageKey: finalImageKey,
      isActive: true,
    });

    return res.json({ ok: true, order: created });
  } catch (err) {
    console.error("createPoolOrder error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

function normalizeImageKey(value = "") {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
}

function getImageKeyFromOrderName(orderName = "") {
  const left = String(orderName).split("–")[0]?.split("->")[0]?.split("→")[0]?.trim() || "";
  return normalizeImageKey(left);
}

async function createOrderImageMap(req, res) {
  try {
    const { key, imageUrl } = req.body;

    if (!key || !imageUrl) {
      return res.status(400).json({
        ok: false,
        message: "key and imageUrl are required",
      });
    }

    const created = await OrderImageMap.create({
      key: String(key).trim().toLowerCase(),
      imageUrl: String(imageUrl).trim(),
      isActive: true,
    });

    return res.json({ ok: true, map: created });
  } catch (err) {
    console.error("createOrderImageMap error:", err);

    if (err.code === 11000) {
      return res.status(400).json({
        ok: false,
        message: "Key already exists",
      });
    }

    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

async function listOrderImageMaps(req, res) {
  try {
    const maps = await OrderImageMap.find().sort({ createdAt: -1 }).lean();
    return res.json({ ok: true, maps });
  } catch (err) {
    console.error("listOrderImageMaps error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

async function updateOrderImageMap(req, res) {
  try {
    const { id } = req.params;
    const { key, imageUrl, isActive } = req.body;

    const map = await OrderImageMap.findById(id);
    if (!map) {
      return res.status(404).json({ ok: false, message: "Image map not found" });
    }

    if (key !== undefined) map.key = String(key).trim().toLowerCase();
    if (imageUrl !== undefined) map.imageUrl = String(imageUrl).trim();
    if (isActive !== undefined) map.isActive = Boolean(isActive);

    await map.save();

    return res.json({ ok: true, map });
  } catch (err) {
    console.error("updateOrderImageMap error:", err);

    if (err.code === 11000) {
      return res.status(400).json({
        ok: false,
        message: "Key already exists",
      });
    }

    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

async function deleteOrderImageMap(req, res) {
  try {
    const { id } = req.params;

    const deleted = await OrderImageMap.findByIdAndDelete(id);
    if (!deleted) {
      return res.status(404).json({ ok: false, message: "Image map not found" });
    }

    return res.json({ ok: true, message: "Image map deleted" });
  } catch (err) {
    console.error("deleteOrderImageMap error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
}

// ✅ list pool orders (for admin pool page)
async function listPoolOrders(req, res) {
  try {
    const orders = await OrderPool.find().sort({ createdAt: -1 }).lean();
    const maps = await OrderImageMap.find({ isActive: true }).lean();

    const mapByKey = new Map(
      maps.map((m) => [String(m.key).trim().toLowerCase(), m.imageUrl || ""])
    );

    const enriched = orders.map((o) => {
      const resolvedImageUrl =
        mapByKey.get(String(o.imageKey || "").trim().toLowerCase()) ||
        o.imageUrl ||
        "";

      return {
        ...o,
        resolvedImageUrl,
      };
    });

    return res.json({ ok: true, orders: enriched });
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
    const {
      uid,
      triggerCount,
      poolOrderId,
      useCustomCommissionRate,
      customCommissionRate,
    } = req.body;

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
    if (!poolOrder) {
      return res.status(404).json({ ok: false, message: "Pool order not found" });
    }

    const useCustom = Boolean(useCustomCommissionRate);

    let finalCustomRate = null;
    if (useCustom) {
      const parsedRate = Number(customCommissionRate);

      if (!Number.isFinite(parsedRate) || parsedRate < 0) {
        return res.status(400).json({
          ok: false,
          message: "customCommissionRate must be a number >= 0 when useCustomCommissionRate is true",
        });
      }

      finalCustomRate = parsedRate;
    }

    const updated = await BonusRule.findOneAndUpdate(
      { user: user._id, triggerCount: Number(triggerCount) },
      {
        $set: {
          poolOrder: poolOrder._id,
          isActive: true,
          useCustomCommissionRate: useCustom,
          customCommissionRate: finalCustomRate,
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

    let vipConfig = await VipConfig.findOne().lean();
    if (!vipConfig) {
      vipConfig = await VipConfig.create({});
    }

    const globalBonusCommissionRate = Number(vipConfig?.bonusCommissionRate ?? 0);

    const rules = await BonusRule.find({ user: user._id })
      .populate("poolOrder")
      .sort({ triggerCount: 1 })
      .lean();

    const poolOrderIds = rules
      .map((r) => r.poolOrder?._id)
      .filter(Boolean)
      .map((id) => id.toString());

    let pendingOrders = [];
    if (poolOrderIds.length) {
      pendingOrders = await UserOrder.find({
        user: user._id,
        isBonus: true,
        status: "PENDING",
        poolOrder: { $in: poolOrderIds },
      }).lean();
    }

    const pendingByPoolOrder = new Map();
    for (const uo of pendingOrders) {
      pendingByPoolOrder.set(String(uo.poolOrder), uo);
    }

    const rulesWithStatus = rules.map((r) => {
      const poolId = r.poolOrder?._id ? String(r.poolOrder._id) : null;
      const pendingHit = poolId ? pendingByPoolOrder.get(poolId) : null;

      let status = "ACTIVE";
      if (r.isActive === false) status = "COMPLETED";
      else if (pendingHit) status = "PENDING";

      const hasCustomRate =
        r.useCustomCommissionRate === true &&
        Number.isFinite(Number(r.customCommissionRate)) &&
        Number(r.customCommissionRate) >= 0;

      const finalCommissionRate = hasCustomRate
        ? Number(r.customCommissionRate)
        : globalBonusCommissionRate;

      return {
        ...r,
        status,
        userOrderId: pendingHit?._id || null,
        commissionSource: hasCustomRate ? "CUSTOM" : "GLOBAL",
        finalCommissionRate,
        globalBonusCommissionRate,
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

// ✅ delete bonus rule
async function deleteBonusRule(req, res) {
  try {
    const { id } = req.params;

    const deleted = await BonusRule.findByIdAndDelete(id);
    if (!deleted) {
      return res.status(404).json({
        ok: false,
        message: "Bonus rule not found",
      });
    }

    return res.json({
      ok: true,
      message: "Bonus rule deleted",
    });
  } catch (err) {
    console.error("deleteBonusRule error:", err);
    return res.status(500).json({
      ok: false,
      message: "Server error",
    });
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
    const { orderNumber, orderName, price, imageUrl, imageKey, isActive } = req.body;

    const order = await OrderPool.findById(id);
    if (!order) {
      return res.status(404).json({ ok: false, message: "Order not found" });
    }

    if (orderNumber !== undefined) order.orderNumber = String(orderNumber).trim();
    if (orderName !== undefined) order.orderName = String(orderName).trim();
    if (price !== undefined) order.price = Number(price);
    if (imageUrl !== undefined) order.imageUrl = String(imageUrl).trim();
    if (imageKey !== undefined) {
      order.imageKey = String(imageKey).trim() || getImageKeyFromOrderName(order.orderName);
    }
    if (isActive !== undefined) order.isActive = Boolean(isActive);

    await order.save();

    return res.json({ ok: true, message: "Order updated", order });
  } catch (err) {
    console.error("updatePoolOrder error:", err);

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
  deleteBonusRule,
  resetUserOrders,
  setUserOrdersCount,
  setUserResetCount,
  createOrderImageMap,
  listOrderImageMaps,
  updateOrderImageMap,
  deleteOrderImageMap,
};
