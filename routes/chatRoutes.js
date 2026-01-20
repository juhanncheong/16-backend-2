const express = require("express");
const router = express.Router();
const chatDB = require("../chatDB");

// ✅ Admin: list all conversations (userId + phone + last message + lastTime)
router.get("/conversations", (req, res) => {
  try {
    const rows = chatDB
      .prepare(`
        SELECT 
          c.userId,
          u.phone AS phone,
          c.message AS lastMessage,
          c.createdAt AS lastTime
        FROM chat_messages c
        LEFT JOIN users u ON u.id = c.userId
        WHERE c.id = (
          SELECT id
          FROM chat_messages
          WHERE userId = c.userId
          ORDER BY createdAt DESC
          LIMIT 1
        )
        ORDER BY c.createdAt DESC
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
