const mongoose = require("mongoose");

const targetedBonusOfferSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    title: {
      type: String,
      required: true,
      trim: true,
    },

    description: {
      type: String,
      required: true,
      trim: true,
    },

    eventType: {
      type: String,
      enum: ["targeted", "anniversary", "entrepreneur"],
      default: "targeted",
      index: true,
    },

    options: [
      {
        tierTitle: {
          type: String,
          default: "",
          trim: true,
        },
        depositAmount: {
          type: Number,
          required: true,
        },
        bonusAmount: {
          type: Number,
          required: true,
        },
        isFull: {
          type: Boolean,
          default: false,
        },
      },
    ],

    selectedOption: {
      tierTitle: {
        type: String,
        default: "",
        trim: true,
      },
      depositAmount: {
        type: Number,
        default: null,
      },
      bonusAmount: {
        type: Number,
        default: null,
      },
    },

    isReserved: {
      type: Boolean,
      default: false,
    },

    reservedAt: {
      type: Date,
      default: null,
    },

    status: {
      type: String,
      enum: ["active", "reserved", "cancelled"],
      default: "active",
    },

    createdByAdmin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    // ✅ Automation tracking
    automationKey: {
      type: String,
      default: "",
      trim: true,
      index: true,
    },

    triggeredByWithdrawal: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Withdrawal",
      default: null,
    },

    autoCreated: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

// ✅ Prevent duplicate automated entrepreneur event for same user
targetedBonusOfferSchema.index(
  { user: 1, automationKey: 1 },
  {
    unique: true,
    partialFilterExpression: {
      automationKey: { $eq: "entrepreneur_first_withdrawal" },
    },
  }
);

module.exports = mongoose.model("TargetedBonusOffer", targetedBonusOfferSchema);