const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const ChatMessage = require("../models/ChatMessage");
const AdminNote = require("../models/AdminNote");

/**
 * upload folder
 */
const uploadDir = path.join(__dirname, "../uploads/chat");
fs.mkdirSync(uploadDir, { recursive: true });

/**
 * multer config
 */
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || "");
    const safeExt = ext || ".jpg";
    cb(
      null,
      `chat_${Date.now()}_${Math.random().toString(16).slice(2)}${safeExt}`
    );
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (!file.mimetype || !file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files are allowed"));
    }
    cb(null, true);
  },
});

/**
 * admin: list conversations
 */
router.get("/conversations", async (req, res) => {
  try {
    const rows = await ChatMessage.aggregate([
      { $sort: { createdAt: -1, _id: -1 } },
      {
        $group: {
          _id: "$userId",
          lastMessage: { $first: "$message" },
          lastTime: { $first: "$createdAt" },
          lastType: { $first: "$type" },
          imageUrl: { $first: "$imageUrl" },
          fileName: { $first: "$fileName" },
          sender: { $first: "$sender" },
          status: { $first: "$status" },
        },
      },
      { $sort: { lastTime: -1 } },
    ]);

    const conversations = rows.map((row) => ({
      userId: row._id,
      lastMessage:
        row.lastType === "image"
          ? row.lastMessage || "Image"
          : row.lastMessage || "",
      lastTime: row.lastTime,
      type: row.lastType || "text",
      imageUrl: row.imageUrl || "",
      fileName: row.fileName || "",
      sender: row.sender || "",
      status: row.status || "sent",
    }));

    res.json({ conversations });
  } catch (err) {
    console.error("chat conversations error:", err);
    res.status(500).json({ message: "Failed to fetch conversations" });
  }
});

/**
 * get messages for a user
 */
router.get("/messages/:userId", async (req, res) => {
  try {
    const userId = String(req.params.userId || "").trim();

    const rows = await ChatMessage.find({ userId })
      .sort({ createdAt: 1, _id: 1 })
      .lean();

    const messages = rows.map((row) => ({
      id: String(row._id),
      userId: row.userId,
      sender: row.sender,
      message: row.message || "",
      createdAt: row.createdAt,
      status: row.status || "sent",
      type: row.type || "text",
      imageUrl: row.imageUrl || "",
      fileName: row.fileName || "",
    }));

    res.json({ messages });
  } catch (err) {
    console.error("chat messages error:", err);
    res.status(500).json({ message: "Failed to fetch messages" });
  }
});

/**
 * upload image message
 * form-data:
 * - image
 * - userId
 * - sender (optional, default user)
 * - message (optional caption)
 */
router.post("/upload", upload.single("image"), async (req, res) => {
  try {
    const userId = String(req.body.userId || "").trim();
    const sender = String(req.body.sender || "user").trim();
    const message = String(req.body.message || "").trim();

    if (!userId) {
      return res.status(400).json({ message: "userId is required" });
    }

    if (!req.file) {
      return res.status(400).json({ message: "Image file is required" });
    }

    const createdAt = new Date();
    const imageUrl = `/uploads/chat/${req.file.filename}`;

    const saved = await ChatMessage.create({
      userId,
      sender,
      message,
      createdAt,
      status: "sent",
      type: "image",
      imageUrl,
      fileName: req.file.originalname || "",
    });

    return res.json({
      success: true,
      messageData: {
        id: String(saved._id),
        userId: saved.userId,
        sender: saved.sender,
        message: saved.message || "",
        createdAt: saved.createdAt,
        status: saved.status || "sent",
        type: saved.type || "image",
        imageUrl: saved.imageUrl || "",
        fileName: saved.fileName || "",
      },
    });
  } catch (err) {
    console.error("chat upload error:", err);
    res.status(500).json({ message: err.message || "Upload failed" });
  }
});

/**
 * admin-only nickname get
 */
router.get("/admin-nickname/:userId", async (req, res) => {
  try {
    const userId = String(req.params.userId || "").trim();

    const row = await AdminNote.findOne({ userId }).lean();

    res.json({ nickname: row?.nickname || "" });
  } catch (err) {
    console.error("nickname get error:", err);
    res.status(500).json({ message: "Failed to fetch nickname" });
  }
});

/**
 * admin-only nickname patch
 */
router.patch("/admin-nickname/:userId", async (req, res) => {
  try {
    const userId = String(req.params.userId || "").trim();
    const nickname = String(req.body?.nickname || "")
      .trim()
      .slice(0, 40);
    const updatedAt = new Date();

    await AdminNote.findOneAndUpdate(
      { userId },
      { userId, nickname, updatedAt },
      { upsert: true, new: true }
    );

    res.json({ userId, nickname, updatedAt });
  } catch (err) {
    console.error("nickname patch error:", err);
    res.status(500).json({ message: "Failed to save nickname" });
  }
});

module.exports = router;