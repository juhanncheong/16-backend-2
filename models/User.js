const mongoose = require("mongoose");
const Counter = require("./Counter");

const userSchema = new mongoose.Schema(
  {
    phoneNumber: { type: String, required: true, unique: true, trim: true },
    password: { type: String, required: true, minlength: 6 },
    uid: { type: String, unique: true, sparse: true, trim: true },
    balance: { type: Number, default: 0 },
    vipRank: { type: Number, enum: [1, 2, 3], default: 1 },
    ordersCompleted: { type: Number, default: 0 },
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
    withdrawPinHash: { type: String, default: null, select: false },
    withdrawPinFailedAttempts: { type: Number, default: 0 },
    withdrawPinLocked: { type: Boolean, default: false },
    withdrawPinLockedAt: { type: Date, default: null },
    referralCode: { type: String, unique: true, sparse: true, uppercase: true, trim: true, index: true },
    referredBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    referredByCode: { type: String, default: null, uppercase: true, trim: true },
    role: { type: String, enum: ["user", "admin"], default: "user" },
  },
  { timestamps: true }
);

async function getNextUid() {
  let counter = await Counter.findOne({ name: "userUid" });

  if (!counter) {
    counter = await Counter.create({ name: "userUid", seq: 100000 });
  }

  counter.seq += 1;
  await counter.save();

  return String(counter.seq);
}

userSchema.pre("save", async function () {
  if (!this.isNew) return;
  if (this.uid) return;

  this.uid = await getNextUid();
});

module.exports = mongoose.model("User", userSchema);