const mongoose = require("mongoose");

const PushSubscriptionSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      index: true,
    },

    endpoint: {
      type: String,
      required: true,
      unique: true,
    },

    keys: {
      p256dh: {
        type: String,
        required: true,
      },
      auth: {
        type: String,
        required: true,
      },
    },

    userAgent: {
      type: String,
      default: "",
    },

    active: {
      type: Boolean,
      default: true,
      index: true,
    },

    lastUsedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true, versionKey: false }
);

module.exports = mongoose.model("PushSubscription", PushSubscriptionSchema);