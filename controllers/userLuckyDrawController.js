const mongoose = require("mongoose");
const LuckyDrawCampaign = require("../models/LuckyDrawCampaign");
const User = require("../models/User");

const UserOrder = require("../models/UserOrder");
const OrderPool = require("../models/OrderPool");
const VipConfig = require("../models/VipConfig");

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

async function grantBonusOrderReward({ user, reward, session }) {
  if (!reward.poolOrder) {
    throw new Error("Bonus reward is missing poolOrder");
  }

  // ✅ only 1 pending order allowed, same as your main flow
  const existingPending = await UserOrder.findOne({
    user: user._id,
    status: "PENDING",
  }).session(session);

  if (existingPending) {
    throw new Error("User already has a pending order");
  }

  const poolOrder = await OrderPool.findById(reward.poolOrder).session(session);
  if (!poolOrder || !poolOrder.isActive) {
    throw new Error("Selected bonus pool order is not available");
  }

  const vip = await getVipSettings(user);
  const commission = calcCommission(poolOrder.price, vip.bonusCommissionRate);

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

  return {
    ok: true,
    rewardType: "bonus_order",
    userOrderId: userOrder._id,
    poolOrder: poolOrder._id,
    orderNumber: userOrder.orderNumber,
    orderName: userOrder.orderName,
    price: userOrder.price,
    commission: userOrder.commission,
    status: userOrder.status,
    isBonus: true,
  };
}

// ✅ user gets active lucky draw
async function getMyActiveLuckyDraw(req, res) {
  try {
    const authUserId = req.user?.userId || req.user?._id;
    if (!authUserId) {
      return res.status(401).json({ ok: false, message: "Unauthorized" });
    }

    const campaign = await LuckyDrawCampaign.findOne({
      user: authUserId,
      isActive: true,
      status: "ACTIVE",
      chosenIndex: null,
      claimedAt: null,
    })
      .sort({ createdAt: -1 })
      .lean();

    if (!campaign) {
      return res.json({
        ok: true,
        hasLuckyDraw: false,
        campaign: null,
      });
    }

    // ✅ hide reward contents before user chooses
    const hiddenRewards = (campaign.rewards || [])
      .sort((a, b) => a.slotIndex - b.slotIndex)
      .map((r) => ({
        slotIndex: r.slotIndex,
        label: r.label || "",
      }));

    return res.json({
      ok: true,
      hasLuckyDraw: true,
      campaign: {
        _id: campaign._id,
        title: campaign.title,
        description: campaign.description,
        status: campaign.status,
        rewards: hiddenRewards,
        createdAt: campaign.createdAt,
      },
    });
  } catch (err) {
    console.error("getMyActiveLuckyDraw error:", err);
    return res.status(500).json({
      ok: false,
      message: "Server error",
    });
  }
}

// ✅ user picks 1 egg and gets reward exactly once
async function pickLuckyDrawReward(req, res) {
  const session = await mongoose.startSession();

  try {
    const authUserId = req.user?.userId || req.user?._id;
    if (!authUserId) {
      return res.status(401).json({ ok: false, message: "Unauthorized" });
    }

    const { campaignId } = req.params;
    const { slotIndex } = req.body;

    const pickedIndex = Number(slotIndex);

    if (![0, 1, 2].includes(pickedIndex)) {
      return res.status(400).json({
        ok: false,
        message: "slotIndex must be 0, 1, or 2",
      });
    }

    let responsePayload = null;

    await session.withTransaction(async () => {
      const user = await User.findById(authUserId).session(session);
      if (!user) {
        throw new Error("User not found");
      }

      const campaign = await LuckyDrawCampaign.findOne({
        _id: campaignId,
        user: authUserId,
      }).session(session);

      if (!campaign) {
        throw new Error("Lucky draw campaign not found");
      }

      if (!campaign.isActive || campaign.status !== "ACTIVE") {
        throw new Error("Lucky draw is not active");
      }

      if (campaign.chosenIndex !== null || campaign.claimedAt) {
        throw new Error("Lucky draw already claimed");
      }

      const reward = (campaign.rewards || []).find(
        (r) => Number(r.slotIndex) === pickedIndex
      );

      if (!reward) {
        throw new Error("Selected reward slot not found");
      }

      let rewardResult = null;

      if (reward.rewardType === "cash") {
        const amount = Number(reward.cashAmount || 0);

        if (!Number.isFinite(amount) || amount <= 0) {
          throw new Error("Invalid cash reward amount");
        }

        user.balance = Number(user.balance || 0) + amount;
        await user.save({ session });

        rewardResult = {
          rewardType: "cash",
          cashAmount: amount,
          newBalance: user.balance,
        };
      } else if (reward.rewardType === "bonus_order") {
        rewardResult = await grantBonusOrderReward({
          user,
          reward,
          session,
        });

        if (!rewardResult?.ok) {
          throw new Error("Failed to grant bonus order reward");
        }
      } else {
        throw new Error("Unsupported reward type");
      }

      campaign.chosenIndex = pickedIndex;
      campaign.chosenRewardType = reward.rewardType;
      campaign.chosenCashAmount =
        reward.rewardType === "cash" ? Number(reward.cashAmount || 0) : 0;
      campaign.chosenPoolOrder =
        reward.rewardType === "bonus_order" ? reward.poolOrder || null : null;
      campaign.claimedAt = new Date();
      campaign.status = "CLAIMED";
      campaign.isActive = false;

      await campaign.save({ session });

      responsePayload = {
        ok: true,
        message: "Lucky draw reward claimed successfully",
        reward: rewardResult,
        campaign: {
          _id: campaign._id,
          status: campaign.status,
          chosenIndex: campaign.chosenIndex,
          chosenRewardType: campaign.chosenRewardType,
          chosenCashAmount: campaign.chosenCashAmount,
          chosenPoolOrder: campaign.chosenPoolOrder,
          claimedAt: campaign.claimedAt,
        },
      };
    });

    return res.json(responsePayload);
  } catch (err) {
    console.error("pickLuckyDrawReward error:", err);
    return res.status(400).json({
      ok: false,
      message: err.message || "Failed to claim reward",
    });
  } finally {
    await session.endSession();
  }
}

module.exports = {
  getMyActiveLuckyDraw,
  pickLuckyDrawReward,
};