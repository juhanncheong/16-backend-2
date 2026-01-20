const mongoose = require("mongoose");

const orderPoolSchema = new mongoose.Schema(
  {
    orderNumber: { type: String, required: true, unique: true, trim: true },
    orderName: { type: String, required: true, trim: true },
    price: { type: Number, required: true, min: 0 },
    imageUrl: { type: String, default: "" },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

orderPoolSchema.index({ isActive: 1, price: 1 });
module.exports = mongoose.model("OrderPool", orderPoolSchema);
