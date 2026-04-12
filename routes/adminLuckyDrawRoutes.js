const express = require("express");
const router = express.Router();

const {
  createLuckyDrawCampaign,
  listUserLuckyDrawCampaigns,
  getLuckyDrawCampaignById,
  disableLuckyDrawCampaign,
  deleteLuckyDrawCampaign,
} = require("../controllers/adminLuckyDrawController");

const { protect, adminOnly } = require("../middleware/auth");

router.post("/", protect, adminOnly, createLuckyDrawCampaign);
router.get("/user/:userId", protect, adminOnly, listUserLuckyDrawCampaigns);
router.get("/:id", protect, adminOnly, getLuckyDrawCampaignById);
router.patch("/:id/disable", protect, adminOnly, disableLuckyDrawCampaign);
router.delete("/:id", protect, adminOnly, deleteLuckyDrawCampaign);

module.exports = router;