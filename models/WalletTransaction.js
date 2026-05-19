const mongoose = require("mongoose");

const walletTransactionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    type: {
      type: String,
      enum: [
        "DEPOSIT",
        "BONUS",
        "BORROW",
        "COMMISSION",
        "ADMIN_ADJUST",
        "ORDER_SUBMIT",
        "TRIAL_CREDIT",
        "TRIAL_REVERSAL",
        "LUCKY_DRAW_CASH",
      ],
      required: true,
    },

    amount: { type: Number, required: true },
    balanceBefore: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },

    note: { type: String, default: "" },

    relatedOrderId: { type: mongoose.Schema.Types.ObjectId, ref: "UserOrder", default: null },
  },
  { timestamps: true }
);

walletTransactionSchema.index({ userId: 1, type: 1, createdAt: -1 });

module.exports = mongoose.model("WalletTransaction", walletTransactionSchema);