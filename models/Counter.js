const mongoose = require("mongoose");

const counterSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true },
    seq: { type: Number, default: 100000 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Counter", counterSchema);