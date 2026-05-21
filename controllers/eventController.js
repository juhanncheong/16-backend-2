const Event = require("../models/Event");
const cloudinary = require("../config/cloudinary");

// ✅ Admin: Create new event
exports.createEvent = async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const description = String(req.body.description || "").trim();

    let imageUrl = String(req.body.imageUrl || "").trim();
    let imagePublicId = String(req.body.imagePublicId || "").trim();

    if (req.file) {
      imageUrl = req.file.path; // Cloudinary URL
      imagePublicId = req.file.filename; // Cloudinary public_id
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
      imagePublicId,
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

// ✅ Admin: Update event
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
    let imagePublicId =
      String(req.body.imagePublicId || "").trim() || existing.imagePublicId;

    if (req.file) {
      if (existing.imagePublicId) {
        try {
          await cloudinary.uploader.destroy(existing.imagePublicId);
        } catch (e) {
          console.error("Cloudinary old event image delete error:", e);
        }
      }

      imageUrl = req.file.path; // Cloudinary URL
      imagePublicId = req.file.filename; // Cloudinary public_id
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
    existing.imagePublicId = imagePublicId;

    await existing.save();

    return res.json({
      success: true,
      message: "Event updated",
      event: existing,
    });
  } catch (err) {
    console.error("updateEvent error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error updating event",
    });
  }
};

// ✅ Admin: Delete event
exports.deleteEvent = async (req, res) => {
  try {
    const { id } = req.params;

    const deleted = await Event.findById(id);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: "Event not found",
      });
    }

    if (deleted.imagePublicId) {
      try {
        await cloudinary.uploader.destroy(deleted.imagePublicId);
      } catch (e) {
        console.error("Cloudinary event image delete error:", e);
      }
    }

    await Event.deleteOne({ _id: id });

    return res.json({
      success: true,
      message: "Event deleted",
    });
  } catch (err) {
    console.error("deleteEvent error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error deleting event",
    });
  }
};