const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    phoneNumber: { type: String, required: true, unique: true, trim: true },
    password: { type: String, required: true, minlength: 6 },
    balance: { type: Number, default: 0 },
    vipRank: { type: Number, enum: [1, 2, 3], default: 1 },
    ordersCompleted: { type: Number, default: 0 }, // 0 - 40
    ordersLimit: { type: Number, default: 40 },

    totalResetCount: { type: Number, default: 1 },
    lastClaimedResetCount: { type: Number, default: 0 },

    signinStreak: { type: Number, default: 0 },
    lastSigninDate: { type: String, default: null },

    lastOnlineAt: { type: Date, default: null },
    registeredIp: { type: String, default: null, trim: true },

    isBanned: { type: Boolean, default: false },
    bannedAt: { type: Date, default: null },
    banReason: { type: String, default: "" },

    // ✅ Withdrawal PIN Security
    withdrawPinHash: { type: String, default: null, select: false }, // hashed only
    withdrawPinFailedAttempts: { type: Number, default: 0 }, // 0..3
    withdrawPinLocked: { type: Boolean, default: false },
    withdrawPinLockedAt: { type: Date, default: null },

    // (optional) for later admin logic
    role: { type: String, enum: ["user", "admin"], default: "user" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
