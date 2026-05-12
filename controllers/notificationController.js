const Notification = require("../models/Notification");

/**
 * Admin creates a notification
 * POST /api/admin/notifications
 */
exports.createNotification = async (req, res) => {
  try {
    const { title, description, targetType, targetUser } = req.body;

    if (!title || !description) {
      return res.status(400).json({
        success: false,
        message: "Title and description are required",
      });
    }

    const notification = await Notification.create({
      title,
      description,
      targetType: targetType || "all",
      targetUser: targetType === "user" ? targetUser : null,
      createdBy: req.user?._id || null,
    });

    return res.status(201).json({
      success: true,
      message: "Notification created successfully",
      notification,
    });
  } catch (error) {
    console.error("Create notification error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while creating notification",
    });
  }
};

/**
 * Admin gets all notifications
 * GET /api/admin/notifications
 */
exports.getAdminNotifications = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 10, 1), 100);
    const skip = (page - 1) * limit;

    const [notifications, total] = await Promise.all([
      Notification.find()
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("createdBy", "username email")
        .populate("targetUser", "username email"),
      Notification.countDocuments(),
    ]);

    return res.json({
      success: true,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      notifications,
    });
  } catch (error) {
    console.error("Get admin notifications error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while getting notifications",
    });
  }
};

/**
 * Admin disables/deletes notification softly
 * PATCH /api/admin/notifications/:id/disable
 */
exports.disableNotification = async (req, res) => {
  try {
    const notification = await Notification.findByIdAndUpdate(
      req.params.id,
      { isActive: false },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: "Notification not found",
      });
    }

    return res.json({
      success: true,
      message: "Notification disabled successfully",
      notification,
    });
  } catch (error) {
    console.error("Disable notification error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while disabling notification",
    });
  }
};

/**
 * User gets their notifications
 * GET /api/notifications
 */
exports.getUserNotifications = async (req, res) => {
  try {
    const userId = req.user?._id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const notifications = await Notification.find({
      isActive: true,
      $or: [
        { targetType: "all" },
        { targetType: "user", targetUser: userId },
      ],
    }).sort({ createdAt: -1 });

    const formatted = notifications.map((notification) => {
      const isRead = notification.readBy.some(
        (item) => item.user.toString() === userId.toString()
      );

      return {
        _id: notification._id,
        title: notification.title,
        description: notification.description,
        targetType: notification.targetType,
        createdAt: notification.createdAt,
        updatedAt: notification.updatedAt,
        isRead,
      };
    });

    return res.json({
      success: true,
      notifications: formatted,
    });
  } catch (error) {
    console.error("Get user notifications error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while getting user notifications",
    });
  }
};

/**
 * User marks notification as read
 * PATCH /api/notifications/:id/read
 */
exports.markNotificationAsRead = async (req, res) => {
  try {
    const userId = req.user?._id;
    const notificationId = req.params.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized",
      });
    }

    const notification = await Notification.findById(notificationId);

    if (!notification || !notification.isActive) {
      return res.status(404).json({
        success: false,
        message: "Notification not found",
      });
    }

    const alreadyRead = notification.readBy.some(
      (item) => item.user.toString() === userId.toString()
    );

    if (!alreadyRead) {
      notification.readBy.push({
        user: userId,
        readAt: new Date(),
      });

      await notification.save();
    }

    return res.json({
      success: true,
      message: "Notification marked as read",
    });
  } catch (error) {
    console.error("Mark notification as read error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error while marking notification as read",
    });
  }
};