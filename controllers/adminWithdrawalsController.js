const mongoose = require("mongoose");
const Withdrawal = require("../models/Withdrawal");
const User = require("../models/User");
const RecentWithdrawalAddress = require("../models/RecentWithdrawalAddress");

// ✅ Admin: list withdrawals (optional filters)
exports.adminListWithdrawals = async (req, res) => {
  try {
    const { status, userId } = req.query;

    const filter = {};
    if (status) filter.status = String(status).toUpperCase();
    if (userId) filter.user = userId;

    const withdrawals = await Withdrawal.find(filter)
      .populate("user", "uid phoneNumber balance role")
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ ok: true, withdrawals });
  } catch (err) {
    console.error("adminListWithdrawals error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
};

// ✅ Admin: approve withdrawal
// Logic: status PENDING -> APPROVED (balance already deducted when user submitted)
exports.adminApproveWithdrawal = async (req, res) => {
  try {
    const { id } = req.params;

    const wd = await Withdrawal.findById(id);
    if (!wd) return res.status(404).json({ ok: false, message: "Withdrawal not found" });

    if (wd.status !== "PENDING") {
      return res.status(400).json({ ok: false, message: "This withdrawal is already processed" });
    }

    wd.status = "APPROVED";
    wd.adminActionBy = req.user._id;
    wd.actionAt = new Date();

    await wd.save();

    return res.json({ ok: true, message: "Withdrawal approved", withdrawal: wd });
  } catch (err) {
    console.error("adminApproveWithdrawal error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
};

// ✅ Admin: reject withdrawal
// Logic: status PENDING -> REJECTED + RETURN BALANCE to user
exports.adminRejectWithdrawal = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;
    const { adminNote } = req.body;

    const wd = await Withdrawal.findById(id).session(session);
    if (!wd) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ ok: false, message: "Withdrawal not found" });
    }

    if (wd.status !== "PENDING") {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({ ok: false, message: "This withdrawal is already processed" });
    }

    // ✅ return balance
    const user = await User.findById(wd.user).session(session);
    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ ok: false, message: "User not found" });
    }

    user.balance = Number(user.balance || 0) + Number(wd.amount || 0);
    await user.save({ session });

    // ✅ update withdrawal
    wd.status = "REJECTED";
    wd.adminActionBy = req.user._id;
    wd.adminNote = String(adminNote || "");
    wd.actionAt = new Date();

    await wd.save({ session });

    await session.commitTransaction();
    session.endSession();

    return res.json({ ok: true, message: "Withdrawal rejected + balance returned", withdrawal: wd });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error("adminRejectWithdrawal error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
};

const bcrypt = require("bcryptjs");

function sanitizePin(pin) {
  return String(pin || "").trim();
}

function isValidPinFormat(pin) {
  return /^\d{4,6}$/.test(pin);
}

// ✅ Admin: reset user withdrawal PIN + unlock
exports.adminResetUserWithdrawPin = async (req, res) => {
  try {
    const { id } = req.params;
    const newPin = sanitizePin(req.body?.newPin);

    if (!isValidPinFormat(newPin)) {
      return res.status(400).json({
        ok: false,
        message: "newPin must be 4 to 6 digits",
      });
    }

    const hash = await bcrypt.hash(newPin, 10);

    const user = await User.findByIdAndUpdate(
      id,
      {
        withdrawPinHash: hash,
        withdrawPinFailedAttempts: 0,
        withdrawPinLocked: false,
        withdrawPinLockedAt: null,
      },
      { new: true }
    ).select("-password");

    if (!user) return res.status(404).json({ ok: false, message: "User not found" });

    return res.json({
      ok: true,
      message: "✅ Withdrawal PIN reset + unlocked",
      user: {
        _id: user._id,
        phoneNumber: user.phoneNumber,
        withdrawPinFailedAttempts: user.withdrawPinFailedAttempts || 0,
        attemptsLeft: 3 - Number(user.withdrawPinFailedAttempts || 0),
        withdrawPinLocked: !!user.withdrawPinLocked,
      },
    });
  } catch (err) {
    console.error("adminResetUserWithdrawPin error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
};

// ✅ Admin: get recent withdrawal address list
exports.adminListRecentWithdrawalAddresses = async (req, res) => {
  try {
    const { userId, cryptoType } = req.query;

    const filter = {};
    if (userId) filter.user = userId;
    if (cryptoType) filter.cryptoType = String(cryptoType).trim();

    const items = await RecentWithdrawalAddress.find(filter)
      .populate("user", "uid phoneNumber")
      .sort({ lastUsedAt: -1 })
      .lean();

    return res.json({ ok: true, items });
  } catch (err) {
    console.error("adminListRecentWithdrawalAddresses error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
};

// ✅ Admin: update recent withdrawal address list
exports.adminUpdateRecentWithdrawalAddress = async (req, res) => {
  try {
    const { id } = req.params;
    const { address, cryptoType } = req.body || {};

    const item = await RecentWithdrawalAddress.findById(id);
    if (!item) {
      return res.status(404).json({ ok: false, message: "Record not found" });
    }

    if (address !== undefined) {
      const cleanAddress = String(address || "").trim();
      if (!cleanAddress || cleanAddress.length < 8) {
        return res.status(400).json({ ok: false, message: "Invalid address" });
      }
      item.address = cleanAddress;
    }

    if (cryptoType !== undefined) {
      item.cryptoType = String(cryptoType || "").trim();
    }

    await item.save();

    const updated = await RecentWithdrawalAddress.findById(item._id)
      .populate("user", "uid phoneNumber")
      .lean();

    return res.json({
      ok: true,
      message: "✅ Recent withdrawal address updated",
      item: updated,
    });
  } catch (err) {
    if (err?.code === 11000) {
      return res.status(409).json({
        ok: false,
        message: "Duplicate recent withdrawal address for this user and crypto type",
      });
    }

    console.error("adminUpdateRecentWithdrawalAddress error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
};

// ✅ Admin: delete recent withdrawal address list
exports.adminDeleteRecentWithdrawalAddress = async (req, res) => {
  try {
    const { id } = req.params;

    const deleted = await RecentWithdrawalAddress.findByIdAndDelete(id);
    if (!deleted) {
      return res.status(404).json({ ok: false, message: "Record not found" });
    }

    return res.json({
      ok: true,
      message: "✅ Recent withdrawal address deleted",
    });
  } catch (err) {
    console.error("adminDeleteRecentWithdrawalAddress error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
};