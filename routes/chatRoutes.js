const express = require("express");
const router = express.Router();
const chatDB = require("./chatDB");

/**
 * ✅ One-time: create admin_notes table (nickname per user, admin-only)
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
 * ✅ Helper: safe JSON response for conversations
 * Fixes: 500 crash if table missing / query fails
 */
function safeGetConversations() {
  try {
    // ✅ includes lastMessage preview + lastTime
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
 * ✅ Admin: list all conversations (unique userId sorted by last message)
 * Returns: userId, lastTime, lastMessage
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
 * ✅ Admin: get messages for a user
 */
router.get("/messages/:userId", (req, res) => {
  try {
    const userId = req.params.userId;

    const rows = chatDB
      .prepare(`
        SELECT id, sender, message, createdAt, status
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
 * ✅ Admin-only Nickname:
 * GET nickname for one user
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
 * ✅ Admin-only Nickname:
 * PATCH nickname for one user
 * body: { nickname: "John Buyer" }
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
