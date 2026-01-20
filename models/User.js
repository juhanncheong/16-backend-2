const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    phoneNumber: { type: String, required: true, unique: true, trim: true },
    password: { type: String, required: true, minlength: 6 },
    balance: { type: Number, default: 0 },

    ordersCompleted: { type: Number, default: 0 }, // 0 - 40
    ordersLimit: { type: Number, default: 40 },

    // ✅ NEW: reward "round" tracking
    totalResetCount: { type: Number, default: 1 },
    lastClaimedResetCount: { type: Number, default: 0 },

    signinStreak: { type: Number, default: 0 },
    lastSigninDate: { type: String, default: null },

    lastOnlineAt: { type: Date, default: null },
    registeredIp: { type: String, default: null, trim: true },

    isBanned: { type: Boolean, default: false },
    bannedAt: { type: Date, default: null },
    banReason: { type: String, default: "" },

    // (optional) for later admin logic
    role: { type: String, enum: ["user", "admin"], default: "user" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
