const mongoose = require("mongoose");

const vipRankSchema = new mongoose.Schema(
  {
    rank: { type: Number, required: true }, // 1,2,3
    ordersLimit: { type: Number, required: true },
    commissionRate: { type: Number, required: true }, // example: 0.01 = 1%
  },
  { _id: false }
);

const vipConfigSchema = new mongoose.Schema(
  {
    ranks: {
      type: [vipRankSchema],
      default: [
        { rank: 1, ordersLimit: 40, commissionRate: 0.01 },
        { rank: 2, ordersLimit: 60, commissionRate: 0.015 },
        { rank: 3, ordersLimit: 80, commissionRate: 0.02 },
      ],
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("VipConfig", vipConfigSchema);
