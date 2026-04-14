const Event = require("../models/Event");

function buildImageUrl(req, file) {
  if (!file) return "";
  return `${req.protocol}://${req.get("host")}/uploads/events/${file.filename}`;
}

// ✅ Admin: Create new event
exports.createEvent = async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const description = String(req.body.description || "").trim();

    // allow either uploaded file or manual imageUrl
    let imageUrl = String(req.body.imageUrl || "").trim();

    if (req.file) {
      imageUrl = buildImageUrl(req, req.file);
    }

    if (!name || !description || !imageUrl) {
      return res.status(400).json({
        success: false,
        message: "name, description, and event image are required",
      });
    }

    const newEvent = await Event.create({
      name,
      description,
      imageUrl,
    });

    return res.status(201).json({
      success: true,
      message: "Event created successfully",
      event: newEvent,
    });
  } catch (err) {
    console.error("createEvent error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error creating event",
    });
  }
};

// ✅ Users: Get all events
exports.getEvents = async (req, res) => {
  try {
    const events = await Event.find().sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      total: events.length,
      events,
    });
  } catch (err) {
    console.error("getEvents error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error fetching events",
    });
  }
};

exports.updateEvent = async (req, res) => {
  try {
    const { id } = req.params;
    const name = String(req.body.name || "").trim();
    const description = String(req.body.description || "").trim();

    const existing = await Event.findById(id);

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Event not found",
      });
    }

    let imageUrl = String(req.body.imageUrl || "").trim() || existing.imageUrl;

    if (req.file) {
      imageUrl = buildImageUrl(req, req.file);
    }

    if (!name || !description || !imageUrl) {
      return res.status(400).json({
        success: false,
        message: "name, description, and event image are required",
      });
    }

    existing.name = name;
    existing.description = description;
    existing.imageUrl = imageUrl;

    await existing.save();

    res.json({
      success: true,
      message: "Event updated",
      event: existing,
    });
  } catch (err) {
    console.error("updateEvent error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

exports.deleteEvent = async (req, res) => {
  try {
    const { id } = req.params;

    const deleted = await Event.findByIdAndDelete(id);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: "Event not found",
      });
    }

    res.json({
      success: true,
      message: "Event deleted",
    });
  } catch (err) {
    console.error("deleteEvent error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
};