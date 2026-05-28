const mongoose = require("mongoose");

const bonusOfferTemplateSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },

    eventType: {
      type: String,
      enum: ["targeted", "anniversary", "entrepreneur"],
      required: true,
      index: true,
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

    updatedByAdmin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("BonusOfferTemplate", bonusOfferTemplateSchema);