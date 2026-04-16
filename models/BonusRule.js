const mongoose = require("mongoose");

const bonusRuleSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    triggerCount: { type: Number, required: true, min: 1 },
    poolOrder: { type: mongoose.Schema.Types.ObjectId, ref: "OrderPool", required: true },
    isActive: { type: Boolean, default: true },
    customCommissionRate: { type: Number, default: null, },
    useCustomCommissionRate: { type: Boolean, default: false, },
  },
  { timestamps: true }
);

bonusRuleSchema.index({ triggerCount: 1, isActive: 1 });
bonusRuleSchema.index({ user: 1, triggerCount: 1, isActive: 1 });

module.exports = mongoose.model("BonusRule", bonusRuleSchema);
