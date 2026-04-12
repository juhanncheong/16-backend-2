const mongoose = require("mongoose");

const LuckyDrawRewardSchema = new mongoose.Schema(
  {
    slotIndex: {
      type: Number,
      required: true,
      min: 0,
      max: 2,
    },

    rewardType: {
      type: String,
      enum: ["cash", "bonus_order"],
      required: true,
    },

    cashAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    poolOrder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "OrderPool",
      default: null,
    },

    label: {
      type: String,
      default: "",
      trim: true,
    },
  },
  { _id: false }
);

const LuckyDrawCampaignSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    title: {
      type: String,
      default: "Lucky Draw",
      trim: true,
    },

    description: {
      type: String,
      default: "",
      trim: true,
    },

    rewards: {
      type: [LuckyDrawRewardSchema],
      required: true,
      validate: {
        validator: function (arr) {
          return Array.isArray(arr) && arr.length === 3;
        },
        message: "Lucky draw must contain exactly 3 rewards",
      },
    },

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    status: {
      type: String,
      enum: ["ACTIVE", "CLAIMED", "DISABLED"],
      default: "ACTIVE",
      index: true,
    },

    chosenIndex: {
      type: Number,
      default: null,
      min: 0,
      max: 2,
    },

    chosenRewardType: {
      type: String,
      enum: ["cash", "bonus_order", null],
      default: null,
    },

    chosenCashAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    chosenPoolOrder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "OrderPool",
      default: null,
    },

    claimedAt: {
      type: Date,
      default: null,
    },

    createdByAdmin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    note: {
      type: String,
      default: "",
      trim: true,
    },
  },
  { timestamps: true }
);

LuckyDrawCampaignSchema.pre("validate", function (next) {
  try {
    if (!Array.isArray(this.rewards) || this.rewards.length !== 3) {
      return next(new Error("Exactly 3 rewards are required"));
    }

    const usedSlots = new Set();

    for (const reward of this.rewards) {
      if (![0, 1, 2].includes(reward.slotIndex)) {
        return next(new Error("slotIndex must be 0, 1, or 2"));
      }

      if (usedSlots.has(reward.slotIndex)) {
        return next(new Error("slotIndex values must be unique"));
      }
      usedSlots.add(reward.slotIndex);

      if (reward.rewardType === "cash") {
        if (!Number.isFinite(Number(reward.cashAmount)) || Number(reward.cashAmount) <= 0) {
          return next(new Error("Cash reward must have cashAmount > 0"));
        }
        reward.poolOrder = null;
      }

      if (reward.rewardType === "bonus_order") {
        if (!reward.poolOrder) {
          return next(new Error("Bonus order reward must include poolOrder"));
        }
        reward.cashAmount = 0;
      }
    }

    next();
  } catch (err) {
    next(err);
  }
});

LuckyDrawCampaignSchema.index(
  { user: 1, isActive: 1, status: 1 },
  { name: "idx_user_active_status" }
);

module.exports = mongoose.model("LuckyDrawCampaign", LuckyDrawCampaignSchema);