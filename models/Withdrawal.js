const mongoose = require("mongoose");

const withdrawalSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    amount: { type: Number, required: true, min: 10 },

    cryptoType: {
      type: String,
      enum: ["BTC_MAINNET", "ETH_ERC20", "SOL", "USDC_ERC20", "USDT_TRC20"],
      required: true,
    },

    address: { type: String, required: true, trim: true },

    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED"],
      default: "PENDING",
    },

    // Optional: helps for logs/auditing
    balanceBefore: { type: Number, default: null },
    balanceAfter: { type: Number, default: null },

    adminActionBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    adminNote: { type: String, default: "" },
    actionAt: { type: Date, default: null },
  },
  { timestamps: true }
);

withdrawalSchema.index({ user: 1, status: 1 });
withdrawalSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model("Withdrawal", withdrawalSchema);
