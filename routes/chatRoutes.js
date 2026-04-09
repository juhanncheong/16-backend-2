const express = require("express");
const router = express.Router();
const chatDB = require("../chatDB");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

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
    cb(null, `chat_${Date.now()}_${Math.random().toString(16).slice(2)}${safeExt}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (!file.mimetype || !file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files are allowed"));
    }
    cb(null, true);
  }
});

/**
 * one-time: create admin_notes table
 */
chatDB
  .prepare(`
    CREATE TABLE IF NOT EXISTS admin_notes (
      userId TEXT PRIMARY KEY,
      nickname TEXT,
      updatedAt TEXT
    )
  `)
  .run();

/**
 * helper
 */
function safeGetConversations() {
  try {
    const rows = chatDB
      .prepare(`
        SELECT 
          userId,
          MAX(createdAt) AS lastTime,
          (
            SELECT message
            FROM chat_messages m2
            WHERE m2.userId = chat_messages.userId
            ORDER BY id DESC
            LIMIT 1
          ) AS lastMessage
        FROM chat_messages
        GROUP BY userId
        ORDER BY lastTime DESC
      `)
      .all();

    return rows || [];
  } catch (e) {
    console.error("safeGetConversations error:", e);
    return [];
  }
}

/**
 * admin: list conversations
 */
router.get("/conversations", (req, res) => {
  try {
    const rows = chatDB
      .prepare(`
        SELECT 
          userId,
          (
            SELECT message
            FROM chat_messages m2
            WHERE m2.userId = m.userId
            ORDER BY id DESC
            LIMIT 1
          ) AS lastMessage,
          (
            SELECT createdAt
            FROM chat_messages m2
            WHERE m2.userId = m.userId
            ORDER BY id DESC
            LIMIT 1
          ) AS lastTime
        FROM chat_messages m
        GROUP BY userId
        ORDER BY MAX(id) DESC
      `)
      .all();

    res.json({ conversations: rows || [] });
  } catch (err) {
    console.error("chat conversations error:", err);
    res.status(500).json({ message: "Failed to fetch conversations" });
  }
});

/**
 * get messages for a user
 */
router.get("/messages/:userId", (req, res) => {
  try {
    const userId = req.params.userId;

    const rows = chatDB
      .prepare(`
        SELECT id, sender, message, createdAt, status, type, imageUrl, fileName
        FROM chat_messages
        WHERE userId = ?
        ORDER BY id ASC
      `)
      .all(userId);

    res.json({ messages: rows || [] });
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
router.post("/upload", upload.single("image"), (req, res) => {
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

    const createdAt = new Date().toISOString();
    const imageUrl = `/uploads/chat/${req.file.filename}`;

    const result = chatDB.prepare(`
      INSERT INTO chat_messages (userId, sender, message, createdAt, type, imageUrl, fileName, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      sender,
      message,
      createdAt,
      "image",
      imageUrl,
      req.file.originalname || "",
      "sent"
    );

    return res.json({
      success: true,
      messageData: {
        id: result.lastInsertRowid,
        userId,
        sender,
        message,
        createdAt,
        status: "sent",
        type: "image",
        imageUrl,
        fileName: req.file.originalname || ""
      }
    });
  } catch (err) {
    console.error("chat upload error:", err);
    res.status(500).json({ message: err.message || "Upload failed" });
  }
});

/**
 * admin-only nickname get
 */
router.get("/admin-nickname/:userId", (req, res) => {
  try {
    const userId = req.params.userId;

    const row = chatDB
      .prepare(`SELECT userId, nickname, updatedAt FROM admin_notes WHERE userId = ?`)
      .get(userId);

    res.json({ nickname: row?.nickname || "" });
  } catch (err) {
    console.error("nickname get error:", err);
    res.status(500).json({ message: "Failed to fetch nickname" });
  }
});

/**
 * admin-only nickname patch
 */
router.patch("/admin-nickname/:userId", (req, res) => {
  try {
    const userId = req.params.userId;
    const nickname = String(req.body?.nickname || "").trim().slice(0, 40);
    const updatedAt = new Date().toISOString();

    chatDB
      .prepare(`
        INSERT INTO admin_notes (userId, nickname, updatedAt)
        VALUES (?, ?, ?)
        ON CONFLICT(userId) DO UPDATE SET
          nickname = excluded.nickname,
          updatedAt = excluded.updatedAt
      `)
      .run(userId, nickname, updatedAt);

    res.json({ userId, nickname, updatedAt });
  } catch (err) {
    console.error("nickname patch error:", err);
    res.status(500).json({ message: "Failed to save nickname" });
  }
});

module.exports = router;