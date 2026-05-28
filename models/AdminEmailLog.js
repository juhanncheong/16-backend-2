const mongoose = require("mongoose");

const adminEmailLogSchema = new mongoose.Schema(
  {
    templateKey: {
      type: String,
      required: true,
      trim: true,
    },

    templateName: {
      type: String,
      default: "",
      trim: true,
    },

    subject: {
      type: String,
      required: true,
      trim: true,
    },

    toEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },

    recipientType: {
      type: String,
      enum: ["USER", "GUEST"],
      required: true,
    },

    targetUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    targetUid: {
      type: String,
      default: "",
      trim: true,
    },

    targetPhoneNumber: {
      type: String,
      default: "",
      trim: true,
    },

    params: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    sentBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    brevoMessageId: {
      type: String,
      default: "",
      trim: true,
    },

    brevoResponse: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    status: {
      type: String,
      enum: ["SENT", "FAILED"],
      default: "SENT",
    },

    errorMessage: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AdminEmailLog", adminEmailLogSchema);