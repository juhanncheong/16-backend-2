const AdminNotification = require("../models/AdminNotification");
const User = require("../models/User");

exports.getAdminNotifications = async (req, res) => {
  try {
    const me = await User.findById(req.user.userId).lean();

    if (!me || me.role !== "admin") {
      return res.status(403).json({
        ok: false,
        message: "Admin access only",
      });
    }

    const notifications = await AdminNotification.find({})
      .populate("user", "phoneNumber uid")
      .populate("relatedUser", "phoneNumber uid")
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    return res.json({
      ok: true,
      notifications,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: "Failed to fetch notifications",
    });
  }
};

exports.markAdminNotificationRead = async (req, res) => {
  try {
    const me = await User.findById(req.user.userId).lean();

    if (!me || me.role !== "admin") {
      return res.status(403).json({
        ok: false,
        message: "Admin access only",
      });
    }

    const notification = await AdminNotification.findByIdAndUpdate(
      req.params.id,
      { $set: { isRead: true } },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({
        ok: false,
        message: "Notification not found",
      });
    }

    return res.json({
      ok: true,
      notification,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: "Failed to mark notification as read",
    });
  }
};

exports.markAllAdminNotificationsRead = async (req, res) => {
  try {
    const me = await User.findById(req.user.userId).lean();

    if (!me || me.role !== "admin") {
      return res.status(403).json({
        ok: false,
        message: "Admin access only",
      });
    }

    await AdminNotification.updateMany(
      { isRead: false },
      { $set: { isRead: true } }
    );

    return res.json({
      ok: true,
      message: "All notifications marked as read",
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: "Failed to mark all notifications as read",
    });
  }
};