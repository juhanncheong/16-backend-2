const express = require("express");
const router = express.Router();

const {
  getMyActiveLuckyDraw,
  pickLuckyDrawReward,
} = require("../controllers/userLuckyDrawController");

const { protect } = require("../middleware/auth");

// ✅ get my active lucky draw
router.get("/me", protect, getMyActiveLuckyDraw);

// ✅ pick one egg
router.post("/:campaignId/pick", protect, pickLuckyDrawReward);

module.exports = router;