const mongoose = require("mongoose");

const ChatMessageSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, index: true },
    sender: { type: String, enum: ["user", "admin"], required: true },
    message: { type: String, default: "" },
    createdAt: { type: Date, default: Date.now, index: true },
    status: { type: String, default: "sent" },
    type: { type: String, enum: ["text", "image"], default: "text" },
    imageUrl: { type: String, default: "" },
    fileName: { type: String, default: "" },
    adminRead: { type: Boolean, default: false, index: true },
    userRead: { type: Boolean, default: false, index: true },
  },
  { versionKey: false }
);

module.exports = mongoose.model("ChatMessage", ChatMessageSchema);