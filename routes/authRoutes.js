const express = require("express");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const WalletTransaction = require("../models/WalletTransaction");
const mongoose = require("mongoose");
const { getLedgerTotal } = require("../utils/balance");

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

    const ip =
      req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
      req.socket?.remoteAddress ||
      req.ip;

    const myReferralCode = await createUniqueReferralCode();

    const user = await User.create({
      phoneNumber: cleanPhone,
      password: hashedPassword,
      registeredIp: ip,
      referralCode: myReferralCode,
      referredBy: referrer._id,
      referredByCode: referrer.referralCode,
    });

    return res.status(201).json({
      message: "✅ Signup successful",
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

// ✅ ME
router.get("/me", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId)
      .select("-password")
      .populate("referredBy", "phoneNumber referralCode")
      .lean();

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const cleanBalance = Number(user.balance || 0);
    const ledgerTotal = await getLedgerTotal(user._id);
    const availableBalance = cleanBalance + Number(ledgerTotal || 0);

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

    return res.json({
      user: {
        ...user,
        balance: cleanBalance,
        availableBalance,
        trialBonusRemaining,
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

module.exports = router;
