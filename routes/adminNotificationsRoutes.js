const express = require("express");
const router = express.Router();

const { protect } = require("../middleware/auth");
const {
  getAdminNotifications,
  markAdminNotificationRead,
  markAllAdminNotificationsRead,
} = require("../controllers/adminNotificationsController");

router.get("/", protect, getAdminNotifications);
router.patch("/:id/read", protect, markAdminNotificationRead);
router.patch("/read-all", protect, markAllAdminNotificationsRead);

module.exports = router;