const mongoose = require("mongoose");

const vipRankSchema = new mongoose.Schema(
  {
    rank: { type: Number, required: true }, // 1,2,3
    ordersLimit: { type: Number, required: true },
    commissionRate: { type: Number, required: true }, // 0.01 = 1%
    depositRequirement: { type: Number, required: true, default: 0 },
  },
  { _id: false }
);

const vipConfigSchema = new mongoose.Schema(
  {
    bonusCommissionRate: { type: Number, default: 0.1 },

    ranks: {
      type: [vipRankSchema],
      default: [
        {
          rank: 1,
          ordersLimit: 40,
          commissionRate: 0.01,
          depositRequirement: 50,
        },
        {
          rank: 2,
          ordersLimit: 60,
          commissionRate: 0.015,
          depositRequirement: 500,
        },
        {
          rank: 3,
          ordersLimit: 80,
          commissionRate: 0.02,
          depositRequirement: 5000,
        },
      ],
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("VipConfig", vipConfigSchema);