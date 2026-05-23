const mongoose = require("mongoose");

const ChatTabSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 40,
    },

    color: {
      type: String,
      default: "",
    },

    sortOrder: {
      type: Number,
      default: 0,
      index: true,
    },

    adminId: {
      type: String,
      default: "global",
      index: true,
    },
  },
  { timestamps: true, versionKey: false }
);

ChatTabSchema.index({ adminId: 1, name: 1 }, { unique: true });

module.exports = mongoose.model("ChatTab", ChatTabSchema);