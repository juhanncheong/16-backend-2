const mongoose = require("mongoose");

const ChatConversationMetaSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    chatTabId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ChatTab",
      default: null,
      index: true,
    },
  },
  { timestamps: true, versionKey: false }
);

module.exports = mongoose.model(
  "ChatConversationMeta",
  ChatConversationMetaSchema
);