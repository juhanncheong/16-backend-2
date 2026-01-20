const mongoose = require("mongoose");

const signinClaimSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    localDate: {
      type: String,
      required: true,
      index: true,
    },

    timezone: {
      type: String,
      default: "UTC",
    },

    streakDay: {
      type: Number, // 1..6
      required: true,
    },

    rewardAmount: {
      type: Number,
      required: true,
    },
  },
  { timestamps: true }
);

signinClaimSchema.index({ userId: 1, localDate: 1 }, { unique: true });

module.exports = mongoose.model("SigninClaim", signinClaimSchema);
