const express = require("express");
const Content = require("../models/Content");

const router = express.Router();

router.get("/content/:key", async (req, res) => {
  try {
    const key = String(req.params.key || "").trim().toLowerCase();

    const allowedKeys = ["terms", "privacy-security", "platform-rules"];
    if (!allowedKeys.includes(key)) {
      return res.status(404).json({ message: "Content not found" });
    }

    const content = await Content.findOne({
      key,
      isPublished: true,
    }).lean();

    if (!content) {
      return res.status(404).json({
        message: "Content not found",
      });
    }

    return res.json({
      key: content.key,
      title: content.title,
      summary: content.summary,
      version: content.version,
      updatedAt: content.updatedAt,
      sections: content.sections || [],
    });
  } catch (err) {
    console.error("GET /api/content/:key error:", err);
    return res.status(500).json({
      message: "Server error",
    });
  }
});

module.exports = router;