const mongoose = require("mongoose");

const withdrawalSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },

    amount: { type: Number, required: true, min: 10 },

    paymentMethod: {
      type: String,
      enum: [
        "BTC_MAINNET",
        "ETH_ERC20",
        "SOL",
        "USDC_ERC20",
        "USDT_TRC20",
        "BANK_FASTER_PAYMENTS",
        "BANK_SEPA",
        "WISE",
        "UAEFTS",
      ],
      required: true,
    },

    cryptoType: {
      type: String,
      enum: ["BTC_MAINNET", "ETH_ERC20", "SOL", "USDC_ERC20", "USDT_TRC20"],
      default: null,
    },

    // crypto
    address: { type: String, default: "", trim: true },

    bankDetails: {
      accountName: { type: String, default: "", trim: true },
      bankName: { type: String, default: "", trim: true },
    
      // UK Faster Payments
      sortCode: { type: String, default: "", trim: true },
      accountNumber: { type: String, default: "", trim: true },
    
      // SEPA
      iban: { type: String, default: "", trim: true },
      bicSwift: { type: String, default: "", trim: true },
      country: { type: String, default: "", trim: true },
    
      // Wise
      wiseEmail: { type: String, default: "", trim: true },
    
      referenceNote: { type: String, default: "", trim: true },
    },

    status: {
      type: String,
      enum: ["PENDING", "APPROVED", "REJECTED"],
      default: "PENDING",
    },

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
withdrawalSchema.index({ paymentMethod: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model("Withdrawal", withdrawalSchema);