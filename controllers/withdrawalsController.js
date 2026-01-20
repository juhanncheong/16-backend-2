const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const Withdrawal = require("../models/Withdrawal");
const User = require("../models/User");

const MAX_PIN_ATTEMPTS = 3;

function sanitizePin(pin) {
  return String(pin || "").trim();
}

function isValidPinFormat(pin) {
  // ✅ 4 to 6 digits (you can change this)
  return /^\d{4,6}$/.test(pin);
}

// ✅ User sets withdrawal PIN
exports.setWithdrawalPin = async (req, res) => {
  try {
    const userId = req.user.userId;
    const pin = sanitizePin(req.body?.pin);

    if (!isValidPinFormat(pin)) {
      return res.status(400).json({
        ok: false,
        message: "PIN must be 4 to 6 digits",
      });
    }

    const hash = await bcrypt.hash(pin, 10);

    await User.findByIdAndUpdate(userId, {
      withdrawPinHash: hash,
      withdrawPinFailedAttempts: 0,
      withdrawPinLocked: false,
      withdrawPinLockedAt: null,
    });

    return res.json({
      ok: true,
      message: "✅ Withdrawal PIN set successfully",
    });
  } catch (err) {
    console.error("setWithdrawalPin error:", err);
    return res.status(500).json({
      ok: false,
      message: "Server error",
    });
  }
};

// ✅ User creates a withdrawal (deduct balance immediately)
// Now protected by Withdrawal PIN
exports.createWithdrawal = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const userId = req.user.userId;

    let { amount, cryptoType, address, withdrawPin } = req.body;

    amount = Number(amount);
    const pin = sanitizePin(withdrawPin);

    // ✅ load user inside transaction (must include withdrawPinHash because select:false)
    const user = await User.findById(userId)
      .select("+withdrawPinHash withdrawPinFailedAttempts withdrawPinLocked withdrawPinLockedAt balance")
      .session(session);

    if (!user) throw new Error("User not found");

    // ✅ 1) If PIN not set -> tell frontend to redirect to set-pin page
    if (!user.withdrawPinHash) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        ok: false,
        code: "WITHDRAW_PIN_NOT_SET",
        message: "Withdrawal PIN not set",
      });
    }

    // ✅ 2) If locked -> block immediately
    if (user.withdrawPinLocked) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        ok: false,
        code: "WITHDRAW_PIN_LOCKED",
        message: "Withdrawals locked due to wrong PIN attempts",
      });
    }

    // ✅ validate PIN provided
    if (!isValidPinFormat(pin)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        ok: false,
        message: "Invalid PIN format",
      });
    }

    // ✅ 3) Check PIN
    const isMatch = await bcrypt.compare(pin, user.withdrawPinHash);

    if (!isMatch) {
      const failed = Number(user.withdrawPinFailedAttempts || 0) + 1;
      user.withdrawPinFailedAttempts = failed;

      let lockedNow = false;

      if (failed >= MAX_PIN_ATTEMPTS) {
        user.withdrawPinLocked = true;
        user.withdrawPinLockedAt = new Date();
        lockedNow = true;
      }

      await user.save({ session });

      await session.abortTransaction();
      session.endSession();

      return res.status(403).json({
        ok: false,
        code: lockedNow ? "WITHDRAW_PIN_LOCKED" : "WITHDRAW_PIN_INCORRECT",
        message: lockedNow
          ? "3 incorrect PIN attempts. Please contact support."
          : "Incorrect withdrawal PIN",
        attemptsLeft: Math.max(0, MAX_PIN_ATTEMPTS - failed),
      });
    }

    // ✅ 4) PIN correct -> reset attempts
    user.withdrawPinFailedAttempts = 0;
    user.withdrawPinLocked = false;
    user.withdrawPinLockedAt = null;

    // ✅ continue original validation
    if (!amount || isNaN(amount)) {
      throw new Error("Invalid amount");
    }

    if (amount < 10) {
      throw new Error("Minimum withdrawal is 10");
    }

    const allowedTypes = ["BTC_MAINNET", "ETH_ERC20", "SOL", "USDC_ERC20", "USDT_TRC20"];
    if (!allowedTypes.includes(cryptoType)) {
      throw new Error("Invalid crypto type");
    }

    if (!address || typeof address !== "string" || address.trim().length < 8) {
      throw new Error("Invalid withdrawal address");
    }

    const balanceBefore = Number(user.balance || 0);

    if (balanceBefore < amount) {
      throw new Error("Insufficient balance");
    }

    // ✅ deduct immediately
    user.balance = balanceBefore - amount;
    await user.save({ session });

    const withdrawal = await Withdrawal.create(
      [
        {
          user: user._id,
          amount,
          cryptoType,
          address: address.trim(),
          status: "PENDING",
          balanceBefore,
          balanceAfter: user.balance,
        },
      ],
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    return res.json({
      ok: true,
      message: "Withdrawal submitted successfully",
      withdrawal: withdrawal[0],
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();

    return res.status(400).json({
      ok: false,
      message: err.message || "Withdrawal failed",
    });
  }
};

// ✅ User withdrawal history
exports.getMyWithdrawals = async (req, res) => {
  try {
    const userId = req.user.userId;

    const withdrawals = await Withdrawal.find({ user: userId })
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ ok: true, withdrawals });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: "Failed to fetch withdrawals",
    });
  }
};
