const express = require("express");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const InvitationCode = require("../models/InvitationCode");

const router = express.Router();

// ✅ INVITE ONLY SIGNUP
router.post("/signup", async (req, res) => {
  try {
    const { phoneNumber, password, invitationCode } = req.body || {};

    if (!phoneNumber || !password || !invitationCode) {
      return res.status(400).json({
        message: "phoneNumber, password, invitationCode are required",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    // Normalize phone (remove spaces)
    const cleanPhone = phoneNumber.trim();

    // Check if user exists
    const existingUser = await User.findOne({ phoneNumber: cleanPhone });
    if (existingUser) {
      return res.status(409).json({ message: "Phone number already registered" });
    }

    // Validate invitation code
    const invite = await InvitationCode.findOne({
      code: invitationCode.trim().toUpperCase(),
    });

    if (!invite) {
      return res.status(400).json({ message: "Invalid invitation code" });
    }

    if (invite.isUsed) {
      return res.status(400).json({ message: "Invitation code already used" });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const ip =
      req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
      req.socket?.remoteAddress ||
      req.ip;

    const user = await User.create({
      phoneNumber: cleanPhone,
      password: hashedPassword,
      registeredIp: ip,
    });

    // Mark invite as used
    invite.isUsed = true;
    invite.usedBy = user._id;
    invite.usedAt = new Date();
    await invite.save();

    return res.status(201).json({
      message: "✅ Signup successful (invite accepted)",
      user: {
        id: user._id,
        phoneNumber: user.phoneNumber,
      },
    });
  } catch (err) {
    console.error("Signup Error:", err.message);
    return res.status(500).json({ message: "Server error" });
  }
});

const jwt = require("jsonwebtoken");

// ✅ LOGIN
router.post("/login", async (req, res) => {
  try {
    const { phoneNumber, password } = req.body;

    if (!phoneNumber || !password) {
      return res.status(400).json({ message: "phoneNumber and password are required" });
    }

    const cleanPhone = phoneNumber.trim();

    // Find user
    const user = await User.findOne({ phoneNumber: cleanPhone });
    if (!user) {
      return res.status(401).json({ message: "Invalid phone number or password" });
    }

    // User banned
    if (user.isBanned) {
      return res.status(403).json({ message: "Your account has been banned. Contact support." });
    }
    // Compare password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid phone number or password" });
    }

    // ✅ Update last online time
    user.lastOnlineAt = new Date();
    await user.save();

    // Create token
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

const { protect } = require("../middleware/auth");

router.get("/me", protect, async (req, res) => {
  const user = await User.findById(req.user.userId).select("-password");
  if (!user) return res.status(404).json({ message: "User not found" });

  res.json({ user });
});

module.exports = router;
