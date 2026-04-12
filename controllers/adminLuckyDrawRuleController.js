const User = require("../models/User");
const OrderPool = require("../models/OrderPool");
const LuckyDrawRule = require("../models/LuckyDrawRule");

// ✅ create or update lucky draw rule for one user + triggerCount
async function createLuckyDrawRule(req, res) {
  try {
    const {
      uid,
      triggerCount,
      rewardType,
      cashAmount,
      poolOrderId,
      title,
      description,
    } = req.body;

    if (!uid || !triggerCount || !rewardType) {
      return res.status(400).json({
        ok: false,
        message: "uid, triggerCount and rewardType are required",
      });
    }

    const cleanUid = String(uid).trim();
    const cleanTrigger = Number(triggerCount);

    if (!Number.isFinite(cleanTrigger) || cleanTrigger < 1) {
      return res.status(400).json({
        ok: false,
        message: "triggerCount must be a number >= 1",
      });
    }

    if (!["cash", "bonus_order"].includes(String(rewardType))) {
      return res.status(400).json({
        ok: false,
        message: 'rewardType must be "cash" or "bonus_order"',
      });
    }

    const user = await User.findOne({ uid: cleanUid }).select("_id uid");
    if (!user) {
      return res.status(404).json({
        ok: false,
        message: "User not found",
      });
    }

    let finalCashAmount = 0;
    let finalPoolOrder = null;

    if (rewardType === "cash") {
      finalCashAmount = Number(cashAmount);

      if (!Number.isFinite(finalCashAmount) || finalCashAmount <= 0) {
        return res.status(400).json({
          ok: false,
          message: "cashAmount must be > 0 for cash reward",
        });
      }
    }

    if (rewardType === "bonus_order") {
      if (!poolOrderId) {
        return res.status(400).json({
          ok: false,
          message: "poolOrderId is required for bonus_order reward",
        });
      }

      const poolOrder = await OrderPool.findById(poolOrderId).select(
        "_id orderNumber orderName isActive"
      );

      if (!poolOrder) {
        return res.status(404).json({
          ok: false,
          message: "Pool order not found",
        });
      }

      if (!poolOrder.isActive) {
        return res.status(400).json({
          ok: false,
          message: "Selected pool order is inactive",
        });
      }

      finalPoolOrder = poolOrder._id;
      finalCashAmount = 0;
    }

    const updated = await LuckyDrawRule.findOneAndUpdate(
      {
        user: user._id,
        triggerCount: cleanTrigger,
      },
      {
        $set: {
          rewardType,
          cashAmount: finalCashAmount,
          poolOrder: finalPoolOrder,
          title: title || "Lucky Draw",
          description: description || "Pick 1 egg and win your reward",
          isActive: true,
          popupShown: false,
          selectedEggIndex: null,
          claimedAt: null,
        },
      },
      {
        new: true,
        upsert: true,
      }
    )
      .populate("poolOrder")
      .populate("user", "_id uid");

    return res.json({
      ok: true,
      message: "Lucky draw rule saved",
      rule: updated,
    });
  } catch (err) {
    console.error("createLuckyDrawRule error:", err);
    return res.status(500).json({
      ok: false,
      message: err.message || "Server error",
    });
  }
}

// ✅ list lucky draw rules for one user by UID
async function listUserLuckyDrawRules(req, res) {
  try {
    const { userId } = req.params;

    const user = await User.findOne({ uid: String(userId).trim() }).select("_id uid");
    if (!user) {
      return res.status(404).json({
        ok: false,
        message: "User not found",
      });
    }

    const rules = await LuckyDrawRule.find({ user: user._id })
      .populate("poolOrder")
      .sort({ triggerCount: 1, createdAt: -1 })
      .lean();

    return res.json({
      ok: true,
      rules,
    });
  } catch (err) {
    console.error("listUserLuckyDrawRules error:", err);
    return res.status(500).json({
      ok: false,
      message: "Server error",
    });
  }
}

// ✅ disable lucky draw rule
async function disableLuckyDrawRule(req, res) {
  try {
    const { id } = req.params;

    const rule = await LuckyDrawRule.findById(id);
    if (!rule) {
      return res.status(404).json({
        ok: false,
        message: "Lucky draw rule not found",
      });
    }

    rule.isActive = false;
    await rule.save();

    return res.json({
      ok: true,
      message: "Lucky draw rule disabled",
      rule,
    });
  } catch (err) {
    console.error("disableLuckyDrawRule error:", err);
    return res.status(500).json({
      ok: false,
      message: "Server error",
    });
  }
}

// ✅ delete lucky draw rule
async function deleteLuckyDrawRule(req, res) {
  try {
    const { id } = req.params;

    const deleted = await LuckyDrawRule.findByIdAndDelete(id);
    if (!deleted) {
      return res.status(404).json({
        ok: false,
        message: "Lucky draw rule not found",
      });
    }

    return res.json({
      ok: true,
      message: "Lucky draw rule deleted",
    });
  } catch (err) {
    console.error("deleteLuckyDrawRule error:", err);
    return res.status(500).json({
      ok: false,
      message: "Server error",
    });
  }
}

module.exports = {
  createLuckyDrawRule,
  listUserLuckyDrawRules,
  disableLuckyDrawRule,
  deleteLuckyDrawRule,
};