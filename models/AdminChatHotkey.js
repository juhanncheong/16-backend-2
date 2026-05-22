const mongoose = require("mongoose");

const AdminChatHotkeySchema = new mongoose.Schema(
  {
    adminId: { type: String, default: "global", index: true },

    label: {
      type: String,
      required: true,
      trim: true,
      maxlength: 40,
    },

    text: {
      type: String,
      required: true,
      trim: true,
      maxlength: 2000,
    },

    enabled: {
      type: Boolean,
      default: true,
    },

    sortOrder: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

module.exports = mongoose.model("AdminChatHotkey", AdminChatHotkeySchema);