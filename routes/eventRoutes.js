const express = require("express");
const {
  createEvent,
  getEvents,
  updateEvent,
  deleteEvent,
} = require("../controllers/eventController");
const uploadEventImage = require("../middleware/uploadEventImage");

const router = express.Router();

router.get("/events", getEvents);

router.post("/admin/events", uploadEventImage.single("image"), createEvent);
router.patch("/admin/events/:id", uploadEventImage.single("image"), updateEvent);
router.delete("/admin/events/:id", deleteEvent);

module.exports = router;