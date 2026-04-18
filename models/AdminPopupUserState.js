const mongoose = require("mongoose");

const adminPopupUserStateSchema = new mongoose.Schema(
  {
    popupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "AdminPopup",
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    hiddenUntil: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

adminPopupUserStateSchema.index({ popupId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model("AdminPopupUserState", adminPopupUserStateSchema);