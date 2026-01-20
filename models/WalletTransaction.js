const mongoose = require("mongoose");

const walletTransactionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    type: {
      type: String,
      enum: ["DEPOSIT", "COMMISSION", "ADMIN_ADJUST", "ORDER_SUBMIT"],
      required: true,
    },

    amount: { type: Number, required: true }, // can be + or -
    balanceBefore: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },

    note: { type: String, default: "" },

    relatedOrderId: { type: mongoose.Schema.Types.ObjectId, ref: "UserOrder", default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("WalletTransaction", walletTransactionSchema);
