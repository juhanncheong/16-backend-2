import Event from "../models/Event.js";

// ✅ Admin: Create new event
export const createEvent = async (req, res) => {
  try {
    const { name, description, imageUrl } = req.body;

    if (!name || !description || !imageUrl) {
      return res.status(400).json({
        success: false,
        message: "name, description, and imageUrl are required",
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
export const getEvents = async (req, res) => {
  try {
    const events = await Event.find().sort({ createdAt: -1 }); // newest first

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
