const mongoose = require("mongoose");

const withdrawalMethodConfigSchema = new mongoose.Schema(
  {
    method: {
      type: String,
      enum: [
        "CRYPTO",
        "BANK_FASTER_PAYMENTS",
        "BANK_SEPA",
        "WISE",
        "UAEFTS",
        "VIP_UAEFTS",
      ],
      required: true,
      unique: true,
    },

    isAvailable: {
      type: Boolean,
      default: true,
    },

    // ✅ Admin global min withdrawal amount for this method
    minAmount: {
      type: Number,
      default: 10,
      min: 0,
    },

    // ✅ Admin global max withdrawal amount for this method
    maxAmount: {
      type: Number,
      default: 999999,
      min: 0,
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

// ✅ Prevent bad admin settings like min 5000, max 1000
withdrawalMethodConfigSchema.pre("validate", function (next) {
  const minAmount = Number(this.minAmount || 0);
  const maxAmount = Number(this.maxAmount || 0);

  if (maxAmount < minAmount) {
    return next(new Error("maxAmount must be greater than or equal to minAmount"));
  }

  next();
});

module.exports = mongoose.model(
  "WithdrawalMethodConfig",
  withdrawalMethodConfigSchema
);