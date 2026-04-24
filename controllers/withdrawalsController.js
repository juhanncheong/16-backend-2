const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const Withdrawal = require("../models/Withdrawal");
const User = require("../models/User");
const RecentWithdrawalAddress = require("../models/RecentWithdrawalAddress");
const AdminNotification = require("../models/AdminNotification");
const WithdrawalMethodConfig = require("../models/WithdrawalMethodConfig");

const MAX_PIN_ATTEMPTS = 3;

const WITHDRAWAL_METHODS = [
  "BTC_MAINNET",
  "ETH_ERC20",
  "SOL",
  "USDC_ERC20",
  "USDT_TRC20",
  "BANK_FASTER_PAYMENTS",
];

const CRYPTO_METHODS = [
  "BTC_MAINNET",
  "ETH_ERC20",
  "SOL",
  "USDC_ERC20",
  "USDT_TRC20",
];

function sanitizePin(pin) {
  return String(pin || "").trim();
}

function isValidPinFormat(pin) {
  return /^\d{4,12}$/.test(pin);
}

function normalizeMethod(method) {
  return String(method || "").trim().toUpperCase();
}

function normalizeSortCode(sortCode) {
  return String(sortCode || "").trim();
}

function normalizeAccountNumber(accountNumber) {
  return String(accountNumber || "").trim();
}

function isValidSortCode(sortCode) {
  return /^\d{2}-?\d{2}-?\d{2}$/.test(String(sortCode || "").trim());
}

function isValidAccountNumber(accountNumber) {
  return /^\d{6,8}$/.test(String(accountNumber || "").trim());
}

async function createAdminNotification({
  type,
  title,
  message,
  user = null,
  relatedUser = null,
  address = "",
  cryptoType = "",
  ip = "",
  session = null,
}) {
  return AdminNotification.create(
    [
      {
        type,
        title,
        message,
        user,
        relatedUser,
        address,
        cryptoType,
        ip,
        isRead: false,
      },
    ],
    session ? { session } : {}
  );
}

async function ensureWithdrawalMethods(session = null) {
  const rows = await Promise.all(
    WITHDRAWAL_METHODS.map((method) =>
      WithdrawalMethodConfig.findOneAndUpdate(
        { method },
        { $setOnInsert: { method, isAvailable: true, note: "" } },
        {
          upsert: true,
          new: true,
          setDefaultsOnInsert: true,
          session: session || undefined,
        }
      ).lean()
    )
  );

  return rows;
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
// Supports crypto + bank transfer
exports.createWithdrawal = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const userId = req.user.userId;

    let {
      amount,
      paymentMethod,
      cryptoType, // backward compatibility for old frontend
      address,
      bankDetails,
      withdrawPin,
    } = req.body || {};

    amount = Number(amount);
    const pin = sanitizePin(withdrawPin);
    const selectedMethod = normalizeMethod(paymentMethod || cryptoType);

    const user = await User.findById(userId)
      .select(
        "+withdrawPinHash withdrawPinFailedAttempts withdrawPinLocked withdrawPinLockedAt balance ordersCompleted ordersLimit withdrawalBlocked withdrawalBlockedReason withdrawalBlockedAt creditScore"
      )
      .session(session);

    if (!user) throw new Error("User not found");

    const creditScore = Number(user.creditScore ?? 100);

    if (creditScore < 95) {
      await session.abortTransaction();
      session.endSession();
    
      return res.status(403).json({
        ok: false,
        code: "INSUFFICIENT_CREDIT_SCORE",
        message: "Insufficient credit score. Please contact customer service.",
        creditScore,
        requiredCreditScore: 95,
      });
    }
    
    if (user.withdrawalBlocked) {
      await session.abortTransaction();
      session.endSession();

      return res.status(403).json({
        ok: false,
        code: "WITHDRAWAL_BLOCKED",
        message: "Withdrawal currently frozen.",
        withdrawalBlocked: true,
        reason: user.withdrawalBlockedReason || "",
        blockedAt: user.withdrawalBlockedAt || null,
      });
    }

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

    if (!okPin) {
      const failed = Number(user.withdrawPinFailedAttempts || 0) + 1;
      user.withdrawPinFailedAttempts = failed;

      let lockedNow = false;
      if (failed >= MAX_PIN_ATTEMPTS) {
        user.withdrawPinLocked = true;
        user.withdrawPinLockedAt = new Date();
        lockedNow = true;
      }

      await user.save({ session });

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

    user.withdrawPinFailedAttempts = 0;
    user.withdrawPinLocked = false;
    user.withdrawPinLockedAt = null;

    if (!amount || Number.isNaN(amount)) {
      throw new Error("Invalid amount");
    }

    if (amount < 10) {
      throw new Error("Minimum withdrawal is 10");
    }

    if (!WITHDRAWAL_METHODS.includes(selectedMethod)) {
      throw new Error("Invalid withdrawal method");
    }

    await ensureWithdrawalMethods(session);

    const methodConfig = await WithdrawalMethodConfig.findOne({
      method: selectedMethod,
    }).session(session);

    if (methodConfig && !methodConfig.isAvailable) {
      await session.abortTransaction();
      session.endSession();

      return res.status(403).json({
        ok: false,
        code: "WITHDRAWAL_METHOD_UNAVAILABLE",
        message: `${selectedMethod} is currently unavailable`,
        paymentMethod: selectedMethod,
        isAvailable: false,
        note: methodConfig.note || "",
      });
    }

    let cleanAddress = "";
    let cleanBankDetails = {
      accountName: "",
      bankName: "",
      sortCode: "",
      accountNumber: "",
      referenceNote: "",
    };

    if (CRYPTO_METHODS.includes(selectedMethod)) {
      if (!address || typeof address !== "string" || address.trim().length < 8) {
        throw new Error("Invalid withdrawal address");
      }

      cleanAddress = address.trim();

      const existingOtherUserWithdrawal = await Withdrawal.findOne({
        address: cleanAddress,
        paymentMethod: selectedMethod,
        user: { $ne: user._id },
      })
        .sort({ createdAt: 1 })
        .session(session);

      if (existingOtherUserWithdrawal) {
        const existingNotification = await AdminNotification.findOne({
          type: "DUPLICATE_WITHDRAWAL_ADDRESS",
          user: user._id,
          relatedUser: existingOtherUserWithdrawal.user,
          address: cleanAddress,
          cryptoType: selectedMethod,
        }).session(session);

        if (!existingNotification) {
          await createAdminNotification({
            type: "DUPLICATE_WITHDRAWAL_ADDRESS",
            title: "Duplicate withdrawal address detected",
            message: `A withdrawal address is being used by more than one user for ${selectedMethod}.`,
            user: user._id,
            relatedUser: existingOtherUserWithdrawal.user,
            address: cleanAddress,
            cryptoType: selectedMethod,
            session,
          });
        }
      }
    } else if (selectedMethod === "BANK_FASTER_PAYMENTS") {
      const accountName = String(bankDetails?.accountName || "").trim();
      const bankName = String(bankDetails?.bankName || "").trim();
      const sortCode = normalizeSortCode(bankDetails?.sortCode);
      const accountNumber = normalizeAccountNumber(bankDetails?.accountNumber);
      const referenceNote = String(bankDetails?.referenceNote || "").trim();

      if (!accountName) throw new Error("Account name is required");
      if (!bankName) throw new Error("Bank name is required");
      if (!isValidSortCode(sortCode)) throw new Error("Invalid sort code");
      if (!isValidAccountNumber(accountNumber)) throw new Error("Invalid account number");

      cleanBankDetails = {
        accountName,
        bankName,
        sortCode,
        accountNumber,
        referenceNote,
      };
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
          paymentMethod: selectedMethod,
          cryptoType: CRYPTO_METHODS.includes(selectedMethod) ? selectedMethod : null,
          address: cleanAddress,
          bankDetails:
            selectedMethod === "BANK_FASTER_PAYMENTS" ? cleanBankDetails : undefined,
          status: "PENDING",
          balanceBefore,
          balanceAfter: user.balance,
        },
      ],
      { session }
    );

    await createAdminNotification({
      type: "NEW_WITHDRAWAL",
      title: "New withdrawal submitted",
      message: `${selectedMethod} withdrawal of ${amount} submitted.`,
      user: user._id,
      address:
        selectedMethod === "BANK_FASTER_PAYMENTS"
          ? `${cleanBankDetails.bankName} ${cleanBankDetails.accountNumber}`
          : cleanAddress,
      cryptoType: selectedMethod,
      session,
    });

    if (CRYPTO_METHODS.includes(selectedMethod)) {
      await saveRecentWithdrawalAddress({
        userId: user._id,
        cryptoType: selectedMethod,
        address: cleanAddress,
        session,
      });
    }

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

    console.error("createWithdrawal error:", err);
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

async function saveRecentWithdrawalAddress({ userId, cryptoType, address, session }) {
  const cleanAddress = String(address || "").trim();
  if (!cleanAddress) return;

  await RecentWithdrawalAddress.findOneAndUpdate(
    {
      user: userId,
      cryptoType,
      address: cleanAddress,
    },
    {
      $set: {
        lastUsedAt: new Date(),
      },
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
      session,
    }
  );
}

exports.getRecentWithdrawalAddresses = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { cryptoType } = req.query;

    const filter = { user: userId };
    if (cryptoType) {
      filter.cryptoType = String(cryptoType).trim();
    }

    const items = await RecentWithdrawalAddress.find(filter)
      .sort({ lastUsedAt: -1 })
      .limit(5)
      .lean();

    return res.json({
      ok: true,
      items,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: "Failed to fetch recent withdrawal addresses",
    });
  }
};

// ✅ User can fetch all withdrawal methods + availability
exports.getWithdrawalMethods = async (req, res) => {
  try {
    const methods = await ensureWithdrawalMethods();

    return res.json({
      ok: true,
      methods,
    });
  } catch (err) {
    console.error("getWithdrawalMethods error:", err);
    return res.status(500).json({
      ok: false,
      message: "Failed to fetch withdrawal methods",
    });
  }
};