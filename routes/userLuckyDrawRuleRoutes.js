const express = require("express");
const router = express.Router();

const {
  getMyLuckyDraw,
  claimLuckyDraw,
} = require("../controllers/userLuckyDrawRuleController");

const { protect } = require("../middleware/auth");

// ✅ get active lucky draw for next order count
router.get("/me", protect, getMyLuckyDraw);

// ✅ claim lucky draw after user taps an egg
router.post("/:ruleId/claim", protect, claimLuckyDraw);

module.exports = router;