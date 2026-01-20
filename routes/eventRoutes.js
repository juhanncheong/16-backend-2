const express = require("express");
const {
  createEvent,
  getEvents,
  updateEvent,
  deleteEvent,
} = require("../controllers/eventController");

const router = express.Router();

router.get("/events", getEvents);

router.post("/admin/events", createEvent);
router.patch("/admin/events/:id", updateEvent);
router.delete("/admin/events/:id", deleteEvent);

module.exports = router;
