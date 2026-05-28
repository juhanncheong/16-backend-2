const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const Withdrawal = require("../models/Withdrawal");
const User = require("../models/User");
const RecentWithdrawalAddress = require("../models/RecentWithdrawalAddress");
const AdminNotification = require("../models/AdminNotification");
const WithdrawalMethodConfig = require("../models/WithdrawalMethodConfig");
const VipConfig = require("../models/VipConfig");

const MAX_PIN_ATTEMPTS = 3;

const WITHDRAWAL_METHODS = [
  "CRYPTO",
  "BANK_FASTER_PAYMENTS",
  "BANK_SEPA",
  "WISE",
  "UAEFTS",
  "VIP_UAEFTS",
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
  return /^[\x21-\x7E]{4,12}$/.test(pin);
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

function normalizeIban(iban) {
  return String(iban || "").replace(/\s+/g, "").trim().toUpperCase();
}

function normalizeBicSwift(bicSwift) {
  return String(bicSwift || "").replace(/\s+/g, "").trim().toUpperCase();
}

function isValidIban(iban) {
  const clean = normalizeIban(iban);
  return /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(clean);
}

function isValidBicSwift(bicSwift) {
  const clean = normalizeBicSwift(bicSwift);
  if (!clean) return true; // optional
  return /^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(clean);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
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
        {
          $setOnInsert: {
            method,
            isAvailable: true,
            minAmount: 10,
            maxAmount: 999999,
            note: "",
          },
        },
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
async function runTransactionWithRetry(work, retries = 3) {
  let lastError;

  for (let attempt = 1; attempt <= retries; attempt++) {
    const session = await mongoose.startSession();

    try {
      let result;

      await session.withTransaction(
        async () => {
          result = await work(session);
        },
        {
          readConcern: { level: "snapshot" },
          writeConcern: { w: "majority" },
          readPreference: "primary",
        }
      );

      return result;
    } catch (err) {
      lastError = err;

      const isRetryable =
        err?.errorLabels?.includes?.("TransientTransactionError") ||
        err?.errorLabelSet?.has?.("TransientTransactionError") ||
        err?.code === 112 ||
        err?.codeName === "WriteConflict";

      if (!isRetryable || attempt === retries) {
        throw err;
      }

      console.warn(
        `Retrying createWithdrawal transaction after write conflict. Attempt ${attempt}/${retries}`
      );

      await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
    } finally {
      await session.endSession();
    }
  }

  throw lastError;
}

exports.createWithdrawal = async (req, res) => {
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
    const selectedMethod = normalizeMethod(paymentMethod);
    const selectedCryptoType = normalizeMethod(cryptoType);

    const user = await User.findById(userId).select(
      "+withdrawPinHash withdrawPinFailedAttempts withdrawPinLocked withdrawPinLockedAt balance ordersCompleted ordersLimit vipRank withdrawalBlocked withdrawalBlockedReason withdrawalBlockedAt creditScore uid phoneNumber role"
    );

    if (!user) {
      return res.status(404).json({
        ok: false,
        message: "User not found",
      });
    }

    const creditScore = Number(user.creditScore ?? 100);

    if (creditScore < 95) {
      return res.status(403).json({
        ok: false,
        code: "INSUFFICIENT_CREDIT_SCORE",
        message: "Insufficient credit score. Please contact customer service.",
        creditScore,
        requiredCreditScore: 95,
      });
    }

    if (user.withdrawalBlocked) {
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

    let required = Number(user.ordersLimit || 40);
    
    try {
      const config = await VipConfig.findOne().lean();
      const ranks = Array.isArray(config?.ranks) ? config.ranks : [];
      const vipRank = Number(user.vipRank || 1);
      const vip = ranks.find((r) => Number(r.rank) === vipRank);
    
      if (vip && Number.isFinite(Number(vip.ordersLimit))) {
        required = Number(vip.ordersLimit);
      }
    } catch (vipErr) {
      console.error("withdrawal vip ordersLimit lookup error:", vipErr);
    }

    if (completed < required) {
      return res.status(403).json({
        ok: false,
        code: "ORDERS_NOT_COMPLETED",
        message: `You must complete ${required} orders before withdrawing`,
        completed,
        required,
      });
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

    if (!pin || !isValidPinFormat(pin)) {
      return res.status(400).json({
        ok: false,
        code: "INVALID_WITHDRAW_PIN",
        message: "PIN must be 4 to 12 digits",
      });
    }

    const okPin = await bcrypt.compare(pin, user.withdrawPinHash);

    if (!okPin) {
      const updatedPinUser = await User.findOneAndUpdate(
        { _id: user._id },
        {
          $inc: { withdrawPinFailedAttempts: 1 },
        },
        { new: true }
      ).select("withdrawPinFailedAttempts");
    
      const failed = Number(updatedPinUser?.withdrawPinFailedAttempts || 0);
      const lockedNow = failed >= MAX_PIN_ATTEMPTS;
    
      if (lockedNow) {
        await User.updateOne(
          { _id: user._id },
          {
            $set: {
              withdrawPinLocked: true,
              withdrawPinLockedAt: new Date(),
            },
          }
        );
      }
    
      return res.status(403).json({
        ok: false,
        code: lockedNow ? "WITHDRAW_PIN_LOCKED" : "WITHDRAW_PIN_INCORRECT",
        message: lockedNow
          ? "3 incorrect PIN attempts. Please contact support."
          : "Incorrect withdrawal PIN",
        attemptsLeft: Math.max(0, MAX_PIN_ATTEMPTS - failed),
      });
    }

    if (!amount || Number.isNaN(amount)) {
      return res.status(400).json({
        ok: false,
        message: "Invalid amount",
      });
    }

    if (!WITHDRAWAL_METHODS.includes(selectedMethod)) {
      return res.status(400).json({
        ok: false,
        message: "Invalid withdrawal method",
      });
    }

    if (selectedMethod === "CRYPTO") {
      if (!CRYPTO_METHODS.includes(selectedCryptoType)) {
        return res.status(400).json({
          ok: false,
          message: "Invalid crypto type",
        });
      }
    }
    
    const methodConfig = await WithdrawalMethodConfig.findOne({
      method: selectedMethod,
    }).lean();
    
    const methodMinAmount = Number.isFinite(Number(methodConfig?.minAmount))
      ? Number(methodConfig.minAmount)
      : 10;
    
    const methodMaxAmount = Number.isFinite(Number(methodConfig?.maxAmount))
      ? Number(methodConfig.maxAmount)
      : 999999;
    
    if (methodConfig && !methodConfig.isAvailable) {
      return res.status(403).json({
        ok: false,
        code: "WITHDRAWAL_METHOD_UNAVAILABLE",
        message: `${selectedMethod} is currently unavailable`,
        paymentMethod: selectedMethod,
        isAvailable: false,
        note: methodConfig.note || "",
      });
    }

    // ✅ VIP_UAEFTS can be opened only for selected user UIDs
    if (selectedMethod === "VIP_UAEFTS") {
      const userUid = String(user.uid || "").trim();

      const allowedUids = Array.isArray(methodConfig?.allowedUids)
        ? methodConfig.allowedUids.map((x) => String(x || "").trim()).filter(Boolean)
        : [];

      if (!userUid || !allowedUids.includes(userUid)) {
        return res.status(403).json({
          ok: false,
          code: "VIP_UAEFTS_NOT_ALLOWED",
          message: "VIP UAEFTS is not available for your account.",
          paymentMethod: selectedMethod,
          isAvailable: false,
        });
      }
    }
    
    if (amount < methodMinAmount) {
      return res.status(400).json({
        ok: false,
        code: "WITHDRAWAL_AMOUNT_BELOW_MIN",
        message: `Minimum withdrawal for ${selectedMethod} is ${methodMinAmount}`,
        paymentMethod: selectedMethod,
        minAmount: methodMinAmount,
        maxAmount: methodMaxAmount,
      });
    }
    
    if (amount > methodMaxAmount) {
      return res.status(400).json({
        ok: false,
        code: "WITHDRAWAL_AMOUNT_ABOVE_MAX",
        message: `Maximum withdrawal for ${selectedMethod} is ${methodMaxAmount}`,
        paymentMethod: selectedMethod,
        minAmount: methodMinAmount,
        maxAmount: methodMaxAmount,
      });
    }

    let cleanAddress = "";
    let cleanBankDetails = {
      accountName: "",
      bankName: "",
      sortCode: "",
      accountNumber: "",
      iban: "",
      bicSwift: "",
      country: "",
      wiseEmail: "",
      referenceNote: "",
    };

    if (selectedMethod === "CRYPTO") {
      if (!address || typeof address !== "string" || address.trim().length < 8) {
        return res.status(400).json({
          ok: false,
          message: "Invalid withdrawal address",
        });
      }

      cleanAddress = address.trim();
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
        iban: "",
        bicSwift: "",
        country: "GB",
        wiseEmail: "",
        referenceNote,
      };
    } else if (selectedMethod === "BANK_SEPA") {
      const accountName = String(bankDetails?.accountName || "").trim();
      const bankName = String(bankDetails?.bankName || "").trim();
      const iban = normalizeIban(bankDetails?.iban);
      const bicSwift = normalizeBicSwift(bankDetails?.bicSwift);
      const country = String(bankDetails?.country || "").trim().toUpperCase();
      const referenceNote = String(bankDetails?.referenceNote || "").trim();

      if (!accountName) throw new Error("Account name is required");
      if (!iban || !isValidIban(iban)) throw new Error("Invalid IBAN");
      if (!isValidBicSwift(bicSwift)) throw new Error("Invalid BIC/SWIFT");

      cleanBankDetails = {
        accountName,
        bankName,
        sortCode: "",
        accountNumber: "",
        iban,
        bicSwift,
        country,
        wiseEmail: "",
        referenceNote,
      };
    } else if (selectedMethod === "WISE") {
      const accountName = String(bankDetails?.accountName || "").trim();
      const wiseEmail = String(bankDetails?.wiseEmail || "").trim().toLowerCase();
      const country = String(bankDetails?.country || "").trim().toUpperCase();
      const referenceNote = String(bankDetails?.referenceNote || "").trim();

      if (!accountName) throw new Error("Account name is required");
      if (!wiseEmail || !isValidEmail(wiseEmail)) throw new Error("Invalid Wise email");

      cleanBankDetails = {
        accountName,
        bankName: "Wise",
        sortCode: "",
        accountNumber: "",
        iban: "",
        bicSwift: "",
        country,
        wiseEmail,
        referenceNote,
      };
    } else if (selectedMethod === "UAEFTS" || selectedMethod === "VIP_UAEFTS") {
      const accountName = String(bankDetails?.accountName || "").trim();
      const bankName = String(bankDetails?.bankName || "").trim();
      const iban = normalizeIban(bankDetails?.iban);
      const bicSwift = normalizeBicSwift(bankDetails?.bicSwift);
      const referenceNote = String(bankDetails?.referenceNote || "").trim();

      if (!accountName) throw new Error("Account name is required");
      if (!bankName) throw new Error("Bank name is required");

      if (!/^AE\d{21}$/.test(iban)) {
        throw new Error("Invalid UAE IBAN");
      }

      if (!isValidBicSwift(bicSwift)) {
        throw new Error("Invalid BIC/SWIFT");
      }

      cleanBankDetails = {
        accountName,
        bankName,
        sortCode: "",
        accountNumber: "",
        iban,
        bicSwift,
        country: "AE",
        wiseEmail: "",
        referenceNote,
      };
    }

    const result = await runTransactionWithRetry(async (session) => {
      if (selectedMethod === "CRYPTO") {
        const existingOtherUserWithdrawal = await Withdrawal.findOne({
        address: cleanAddress,
        paymentMethod: "CRYPTO",
        cryptoType: selectedCryptoType,
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
            cryptoType: selectedCryptoType,
          }).session(session);

          if (!existingNotification) {
            await createAdminNotification({
              type: "DUPLICATE_WITHDRAWAL_ADDRESS",
              title: "Duplicate withdrawal address detected",
              message: `A withdrawal address is being used by more than one user for ${selectedCryptoType}.`,
              user: user._id,
              relatedUser: existingOtherUserWithdrawal.user,
              address: cleanAddress,
              cryptoType: selectedCryptoType,
              session,
            });
          }
        }
      }

      const updatedUser = await User.findOneAndUpdate(
        {
          _id: user._id,
          balance: { $gte: amount },
          withdrawalBlocked: { $ne: true },
          creditScore: { $gte: 95 },
          withdrawPinLocked: { $ne: true },
          ordersCompleted: { $gte: required },
        },
        {
          $inc: {
            balance: -amount,
          },
          $set: {
            withdrawPinFailedAttempts: 0,
            withdrawPinLocked: false,
            withdrawPinLockedAt: null,
          },
        },
        {
          new: true,
          session,
        }
      );

      if (!updatedUser) {
        throw new Error("Insufficient balance");
      }

      const balanceAfter = Number(updatedUser.balance || 0);
      const balanceBefore = balanceAfter + amount;

      const withdrawal = await Withdrawal.create(
        [
          {
            user: user._id,
            amount,
            paymentMethod: selectedMethod,
            cryptoType: selectedMethod === "CRYPTO" ? selectedCryptoType : null,
            address: cleanAddress,
            bankDetails: [
              "BANK_FASTER_PAYMENTS",
              "BANK_SEPA",
              "WISE",
              "UAEFTS",
              "VIP_UAEFTS",
            ].includes(selectedMethod)
              ? cleanBankDetails
              : undefined,
            status: "PENDING",
            progressPercent: 0,
            balanceBefore,
            balanceAfter,
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
            : selectedMethod === "BANK_SEPA"
            ? `${cleanBankDetails.iban}`
            : selectedMethod === "WISE"
            ? `${cleanBankDetails.wiseEmail}`
            : selectedMethod === "UAEFTS" || selectedMethod === "VIP_UAEFTS"
            ? `${cleanBankDetails.bankName} ${cleanBankDetails.iban}`
            : cleanAddress,
        cryptoType: selectedMethod === "CRYPTO" ? selectedCryptoType : "",
        session,
      });

      if (selectedMethod === "CRYPTO") {
        await saveRecentWithdrawalAddress({
          userId: user._id,
          cryptoType: selectedCryptoType,
          address: cleanAddress,
          session,
        });
      }

      return withdrawal[0];
    });

    // ✅ Socket: make admin withdrawal page + admin user page live
    try {
      const io = req.app.get("io");
    
      const balanceAfter = Number(result.balanceAfter || 0);
    
      // ✅ Admin Users page balance live update
      io?.to("admins").emit("admin:userBalanceUpdated", {
        userId: user._id.toString(),
        user: {
          _id: user._id.toString(),
          uid: user.uid,
          phoneNumber: user.phoneNumber,
          balance: balanceAfter,
          displayBalance: balanceAfter,
          availableBalance: balanceAfter,
          shortBalance: balanceAfter,
          pendingAmount: 0,
          role: user.role,
        },
      });
    
      // ✅ Admin Withdrawal page live new row
      io?.to("admins").emit("admin:withdrawalCreated", {
        withdrawal: {
          _id: result._id.toString(),
          user: user._id.toString(),
          amount: Number(result.amount || 0),
          paymentMethod: result.paymentMethod,
          cryptoType: result.cryptoType,
          address: result.address || "",
          bankDetails: result.bankDetails || null,
          status: result.status,
          progressPercent: Number(result.progressPercent || 0),
          balanceBefore: Number(result.balanceBefore || 0),
          balanceAfter,
          createdAt: result.createdAt,
          updatedAt: result.updatedAt,
        },
        user: {
          _id: user._id.toString(),
          uid: user.uid,
          phoneNumber: user.phoneNumber,
          balance: balanceAfter,
        },
      });
    } catch (socketErr) {
      console.error("createWithdrawal socket emit failed:", socketErr.message);
    }

    return res.json({
      ok: true,
      message: "Withdrawal submitted successfully",
      withdrawal: result,
    });
  } catch (err) {
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

exports.getLastWithdrawalDetails = async (req, res) => {
  try {
    const userId = req.user.userId;
    const paymentMethod = normalizeMethod(req.query.paymentMethod);

    if (!paymentMethod) {
      return res.status(400).json({
        ok: false,
        message: "paymentMethod is required",
      });
    }

    if (!WITHDRAWAL_METHODS.includes(paymentMethod)) {
      return res.status(400).json({
        ok: false,
        message: "Invalid withdrawal method",
      });
    }

    const last = await Withdrawal.findOne({
      user: userId,
      paymentMethod,
    })
      .sort({ createdAt: -1 })
      .select("paymentMethod address bankDetails createdAt")
      .lean();

    return res.json({
      ok: true,
      item: last || null,
    });
  } catch (err) {
    console.error("getLastWithdrawalDetails error:", err);
    return res.status(500).json({
      ok: false,
      message: "Failed to fetch last withdrawal details",
    });
  }
};

// ✅ User can fetch all withdrawal methods + availability
exports.getWithdrawalMethods = async (req, res) => {
  try {
    const userId = req.user.userId;

    const user = await User.findById(userId).select("uid").lean();

    if (!user) {
      return res.status(404).json({
        ok: false,
        message: "User not found",
      });
    }

    const methods = await ensureWithdrawalMethods();

    const userUid = String(user.uid || "").trim();

    const visibleMethods = methods.filter((method) => {
      if (method.method !== "VIP_UAEFTS") return true;

      if (!method.isAvailable) return false;

      const allowedUids = Array.isArray(method.allowedUids)
        ? method.allowedUids.map((x) => String(x || "").trim()).filter(Boolean)
        : [];

      return allowedUids.includes(userUid);
    });

    return res.json({
      ok: true,
      methods: visibleMethods,
    });
  } catch (err) {
    console.error("getWithdrawalMethods error:", err);
    return res.status(500).json({
      ok: false,
      message: "Failed to fetch withdrawal methods",
    });
  }
};