const mongoose = require("mongoose");
const User = require("../models/User");
const UserOrder = require("../models/UserOrder");
const OrderPool = require("../models/OrderPool");
const LuckyDrawRule = require("../models/LuckyDrawRule");
const VipConfig = require("../models/VipConfig");
const WalletTransaction = require("../models/WalletTransaction");
  
function calcCommission(price, rate) {
  return Math.round(Number(price || 0) * Number(rate || 0) * 100) / 100;
}

async function getVipSettings(user) {
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
  }

  const rank = Number(user.vipRank || 1);
  const vip = config.ranks.find((r) => r.rank === rank) || config.ranks[0];

  return {
    ...vip,
    bonusCommissionRate: Number(config.bonusCommissionRate ?? 0.1),
  };
}

// ✅ get active lucky draw for the user's next order count
async function getMyLuckyDraw(req, res) {
  try {
    const authUserId = req.user?.userId || req.user?._id;
    if (!authUserId) {
      return res.status(401).json({ ok: false, message: "Unauthorized" });
    }

    const user = await User.findById(authUserId).select("_id ordersCompleted");
    if (!user) {
      return res.status(404).json({ ok: false, message: "User not found" });
    }

    const nextCount = Number(user.ordersCompleted || 0) + 1;

    const rule = await LuckyDrawRule.findOne({
      user: user._id,
      triggerCount: nextCount,
      isActive: true,
      claimedAt: null,
    }).lean();

    if (!rule) {
      return res.json({
        ok: true,
        hasLuckyDraw: false,
        luckyDraw: null,
      });
    }

    return res.json({
      ok: true,
      hasLuckyDraw: true,
      luckyDraw: {
        ruleId: rule._id,
        triggerCount: rule.triggerCount,
        title: rule.title || "Lucky Draw",
        description: rule.description || "Pick 1 egg and win your reward",
      },
    });
  } catch (err) {
    console.error("getMyLuckyDraw error:", err);
    return res.status(500).json({
      ok: false,
      message: "Server error",
    });
  }
}

// ✅ user picks any egg, but reward is fixed by admin
async function claimLuckyDraw(req, res) {
  const session = await mongoose.startSession();

  try {
    const authUserId = req.user?.userId || req.user?._id;
    if (!authUserId) {
      return res.status(401).json({ ok: false, message: "Unauthorized" });
    }

    const { ruleId } = req.params;
    const pickedIndex = Number(req.body?.selectedEggIndex);

    if (![0, 1, 2].includes(pickedIndex)) {
      return res.status(400).json({
        ok: false,
        message: "selectedEggIndex must be 0, 1, or 2",
      });
    }

    let responsePayload = null;

    await session.withTransaction(async () => {
      const user = await User.findById(authUserId).session(session);
      if (!user) {
        throw new Error("User not found");
      }

      const nextCount = Number(user.ordersCompleted || 0) + 1;

      const rule = await LuckyDrawRule.findOne({
        _id: ruleId,
        user: user._id,
        triggerCount: nextCount,
      }).session(session);

      if (!rule) {
        throw new Error("Lucky draw rule not found");
      }

      if (!rule.isActive) {
        throw new Error("Lucky draw is not active");
      }

      if (rule.claimedAt) {
        throw new Error("Lucky draw already claimed");
      }

      let rewardResult = null;

      if (rule.rewardType === "cash") {
        const amount = Number(rule.cashAmount || 0);

        if (!Number.isFinite(amount) || amount <= 0) {
          throw new Error("Invalid cash reward amount");
        }

        const before = Number(user.balance || 0);
        const after = before + amount;

        user.balance = after;
        await user.save({ session });

        await WalletTransaction.create(
          [
            {
              userId: user._id,
              type: "LUCKY_DRAW_CASH",
              amount,
              balanceBefore: before,
              balanceAfter: after,
              note: `Lucky draw reward at order ${rule.triggerCount}`,
              relatedOrderId: null,
            },
          ],
          { session }
        );

        rewardResult = {
          rewardType: "cash",
          cashAmount: amount,
          newBalance: user.balance,
        };
      } else if (rule.rewardType === "bonus_order") {
        const existingPending = await UserOrder.findOne({
          user: user._id,
          status: "PENDING",
        }).session(session);

        if (existingPending) {
          throw new Error("User already has a pending order");
        }

        const poolOrder = await OrderPool.findById(rule.poolOrder).session(session);
        if (!poolOrder || !poolOrder.isActive) {
          throw new Error("Selected bonus pool order is not available");
        }

        const vip = await getVipSettings(user);

        const rateToUse =
          rule.bonusCommissionRateOverride !== undefined &&
          rule.bonusCommissionRateOverride !== null
            ? Number(rule.bonusCommissionRateOverride)
            : Number(vip.bonusCommissionRate);

        const commission = calcCommission(poolOrder.price, rateToUse);

        const created = await UserOrder.create(
          [
            {
              user: user._id,
              poolOrder: poolOrder._id,
              status: "PENDING",
              orderNumber: poolOrder.orderNumber,
              orderName: poolOrder.orderName,
              price: poolOrder.price,
              commission,
              isBonus: true,
            },
          ],
          { session }
        );

        const userOrder = created[0];

        rewardResult = {
          rewardType: "bonus_order",
          userOrderId: userOrder._id,
          orderNumber: userOrder.orderNumber,
          orderName: userOrder.orderName,
          price: userOrder.price,
          commission: userOrder.commission,
          bonusCommissionRateUsed: rateToUse,
          status: userOrder.status,
          isBonus: true,
        };
      } else {
        throw new Error("Unsupported reward type");
      }

      rule.popupShown = true;
      rule.selectedEggIndex = pickedIndex;
      rule.claimedAt = new Date();
      rule.isActive = false;

      await rule.save({ session });

      responsePayload = {
        ok: true,
        message: "Lucky draw claimed successfully",
        reward: rewardResult,
        luckyDraw: {
          ruleId: rule._id,
          triggerCount: rule.triggerCount,
          selectedEggIndex: rule.selectedEggIndex,
          claimedAt: rule.claimedAt,
          rewardType: rule.rewardType,
        },
      };
    });

    return res.json(responsePayload);
  } catch (err) {
    console.error("claimLuckyDraw error:", err);
    return res.status(400).json({
      ok: false,
      message: err.message || "Failed to claim lucky draw",
    });
  } finally {
    await session.endSession();
  }
}

module.exports = {
  getMyLuckyDraw,
  claimLuckyDraw,
};