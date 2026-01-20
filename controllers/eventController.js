const Event = require("../models/Event");

// ✅ Admin: Create new event
exports.createEvent = async (req, res) => {
  try {
    const { name, description, imageUrl } = req.body;

    if (!name || !description || !imageUrl) {
      return res.status(400).json({
        success: false,
        message: "name, description, and imageUrl are required",
      });
    }

    const newEvent = await Event.create({ name, description, imageUrl });

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
    const { name, description, imageUrl } = req.body;

    if (!name || !description || !imageUrl) {
      return res.status(400).json({
        success: false,
        message: "name, description, and imageUrl are required",
      });
    }

    const updated = await Event.findByIdAndUpdate(
      id,
      { name, description, imageUrl },
      { new: true }
    );

    if (!updated) {
      return res.status(404).json({
        success: false,
        message: "Event not found",
      });
    }

    res.json({
      success: true,
      message: "Event updated",
      event: updated,
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
