const mongoose = require("mongoose");

const recentWithdrawalAddressSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    cryptoType: {
      type: String,
      enum: ["BTC_MAINNET", "ETH_ERC20", "SOL", "USDC_ERC20", "USDT_TRC20"],
      required: true,
    },
    address: {
      type: String,
      required: true,
      trim: true,
    },
    lastUsedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

recentWithdrawalAddressSchema.index(
  { user: 1, cryptoType: 1, address: 1 },
  { unique: true }
);

module.exports = mongoose.model(
  "RecentWithdrawalAddress",
  recentWithdrawalAddressSchema
);