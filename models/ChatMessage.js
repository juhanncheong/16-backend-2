const mongoose = require("mongoose");

const ChatMessageSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    uid: { type: String, default: "", index: true },
    phoneNumber: { type: String, default: "" },
    sender: { type: String, enum: ["user", "admin"], required: true },
    message: { type: String, default: "" },
    createdAt: { type: Date, default: Date.now, index: true },
    status: { type: String, default: "sent" },
    type: { type: String, enum: ["text", "image"], default: "text" },
    imageUrl: { type: String, default: "" },
    imagePublicId: { type: String, default: "" },
    fileName: { type: String, default: "" },
    adminRead: { type: Boolean, default: false, index: true },
    userRead: { type: Boolean, default: false, index: true },
    edited: { type: Boolean, default: false },
    editedAt: { type: Date, default: null },
    editedBy: { type: String, default: "" },
    editHistory: [
      {
        oldMessage: { type: String, default: "" },
        newMessage: { type: String, default: "" },
        editedAt: { type: Date, default: Date.now },
        editedBy: { type: String, default: "" },
      },
    ],
  },
  { versionKey: false }
);

module.exports = mongoose.model("ChatMessage", ChatMessageSchema);