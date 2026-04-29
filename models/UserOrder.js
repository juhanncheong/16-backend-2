const mongoose = require("mongoose");

const userOrderSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    poolOrder: { type: mongoose.Schema.Types.ObjectId, ref: "OrderPool", required: true },

    status: { type: String, enum: ["PENDING", "COMPLETED"], default: "PENDING" },

    // snapshot
    orderNumber: { type: String, required: true },
    orderName: { type: String, required: true },
    price: { type: Number, required: true },
    commission: { type: Number, required: true },

    // snapshot image data for history
    imageUrl: { type: String, default: "" },
    imageKey: { type: String, default: "" },

    isBonus: { type: Boolean, default: false },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

userOrderSchema.index({ user: 1, status: 1 });

module.exports = mongoose.model("UserOrder", userOrderSchema);