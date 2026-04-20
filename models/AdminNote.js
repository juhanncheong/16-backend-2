const mongoose = require("mongoose");

const AdminNoteSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, unique: true, index: true },
    nickname: { type: String, default: "" },
    updatedAt: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

module.exports = mongoose.model("AdminNote", AdminNoteSchema);