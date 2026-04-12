const express = require("express");
const router = express.Router();

const {
  createLuckyDrawRule,
  listUserLuckyDrawRules,
  disableLuckyDrawRule,
  deleteLuckyDrawRule,
} = require("../controllers/adminLuckyDrawRuleController");

const { protect, adminOnly } = require("../middleware/auth");

// ✅ create/update rule
router.post("/", protect, adminOnly, createLuckyDrawRule);

// ✅ list rules for one UID
router.get("/user/:userId", protect, adminOnly, listUserLuckyDrawRules);

// ✅ disable one rule
router.patch("/:id/disable", protect, adminOnly, disableLuckyDrawRule);

// ✅ delete one rule
router.delete("/:id", protect, adminOnly, deleteLuckyDrawRule);

module.exports = router;