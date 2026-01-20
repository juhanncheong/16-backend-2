const express = require("express");
const router = express.Router();
const chatDB = require("../chatDB");

// ✅ Admin: list all conversations (unique userId sorted by last message)
router.get("/conversations", (req, res) => {
  try {
    const rows = chatDB
      .prepare(`
        SELECT userId, MAX(createdAt) AS lastTime
        FROM chat_messages
        GROUP BY userId
        ORDER BY lastTime DESC
      `)
      .all();

    res.json({ conversations: rows });
  } catch (err) {
    console.error("chat conversations error:", err);
    res.status(500).json({ message: "Failed to fetch conversations" });
  }
});

// ✅ Admin: get messages for a user
router.get("/messages/:userId", (req, res) => {
  try {
    const userId = req.params.userId;

    const rows = chatDB
      .prepare(`
        SELECT sender, message, createdAt
        FROM chat_messages
        WHERE userId = ?
        ORDER BY id ASC
      `)
      .all(userId);

    res.json({ messages: rows });
  } catch (err) {
    console.error("chat messages error:", err);
    res.status(500).json({ message: "Failed to fetch messages" });
  }
});

module.exports = router;
