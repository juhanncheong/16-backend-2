const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const Withdrawal = require("../models/Withdrawal");
const User = require("../models/User");

const MAX_PIN_ATTEMPTS = 3;

function sanitizePin(pin) {
  return String(pin || "").trim();
}

function isValidPinFormat(pin) {
  // ✅ 4 to 12 digits (you can change this anytime)
  return /^\d{4,12}$/.test(pin);
}

// ✅ User sets withdrawal PIN (ONLY if not set yet)
exports.setWithdrawalPin = async (req, res) => {
  try {
    const userId = req.user.userId;
    const pin = sanitizePin(req.body?.pin);

    if (!isValidPinFormat(pin)) {
      return res.status(400).json({
        ok: false,
        message: "PIN must be 4 to 12 digits",
      });
    }

    // ✅ prevent overwriting if already set
    const user = await User.findById(userId).select("+withdrawPinHash");
    if (!user) {
      return res.status(404).json({ ok: false, message: "User not found" });
    }

    if (user.withdrawPinHash) {
      return res.status(409).json({
        ok: false,
        code: "PIN_ALREADY_SET",
        message: "Withdrawal PIN already set. Use Change PIN instead.",
      });
    }

    const hash = await bcrypt.hash(pin, 10);

    user.withdrawPinHash = hash;
    user.withdrawPinFailedAttempts = 0;
    user.withdrawPinLocked = false;
    user.withdrawPinLockedAt = null;

    await user.save();

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

// ✅ User changes withdrawal PIN (requires old PIN)
exports.changeWithdrawalPin = async (req, res) => {
  try {
    const userId = req.user.userId;

    const oldPin = sanitizePin(req.body?.oldPin);
    const newPin = sanitizePin(req.body?.newPin);

    if (!oldPin || !newPin) {
      return res.status(400).json({
        ok: false,
        message: "oldPin and newPin are required",
      });
    }

    if (!isValidPinFormat(oldPin) || !isValidPinFormat(newPin)) {
      return res.status(400).json({
        ok: false,
        message: "PIN must be 4 to 12 digits",
      });
    }

    const user = await User.findById(userId).select(
      "+withdrawPinHash withdrawPinLocked withdrawPinFailedAttempts withdrawPinLockedAt"
    );

    if (!user) {
      return res.status(404).json({ ok: false, message: "User not found" });
    }

    if (!user.withdrawPinHash) {
      return res.status(403).json({
        ok: false,
        code: "WITHDRAW_PIN_NOT_SET",
        message: "Withdrawal PIN not set",
      });
    }

    // ✅ if locked, block changing pin (support/admin must reset)
    if (user.withdrawPinLocked) {
      return res.status(403).json({
        ok: false,
        code: "WITHDRAW_PIN_LOCKED",
        message: "Withdrawals locked. Please contact support.",
      });
    }

    const isMatch = await bcrypt.compare(oldPin, user.withdrawPinHash);
    if (!isMatch) {
      return res.status(401).json({
        ok: false,
        code: "OLD_PIN_INCORRECT",
        message: "Old withdrawal PIN is incorrect",
      });
    }

    const hash = await bcrypt.hash(newPin, 10);

    user.withdrawPinHash = hash;
    user.withdrawPinFailedAttempts = 0;
    user.withdrawPinLocked = false;
    user.withdrawPinLockedAt = null;

    await user.save();

    return res.json({
      ok: true,
      message: "✅ Withdrawal PIN updated successfully",
    });
  } catch (err) {
    console.error("changeWithdrawalPin error:", err);
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

    const user = await User.findById(userId)
      .select(
        "+withdrawPinHash withdrawPinFailedAttempts withdrawPinLocked withdrawPinLockedAt balance ordersCompleted ordersLimit"
      )
      .session(session);

    if (!user) throw new Error("User not found");

    // ✅ Orders check (must complete 40 before withdraw)
    const completed = Number(user.ordersCompleted || 0);
    const required = Number(user.ordersLimit || 40);

    if (completed < required) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        ok: false,
        code: "ORDERS_NOT_COMPLETED",
        message: `You must complete ${required} orders before withdrawing`,
        completed,
        required,
      });
    }

    if (!user.withdrawPinHash) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        ok: false,
        code: "WITHDRAW_PIN_NOT_SET",
        message: "Withdrawal PIN not set",
      });
    }

    if (user.withdrawPinLocked) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        ok: false,
        code: "WITHDRAW_PIN_LOCKED",
        message: "Withdrawals locked. Please contact support.",
      });
    }

    if (!pin || !isValidPinFormat(pin)) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        ok: false,
        code: "INVALID_WITHDRAW_PIN",
        message: "Withdrawal PIN must be 4 to 12 digits",
      });
    }

    const okPin = await bcrypt.compare(pin, user.withdrawPinHash);

    // ❌ wrong PIN -> increase attempts and maybe lock
    if (!okPin) {
      let failed = Number(user.withdrawPinFailedAttempts || 0) + 1;
      user.withdrawPinFailedAttempts = failed;

      let lockedNow = false;
      if (failed >= MAX_PIN_ATTEMPTS) {
        user.withdrawPinLocked = true;
        user.withdrawPinLockedAt = new Date();
        lockedNow = true;
      }

      await user.save({ session });

      // ✅ IMPORTANT: commit so attempts persist
      await session.commitTransaction();
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

    // ✅ PIN correct -> reset attempts
    user.withdrawPinFailedAttempts = 0;
    user.withdrawPinLocked = false;
    user.withdrawPinLockedAt = null;

    if (!amount || isNaN(amount)) {
      throw new Error("Invalid amount");
    }

    if (amount < 10) {
      throw new Error("Minimum withdrawal is 10");
    }

    const allowedTypes = [
      "BTC_MAINNET",
      "ETH_ERC20",
      "SOL",
      "USDC_ERC20",
      "USDT_TRC20",
    ];
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
