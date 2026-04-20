const mongoose = require("mongoose");

const withdrawalMethodConfigSchema = new mongoose.Schema(
  {
    method: {
      type: String,
      enum: [
        "BTC_MAINNET",
        "ETH_ERC20",
        "SOL",
        "USDC_ERC20",
        "USDT_TRC20",
        "BANK_FASTER_PAYMENTS",
      ],
      required: true,
      unique: true,
    },
    isAvailable: {
      type: Boolean,
      default: true,
    },
    note: {
      type: String,
      default: "",
      trim: true,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    updatedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("WithdrawalMethodConfig", withdrawalMethodConfigSchema);