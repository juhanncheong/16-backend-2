const mongoose = require("mongoose");

const orderImageMapSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, trim: true },
    label: { type: String, default: "", trim: true },
    imageUrl: { type: String, default: "", trim: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("OrderImageMap", orderImageMapSchema);