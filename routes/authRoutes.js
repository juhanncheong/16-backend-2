const express = require("express");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const WalletTransaction = require("../models/WalletTransaction");
const mongoose = require("mongoose");
const UserOrder = require("../models/UserOrder");
const VipConfig = require("../models/VipConfig");
const AdminPopup = require("../models/AdminPopup");
const AdminPopupUserState = require("../models/AdminPopupUserState");
const AdminNotification = require("../models/AdminNotification");
const speakeasy = require("speakeasy");
const QRCode = require("qrcode");

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

function generateEmailCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

async function sendBrevoEmailVerification({ toEmail, code, uid }) {
  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.BREVO_SENDER_EMAIL;
  const senderName = process.env.BREVO_SENDER_NAME || "NexArbitech";
  const templateId = Number(process.env.BREVO_EMAIL_VERIFY_TEMPLATE_ID);

  if (!apiKey) {
    throw new Error("Missing BREVO_API_KEY");
  }

  if (!senderEmail) {
    throw new Error("Missing BREVO_SENDER_EMAIL");
  }

  if (!templateId) {
    throw new Error("Missing BREVO_EMAIL_VERIFY_TEMPLATE_ID");
  }

  const resp = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "accept": "application/json",
      "content-type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify({
      sender: {
        name: senderName,
        email: senderEmail,
      },
      to: [
        {
          email: toEmail,
        },
      ],
      templateId,
      params: {
        code,
        uid,
      },
    }),
  });

  const data = await resp.json().catch(() => ({}));

  if (!resp.ok) {
    console.error("Brevo send failed:", resp.status, data);
    throw new Error(data?.message || "Failed to send verification email");
  }

  return data;
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

    const getHeaderValue = (value) => {
      if (Array.isArray(value)) return value[0];
      return value;
    };
    
    const cfIp = getHeaderValue(req.headers["cf-connecting-ip"]);
    const realIp = getHeaderValue(req.headers["x-real-ip"]);
    const clientIp = getHeaderValue(req.headers["x-client-ip"]);
    const forwardedFor = getHeaderValue(req.headers["x-forwarded-for"]);
    
    const rawIp =
      clientIp ||
      realIp ||
      forwardedFor?.split(",")[0]?.trim() ||
      cfIp ||
      req.ip ||
      req.socket?.remoteAddress;
    
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

    // ✅ Socket: notify admin panel new user registered
    try {
      const io = req.app.get("io");
    
      io?.to("admins").emit("admin:userCreated", {
        user: {
          _id: user._id,
          id: user._id,
          uid: user.uid,
          phoneNumber: user.phoneNumber,
          balance: user.balance || 0,
          displayBalance: user.balance || 0,
          pendingAmount: 0,
          ordersCompleted: user.ordersCompleted || 0,
          ordersLimit: user.ordersLimit || 40,
          totalResetCount: user.totalResetCount || 1,
          role: user.role || "user",
          vipRank: user.vipRank || 1,
          creditScore: user.creditScore ?? 100,
          registeredIp: user.registeredIp || "",
          registeredCountry: user.registeredCountry || "",
          referralCode: user.referralCode || "",
          referredBy: {
            _id: referrer._id,
            phoneNumber: referrer.phoneNumber,
            referralCode: referrer.referralCode,
          },
          isBanned: Boolean(user.isBanned),
          withdrawalBlocked: Boolean(user.withdrawalBlocked),
          withdrawalBlockedReason: user.withdrawalBlockedReason || "",
          withdrawalBlockedAt: user.withdrawalBlockedAt || null,
          withdrawPinFailedAttempts: user.withdrawPinFailedAttempts || 0,
          withdrawPinLocked: Boolean(user.withdrawPinLocked),
          signinRewardEnabled: Boolean(user.signinRewardEnabled),
          lastOnlineAt: user.lastOnlineAt || null,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        },
      });
    } catch (socketErr) {
      console.error("admin:userCreated socket emit failed:", socketErr.message);
    }

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

    const user = await User.findOne({ phoneNumber: cleanPhone }).select("+twoFactorSecret");
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

    // ✅ Normal users login normally
    if (user.role !== "admin") {
      user.lastOnlineAt = new Date();
      await user.save();

      const token = jwt.sign(
        { userId: user._id, role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES || "7d" }
      );

      return res.json({
        message: "Login successful",
        token,
        user: {
          id: user._id,
          phoneNumber: user.phoneNumber,
          role: user.role,
        },
      });
    }

    // ✅ Admin has not set up Google Authenticator yet
    if (!user.twoFactorEnabled || !user.twoFactorSecret) {
      const setupToken = jwt.sign(
        {
          userId: user._id,
          role: user.role,
          purpose: "ADMIN_2FA_SETUP",
        },
        process.env.JWT_SECRET,
        { expiresIn: "10m" }
      );

      return res.json({
        ok: true,
        message: "Google Authenticator setup required",
        setup2FARequired: true,
        setupToken,
        user: {
          id: user._id,
          phoneNumber: user.phoneNumber,
          role: user.role,
        },
      });
    }

    // ✅ Admin already has Google Authenticator enabled
    const tempToken = jwt.sign(
      {
        userId: user._id,
        role: user.role,
        purpose: "ADMIN_2FA_LOGIN",
      },
      process.env.JWT_SECRET,
      { expiresIn: "10m" }
    );

    return res.json({
      ok: true,
      message: "Google Authenticator code required",
      twoFactorRequired: true,
      tempToken,
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

// ✅ Admin 2FA setup QR
router.post("/admin/2fa/setup", async (req, res) => {
  try {
    const { setupToken } = req.body || {};

    if (!setupToken) {
      return res.status(400).json({ message: "setupToken is required" });
    }

    const decoded = jwt.verify(setupToken, process.env.JWT_SECRET);

    if (decoded.purpose !== "ADMIN_2FA_SETUP" || decoded.role !== "admin") {
      return res.status(401).json({ message: "Invalid setup token" });
    }

    const user = await User.findById(decoded.userId).select("+twoFactorSecret");

    if (!user || user.role !== "admin") {
      return res.status(404).json({ message: "Admin not found" });
    }

    if (user.twoFactorEnabled) {
      return res.status(400).json({ message: "Google Authenticator is already enabled" });
    }

    const secret = speakeasy.generateSecret({
      name: `16 Group Admin (${user.phoneNumber})`,
    });

    user.twoFactorSecret = secret.base32;
    user.twoFactorEnabled = false;
    await user.save();

    const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);

    return res.json({
      ok: true,
      qrCodeUrl,
      manualKey: secret.base32,
    });
  } catch (err) {
    console.error("2FA setup error:", err.message);
    return res.status(401).json({ message: "Invalid or expired setup token" });
  }
});

// ✅ Admin verify first 2FA setup
router.post("/admin/2fa/verify-setup", async (req, res) => {
  try {
    const { setupToken, code } = req.body || {};

    if (!setupToken || !code) {
      return res.status(400).json({ message: "setupToken and code are required" });
    }

    const decoded = jwt.verify(setupToken, process.env.JWT_SECRET);

    if (decoded.purpose !== "ADMIN_2FA_SETUP" || decoded.role !== "admin") {
      return res.status(401).json({ message: "Invalid setup token" });
    }

    const user = await User.findById(decoded.userId).select("+twoFactorSecret");

    if (!user || user.role !== "admin") {
      return res.status(404).json({ message: "Admin not found" });
    }

    if (!user.twoFactorSecret) {
      return res.status(400).json({ message: "Google Authenticator setup not started" });
    }

    const verified = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: "base32",
      token: String(code).trim(),
      window: 1,
    });

    if (!verified) {
      return res.status(400).json({ message: "Invalid Google Authenticator code" });
    }

    user.twoFactorEnabled = true;
    user.lastOnlineAt = new Date();
    await user.save();

    const token = jwt.sign(
      { userId: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES || "7d" }
    );

    return res.json({
      ok: true,
      message: "Google Authenticator enabled",
      token,
      user: {
        id: user._id,
        phoneNumber: user.phoneNumber,
        role: user.role,
      },
    });
  } catch (err) {
    console.error("2FA verify setup error:", err.message);
    return res.status(401).json({ message: "Invalid or expired setup token" });
  }
});

// ✅ Admin verify 2FA login
router.post("/admin/2fa/verify-login", async (req, res) => {
  try {
    const { tempToken, code } = req.body || {};

    if (!tempToken || !code) {
      return res.status(400).json({ message: "tempToken and code are required" });
    }

    const decoded = jwt.verify(tempToken, process.env.JWT_SECRET);

    if (decoded.purpose !== "ADMIN_2FA_LOGIN" || decoded.role !== "admin") {
      return res.status(401).json({ message: "Invalid temp token" });
    }

    const user = await User.findById(decoded.userId).select("+twoFactorSecret");

    if (!user || user.role !== "admin") {
      return res.status(404).json({ message: "Admin not found" });
    }

    if (!user.twoFactorEnabled || !user.twoFactorSecret) {
      return res.status(400).json({ message: "Google Authenticator is not enabled" });
    }

    if (user.isBanned) {
      return res.status(403).json({ message: "Your account has been banned. Contact support." });
    }

    const verified = speakeasy.totp.verify({
      secret: user.twoFactorSecret,
      encoding: "base32",
      token: String(code).trim(),
      window: 1,
    });

    if (!verified) {
      return res.status(400).json({ message: "Invalid Google Authenticator code" });
    }

    user.lastOnlineAt = new Date();
    await user.save();

    const token = jwt.sign(
      { userId: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES || "7d" }
    );

    return res.json({
      ok: true,
      message: "Login successful",
      token,
      user: {
        id: user._id,
        phoneNumber: user.phoneNumber,
        role: user.role,
      },
    });
  } catch (err) {
    console.error("2FA login error:", err.message);
    return res.status(401).json({ message: "Invalid or expired temp token" });
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

// ✅ SEND EMAIL VERIFICATION CODE
router.post("/email/send-code", protect, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { email } = req.body || {};

    const cleanEmail = String(email || "").trim().toLowerCase();

    if (!cleanEmail) {
      return res.status(400).json({
        ok: false,
        message: "Email is required",
      });
    }

    if (!isValidEmail(cleanEmail)) {
      return res.status(400).json({
        ok: false,
        message: "Invalid email address",
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        ok: false,
        message: "User not found",
      });
    }

    if (user.emailVerified && user.email === cleanEmail) {
      return res.status(400).json({
        ok: false,
        message: "This email is already verified",
      });
    }

    if (
      user.emailVerificationExpires &&
      new Date(user.emailVerificationExpires).getTime() > Date.now()
    ) {
      const remainingMs = new Date(user.emailVerificationExpires).getTime() - Date.now();
      const remainingSeconds = Math.ceil(remainingMs / 1000);
    
      return res.status(429).json({
        ok: false,
        message: `Please wait ${remainingSeconds} seconds before requesting a new code.`,
        retryAfterSeconds: remainingSeconds,
      });
    }

    const existingEmailUser = await User.findOne({
      email: cleanEmail,
      _id: { $ne: user._id },
    }).lean();

    if (existingEmailUser) {
      return res.status(409).json({
        ok: false,
        message: "This email is already used by another account",
      });
    }

    const code = generateEmailCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    user.email = cleanEmail;
    user.emailVerified = false;
    user.emailVerificationCode = code;
    user.emailVerificationExpires = expiresAt;

    await user.save();

    await sendBrevoEmailVerification({
      toEmail: user.email,
      code,
      uid: user.uid,
    });
    
    return res.json({
      ok: true,
      message: "Verification code sent successfully",
      email: user.email,
      uid: user.uid,
      expiresAt,
    });
  } catch (err) {
    console.error("send email verification code error:", err);
    return res.status(500).json({
      ok: false,
      message: "Server error",
    });
  }
});

// ✅ VERIFY EMAIL CODE
router.post("/email/verify-code", protect, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { code } = req.body || {};

    const cleanCode = String(code || "").trim();

    if (!cleanCode) {
      return res.status(400).json({
        ok: false,
        message: "Verification code is required",
      });
    }

    if (!/^\d{6}$/.test(cleanCode)) {
      return res.status(400).json({
        ok: false,
        message: "Verification code must be 6 digits",
      });
    }

    const user = await User.findById(userId).select(
      "+emailVerificationCode +emailVerificationExpires"
    );

    if (!user) {
      return res.status(404).json({
        ok: false,
        message: "User not found",
      });
    }

    if (!user.email) {
      return res.status(400).json({
        ok: false,
        message: "No email found. Please send a verification code first.",
      });
    }

    if (user.emailVerified) {
      return res.status(400).json({
        ok: false,
        message: "Email is already verified",
      });
    }

    if (!user.emailVerificationCode || !user.emailVerificationExpires) {
      return res.status(400).json({
        ok: false,
        message: "No verification code found. Please request a new code.",
      });
    }

    if (new Date(user.emailVerificationExpires).getTime() < Date.now()) {
      user.emailVerificationCode = null;
      user.emailVerificationExpires = null;
      await user.save();

      return res.status(400).json({
        ok: false,
        message: "Verification code has expired. Please request a new code.",
      });
    }

    if (user.emailVerificationCode !== cleanCode) {
      return res.status(400).json({
        ok: false,
        message: "Invalid verification code",
      });
    }

    user.emailVerified = true;
    user.emailVerificationCode = null;
    user.emailVerificationExpires = null;

    await user.save();

    return res.json({
      ok: true,
      message: "Email verified successfully",
      email: user.email,
      uid: user.uid,
      emailVerified: user.emailVerified,
    });
  } catch (err) {
    console.error("verify email code error:", err);
    return res.status(500).json({
      ok: false,
      message: "Server error",
    });
  }
});

module.exports = router;
