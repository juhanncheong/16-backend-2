const mongoose = require("mongoose");

const adminNotificationSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: [ "DUPLICATE_WITHDRAWAL_ADDRESS", "DUPLICATE_REGISTER_IP", "NEW_WITHDRAWAL", ],
      required: true,
    },

    title: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },

    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    relatedUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    address: { type: String, default: "", trim: true },
    cryptoType: { type: String, default: "", trim: true },
    ip: { type: String, default: "", trim: true },

    isRead: { type: Boolean, default: false },
  },
  { timestamps: true }
);

adminNotificationSchema.index({ isRead: 1, createdAt: -1 });
adminNotificationSchema.index({ type: 1, createdAt: -1 });
adminNotificationSchema.index({
  type: 1,
  user: 1,
  relatedUser: 1,
  address: 1,
  cryptoType: 1,
});

module.exports = mongoose.model("AdminNotification", adminNotificationSchema);