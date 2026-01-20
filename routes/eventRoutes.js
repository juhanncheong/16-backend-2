const express = require("express");
const { createEvent, getEvents } = require("../controllers/eventController");

const router = express.Router();

// ✅ Public route for users
router.get("/events", getEvents);

// ✅ Admin route (later we can protect with adminOnly middleware)
router.post("/admin/events", createEvent);

module.exports = router;
