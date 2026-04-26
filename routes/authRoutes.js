const express = require("express");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const WalletTransaction = require("../models/WalletTransaction");
const mongoose = require("mongoose");
const { getLedgerTotal } = require("../utils/balance");
const UserOrder = require("../models/UserOrder");
const VipConfig = require("../models/VipConfig");
const AdminPopup = require("../models/AdminPopup");
const AdminPopupUserState = require("../models/AdminPopupUserState");
const AdminNotification = require("../models/AdminNotification");

const router = express.Router();
const jwt = require("jsonwebtoken");
const { protect } = require("../middleware/auth");

const REFERRAL_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateReferralCode(length = 8) {
  let code = "";
  for (let i = 0; i < length; i++) {
    const idx = Math.floor(Math.random() * REFERRAL_CHARS.length);
    code += REFERRAL_CHARS[idx];
  }
  return code;
}

async function createUniqueReferralCode() {
  let code;
  let exists = true;

  while (exists) {
    code = generateReferralCode(8);
    exists = await User.findOne({ referralCode: code }).lean();
  }

  return code;
}

// ✅ INVITE ONLY SIGNUP
router.post("/signup", async (req, res) => {
  try {
    const { phoneNumber, password, referralCode } = req.body || {};

    if (!phoneNumber || !password || !referralCode) {
      return res.status(400).json({
        message: "phoneNumber, password and referralCode are required",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        message: "Password must be at least 6 characters",
      });
    }

    const cleanPhone = phoneNumber.trim();
    const cleanReferralCode = String(referralCode).trim().toUpperCase();

    const existingUser = await User.findOne({ phoneNumber: cleanPhone });
    if (existingUser) {
      return res.status(409).json({ message: "Phone number already registered" });
    }

    const referrer = await User.findOne({ referralCode: cleanReferralCode });
    if (!referrer) {
      return res.status(400).json({ message: "Invalid referral code" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const rawIp =
      req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
      req.socket?.remoteAddress ||
      req.ip;
    
    const ip = String(rawIp || "")
      .replace("::ffff:", "")
      .trim();
    
    let registeredCountry = null;

    try {
      if (
        ip &&
        ip !== "::1" &&
        ip !== "127.0.0.1" &&
        !ip.startsWith("192.168.") &&
        !ip.startsWith("10.") &&
        !ip.startsWith("172.")
      ) {
        const resp = await fetch(
          `https://api.ipinfo.io/lite/${encodeURIComponent(ip)}?token=${process.env.IPINFO_TOKEN}`
        );
    
        if (resp.ok) {
          const geo = await resp.json();
    
          const rawCountry =
            geo?.country_code ||
            geo?.country ||
            null;
    
          const normalized = String(rawCountry || "").trim().toUpperCase();
    
          registeredCountry = /^[A-Z]{2}$/.test(normalized)
            ? normalized
            : null;
        } else {
          const text = await resp.text();
          console.log("IPinfo Lite failed:", resp.status, ip, text);
        }
      }
    } catch (e) {
      console.error("IP country lookup failed:", e.message);
    }
    
    const myReferralCode = await createUniqueReferralCode();

    const user = await User.create({
      phoneNumber: cleanPhone,
      password: hashedPassword,
      registeredIp: ip,
      registeredCountry,
      referralCode: myReferralCode,
      referredBy: referrer._id,
      referredByCode: referrer.referralCode,
    });

    // ✅ Duplicate register IP notification
    try {
      const normalizedIp = String(ip || "")
        .replace("::ffff:", "")
        .trim();
    
      if (
        normalizedIp &&
        normalizedIp !== "::1" &&
        normalizedIp !== "127.0.0.1" &&
        !normalizedIp.startsWith("192.168.") &&
        !normalizedIp.startsWith("10.") &&
        !normalizedIp.startsWith("172.")
      ) {
        const matchedUser = await User.findOne({
          _id: { $ne: user._id },
          registeredIp: normalizedIp,
        }).lean();
    
        if (matchedUser) {
          await AdminNotification.create({
            type: "DUPLICATE_REGISTER_IP",
            title: "Duplicate register IP detected",
            message: `A register IP is being used by more than one user.`,
            user: user._id,
            relatedUser: matchedUser._id,
            ip: normalizedIp,
          });
        }
      }
    } catch (notifyErr) {
      console.error("Duplicate register IP notification failed:", notifyErr.message);
    }

    return res.status(201).json({
      message: "Signup successful",
      user: {
        id: user._id,
        phoneNumber: user.phoneNumber,
        referralCode: user.referralCode,
        referredBy: {
          id: referrer._id,
          phoneNumber: referrer.phoneNumber,
          referralCode: referrer.referralCode,
        },
      },
    });
  } catch (err) {
    console.error("Signup Error:", err.message);
    return res.status(500).json({ message: "Server error" });
  }
});

// ✅ LOGIN
router.post("/login", async (req, res) => {
  try {
    const { phoneNumber, password } = req.body;

    if (!phoneNumber || !password) {
      return res.status(400).json({ message: "phoneNumber and password are required" });
    }

    const cleanPhone = phoneNumber.trim();

    const user = await User.findOne({ phoneNumber: cleanPhone });
    if (!user) {
      return res.status(401).json({ message: "Invalid phone number or password" });
    }

    if (user.isBanned) {
      return res.status(403).json({ message: "Your account has been banned. Contact support." });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid phone number or password" });
    }

    user.lastOnlineAt = new Date();
    await user.save();

    const token = jwt.sign(
      { userId: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES || "7d" }
    );

    return res.json({
      message: "✅ Login successful",
      token,
      user: {
        id: user._id,
        phoneNumber: user.phoneNumber,
        role: user.role,
      },
    });
  } catch (err) {
    console.error("Login Error:", err.message);
    return res.status(500).json({ message: "Server error" });
  }
});

// ✅ me
router.get("/me", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId)
      .select("-password")
      .populate("referredBy", "phoneNumber referralCode")
      .lean();

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    let config = await VipConfig.findOne().lean();
    if (!config) config = await VipConfig.create({});

    const ranks = Array.isArray(config.ranks) ? config.ranks : [];
    const vipRank = Number(user.vipRank || 1);
    const vip = ranks.find((r) => Number(r.rank) === vipRank) || ranks[0];
    const derivedOrdersLimit = Number(vip?.ordersLimit || user.ordersLimit || 40);

    const cleanBalance = Number(user.balance || 0);
    const availableBalance = cleanBalance;

    const creditAgg = await WalletTransaction.aggregate([
      {
        $match: {
          userId: new mongoose.Types.ObjectId(user._id),
          type: "TRIAL_CREDIT",
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$amount" },
        },
      },
    ]);

    const revAgg = await WalletTransaction.aggregate([
      {
        $match: {
          userId: new mongoose.Types.ObjectId(user._id),
          type: "TRIAL_REVERSAL",
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$amount" },
        },
      },
    ]);

    const credited = Number(creditAgg[0]?.total || 0);
    const reversed = Math.abs(Number(revAgg[0]?.total || 0));
    const trialBonusRemaining = Math.max(0, credited - reversed);

    const now = new Date();

    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);

    const dailyCommissionAgg = await UserOrder.aggregate([
      {
        $match: {
          user: new mongoose.Types.ObjectId(user._id),
          status: "COMPLETED",
          completedAt: { $gte: startOfDay, $lte: endOfDay },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$commission" },
        },
      },
    ]);

    const dailyCommission = Number(dailyCommissionAgg[0]?.total || 0);

    return res.json({
      user: {
        ...user,
        ordersLimit: derivedOrdersLimit,
        balance: cleanBalance,
        availableBalance,
        trialBonusRemaining,
        dailyCommission,
        withdrawalBlocked: Boolean(user.withdrawalBlocked),
        withdrawalBlockedReason: user.withdrawalBlockedReason || "",
        withdrawalBlockedAt: user.withdrawalBlockedAt || null,
      },
    });
  } catch (err) {
    console.error("GET /me error:", err);
    return res.status(500).json({ message: "Server error" });
  }
});

// ✅ CHANGE PASSWORD (requires old password)
router.post("/change-password", protect, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { oldPassword, newPassword } = req.body || {};

    if (!oldPassword || !newPassword) {
      return res.status(400).json({
        message: "oldPassword and newPassword are required",
      });
    }

    if (String(newPassword).length < 6) {
      return res.status(400).json({
        message: "New password must be at least 6 characters",
      });
    }

    const user = await User.findById(userId).select("+password");
    if (!user) return res.status(404).json({ message: "User not found" });

    const isMatch = await bcrypt.compare(String(oldPassword), user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Old password is incorrect" });
    }

    const hashed = await bcrypt.hash(String(newPassword), 10);
    user.password = hashed;
    await user.save();

    return res.json({
      ok: true,
      message: "✅ Password updated successfully",
    });
  } catch (err) {
    console.error("change-password error:", err);
    return res.status(500).json({
      message: "Server error",
    });
  }
});

router.get("/popup/current", protect, async (req, res) => {
  try {
    const userId = req.user.userId;
    const now = new Date();

    const popups = await AdminPopup.find({
      isActive: true,
      $or: [
        { targetType: "all" },
        { targetType: "specific", targetUsers: userId },
      ],
    })
      .sort({ createdAt: -1 })
      .lean();

    if (!popups.length) {
      return res.json({ ok: true, popup: null });
    }

    for (const popup of popups) {
      const state = await AdminPopupUserState.findOne({
        popupId: popup._id,
        userId,
      }).lean();

      if (!state || !state.hiddenUntil || new Date(state.hiddenUntil) <= now) {
        return res.json({
          ok: true,
          popup: {
            _id: popup._id,
            title: popup.title,
            message: popup.message,
            targetType: popup.targetType,
            createdAt: popup.createdAt,
          },
        });
      }
    }

    return res.json({ ok: true, popup: null });
  } catch (err) {
    console.error("get current popup error:", err);
    return res.status(500).json({ ok: false, message: err.message || "Server error" });
  }
});

router.post("/popup/:popupId/hide", protect, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { popupId } = req.params;

    const popup = await AdminPopup.findById(popupId).lean();
    if (!popup || !popup.isActive) {
      return res.status(404).json({ ok: false, message: "Popup not found" });
    }

    const isAllowed =
      popup.targetType === "all" ||
      (popup.targetType === "specific" &&
        Array.isArray(popup.targetUsers) &&
        popup.targetUsers.some((id) => String(id) === String(userId)));

    if (!isAllowed) {
      return res.status(403).json({ ok: false, message: "Not allowed for this popup" });
    }

    const hiddenUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const state = await AdminPopupUserState.findOneAndUpdate(
      { popupId, userId },
      { $set: { hiddenUntil } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    return res.json({
      ok: true,
      message: "✅ Popup hidden for 24 hours",
      hiddenUntil: state.hiddenUntil,
    });
  } catch (err) {
    console.error("hide popup error:", err);
    return res.status(500).json({ ok: false, message: err.message || "Server error" });
  }
});

module.exports = router;
