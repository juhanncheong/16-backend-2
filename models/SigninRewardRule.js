const mongoose = require("mongoose");

const signinRewardRuleSchema = new mongoose.Schema(
  {
    // dayRewards[0] = Day 1 reward, dayRewards[1] = Day 2 reward ...
    dayRewards: {
      type: [Number],
      default: [300, 0, 0, 0, 0, 0], // Day1..Day6
    },

    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("SigninRewardRule", signinRewardRuleSchema);
