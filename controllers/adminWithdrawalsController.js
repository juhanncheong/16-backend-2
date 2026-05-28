const mongoose = require("mongoose");
const Withdrawal = require("../models/Withdrawal");
const User = require("../models/User");
const RecentWithdrawalAddress = require("../models/RecentWithdrawalAddress");
const WithdrawalMethodConfig = require("../models/WithdrawalMethodConfig");

const {
  createEntrepreneurOfferAfterFirstWithdrawal,
} = require("../utils/entrepreneurBonusAutomation");

const WITHDRAWAL_METHODS = [
  "CRYPTO",
  "BANK_FASTER_PAYMENTS",
  "BANK_SEPA",
  "WISE",
  "UAEFTS",
  "VIP_UAEFTS",
];

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

exports.adminListWithdrawalMethodConfigs = async (req, res) => {
  try {
    const existing = await WithdrawalMethodConfig.find({
      method: { $in: WITHDRAWAL_METHODS },
    }).lean();

    const existingMap = new Map(existing.map((x) => [x.method, x]));

    const missingMethods = WITHDRAWAL_METHODS.filter(
      (method) => !existingMap.has(method)
    );

    if (missingMethods.length > 0) {
      await WithdrawalMethodConfig.insertMany(
        missingMethods.map((method) => ({
          method,
          isAvailable: true,
          minAmount: 10,
          maxAmount: 999999,
          note: "",
          updatedBy: null,
        })),
        { ordered: false }
      ).catch((err) => {
        if (err?.code !== 11000) throw err;
      });
    }

    const methods = await WithdrawalMethodConfig.find({
      method: { $in: WITHDRAWAL_METHODS },
    })
      .sort({ createdAt: 1 })
      .lean();

    const ordered = WITHDRAWAL_METHODS.map((method) => {
      const found = methods.find((x) => x.method === method);
    
      if (!found) {
        return {
          method,
          isAvailable: true,
          minAmount: 10,
          maxAmount: 999999,
          note: "",
          allowedUids: [],
          updatedBy: null,
          updatedAt: null,
        };
      }
    
      return {
        ...found,
        minAmount: Number.isFinite(Number(found.minAmount))
          ? Number(found.minAmount)
          : 10,
        maxAmount: Number.isFinite(Number(found.maxAmount))
          ? Number(found.maxAmount)
          : 999999,
        allowedUids: Array.isArray(found.allowedUids)
          ? found.allowedUids
          : [],
      };
    });

    return res.json({ ok: true, methods: ordered });
  } catch (err) {
    console.error("adminListWithdrawalMethodConfigs error:", err);
    return res.status(500).json({
      ok: false,
      message: err.message || "Server error",
    });
  }
};

exports.adminToggleWithdrawalMethod = async (req, res) => {
  try {
    const cleanMethod = String(req.params.method || "").trim().toUpperCase();
    const { isAvailable, note, minAmount, maxAmount, allowedUids } = req.body || {};

    if (!WITHDRAWAL_METHODS.includes(cleanMethod)) {
      return res.status(400).json({
        ok: false,
        message: "Invalid withdrawal method",
      });
    }

    const updateSet = {
      updatedBy: req.user?.userId || req.user?._id || null,
      updatedAt: new Date(),
    };

    if (isAvailable !== undefined) {
      updateSet.isAvailable = Boolean(isAvailable);
    }

    if (note !== undefined) {
      updateSet.note = String(note || "").trim();
    }

    if (minAmount !== undefined) {
      const cleanMin = Number(minAmount);

      if (!Number.isFinite(cleanMin) || cleanMin < 0) {
        return res.status(400).json({
          ok: false,
          message: "minAmount must be a valid number greater than or equal to 0",
        });
      }

      updateSet.minAmount = Math.round(cleanMin * 100) / 100;
    }

    if (maxAmount !== undefined) {
      const cleanMax = Number(maxAmount);

      if (!Number.isFinite(cleanMax) || cleanMax < 0) {
        return res.status(400).json({
          ok: false,
          message: "maxAmount must be a valid number greater than or equal to 0",
        });
      }

      updateSet.maxAmount = Math.round(cleanMax * 100) / 100;
    }

    // ✅ Only VIP_UAEFTS supports UID allowlist
    if (allowedUids !== undefined) {
      if (cleanMethod !== "VIP_UAEFTS") {
        return res.status(400).json({
          ok: false,
          message: "allowedUids can only be updated for VIP_UAEFTS",
        });
      }

      let cleanAllowedUids = [];

      if (Array.isArray(allowedUids)) {
        cleanAllowedUids = allowedUids
          .map((x) => String(x || "").trim())
          .filter(Boolean);
      } else if (typeof allowedUids === "string") {
        cleanAllowedUids = allowedUids
          .split(/[,\n]/)
          .map((x) => x.trim())
          .filter(Boolean);
      } else {
        return res.status(400).json({
          ok: false,
          message: "allowedUids must be an array or comma/newline separated string",
        });
      }

      // remove duplicate UIDs
      updateSet.allowedUids = [...new Set(cleanAllowedUids)];
    }    

    const existing = await WithdrawalMethodConfig.findOne({
      method: cleanMethod,
    }).lean();

    const finalMin =
      updateSet.minAmount !== undefined
        ? updateSet.minAmount
        : Number.isFinite(Number(existing?.minAmount))
        ? Number(existing.minAmount)
        : 10;

    const finalMax =
      updateSet.maxAmount !== undefined
        ? updateSet.maxAmount
        : Number.isFinite(Number(existing?.maxAmount))
        ? Number(existing.maxAmount)
        : 999999;

    if (finalMax < finalMin) {
      return res.status(400).json({
        ok: false,
        message: "maxAmount must be greater than or equal to minAmount",
      });
    }

    const item = await WithdrawalMethodConfig.findOneAndUpdate(
      { method: cleanMethod },
      {
        $set: updateSet,

        // ✅ Important:
        // Do NOT put isAvailable, minAmount, maxAmount, or note here.
        // They may also exist in $set, causing MongoDB conflict.
        $setOnInsert: {
          method: cleanMethod,
        },
      },
      {
        upsert: true,
        new: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      }
    ).lean();

    return res.json({
      ok: true,
      message: `${cleanMethod} updated successfully`,
      item,
    });
  } catch (err) {
    console.error("adminToggleWithdrawalMethod error:", err);
    return res.status(500).json({
      ok: false,
      message: err.message || "Server error",
    });
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
    wd.progressPercent = 100;
    wd.progressUpdatedBy = req.user.userId || req.user._id;
    wd.progressUpdatedAt = new Date();
    wd.adminActionBy = req.user._id;
    wd.actionAt = new Date();

    await wd.save();

    // ✅ Auto-create entrepreneur bonus event only after user's FIRST EVER approved withdrawal
    let entrepreneurBonusResult = null;
    
    try {
      entrepreneurBonusResult = await createEntrepreneurOfferAfterFirstWithdrawal({
        userId: wd.user,
        withdrawalId: wd._id,
        adminId: req.user?.userId || req.user?._id || null,
      });
    } catch (bonusErr) {
      // ✅ Do not break withdrawal approval if bonus automation has an issue
      console.error("entrepreneur bonus auto-create error:", bonusErr);
    }
    
    return res.json({
      ok: true,
      message: "Withdrawal approved",
      withdrawal: wd,
      entrepreneurBonus: entrepreneurBonusResult,
    });
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
    wd.progressPercent = 0;
    wd.progressUpdatedBy = req.user.userId || req.user._id;
    wd.progressUpdatedAt = new Date();
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

// ✅ Admin: update withdrawal progress percentage
exports.adminUpdateWithdrawalProgress = async (req, res) => {
  try {
    const { id } = req.params;
    const progressPercent = Number(req.body.progressPercent);

    if (!Number.isFinite(progressPercent)) {
      return res.status(400).json({
        ok: false,
        message: "progressPercent must be a number",
      });
    }

    if (progressPercent < 0 || progressPercent > 100) {
      return res.status(400).json({
        ok: false,
        message: "progressPercent must be between 0 and 100",
      });
    }

    const wd = await Withdrawal.findById(id);
    if (!wd) {
      return res.status(404).json({
        ok: false,
        message: "Withdrawal not found",
      });
    }

    wd.progressPercent = Math.round(progressPercent * 100) / 100;
    wd.progressUpdatedBy = req.user.userId || req.user._id;
    wd.progressUpdatedAt = new Date();

    await wd.save();

    return res.json({
      ok: true,
      message: "✅ Withdrawal progress updated",
      withdrawal: wd,
    });
  } catch (err) {
    console.error("adminUpdateWithdrawalProgress error:", err);
    return res.status(500).json({
      ok: false,
      message: err.message || "Server error",
    });
  }
};