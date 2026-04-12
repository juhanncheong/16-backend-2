const mongoose = require("mongoose");

const luckyDrawRuleSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    triggerCount: {
      type: Number,
      required: true,
      min: 1,
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

    title: {
      type: String,
      default: "Lucky Draw",
      trim: true,
    },

    description: {
      type: String,
      default: "Pick 1 egg and win your reward",
      trim: true,
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    popupShown: {
      type: Boolean,
      default: false,
    },

    selectedEggIndex: {
      type: Number,
      default: null,
      min: 0,
      max: 2,
    },

    claimedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

luckyDrawRuleSchema.pre("validate", function (next) {
  try {
    if (this.rewardType === "cash") {
      if (!Number.isFinite(Number(this.cashAmount)) || Number(this.cashAmount) <= 0) {
        return next(new Error("Cash reward must have cashAmount > 0"));
      }
      this.poolOrder = null;
    }

    if (this.rewardType === "bonus_order") {
      if (!this.poolOrder) {
        return next(new Error("Bonus order reward must include poolOrder"));
      }
      this.cashAmount = 0;
    }

    next();
  } catch (err) {
    next(err);
  }
});

luckyDrawRuleSchema.index(
  { user: 1, triggerCount: 1 },
  { unique: true, name: "uniq_user_trigger_luckydraw" }
);

module.exports = mongoose.model("LuckyDrawRule", luckyDrawRuleSchema);