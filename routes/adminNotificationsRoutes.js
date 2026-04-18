const express = require("express");
const router = express.Router();

const { protect } = require("../middleware/auth");
const { getAdminNotifications } = require("../controllers/adminNotificationsController");

router.get("/", protect, getAdminNotifications);

module.exports = router;