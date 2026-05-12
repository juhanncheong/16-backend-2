const express = require("express");
const router = express.Router();

const {
  createNotification,
  getAdminNotifications,
  disableNotification,
  getUserNotifications,
  markNotificationAsRead,
} = require("../controllers/notificationController");

const { protect, adminOnly } = require("../middleware/auth");

// Admin creates user-facing notification
router.post(
  "/admin/user-notifications",
  protect,
  adminOnly,
  createNotification
);

// Admin gets user-facing notifications
router.get(
  "/admin/user-notifications",
  protect,
  adminOnly,
  getAdminNotifications
);

// Admin disables user-facing notification
router.patch(
  "/admin/user-notifications/:id/disable",
  protect,
  adminOnly,
  disableNotification
);

// User gets their frontend notifications
router.get(
  "/user-notifications",
  protect,
  getUserNotifications
);

// User marks frontend notification as read
router.patch(
  "/user-notifications/:id/read",
  protect,
  markNotificationAsRead
);

module.exports = router;