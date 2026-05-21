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

    options: [
      {
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
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("TargetedBonusOffer", targetedBonusOfferSchema);