const express = require("express");
const router = express.Router();
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../config/cloudinary");

const ChatMessage = require("../models/ChatMessage");
const AdminNote = require("../models/AdminNote");
const User = require("../models/User");
const AdminChatHotkey = require("../models/AdminChatHotkey");

const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "chat",
    allowed_formats: ["jpg", "jpeg", "png", "webp"],
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    if (!file.mimetype || !file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files are allowed"));
    }
    cb(null, true);
  },
});

/**
 * admin: list conversations
 * includes unreadCount for admin
 */
router.get("/conversations", async (req, res) => {
  try {
    const rows = await ChatMessage.aggregate([
      { $sort: { createdAt: -1, _id: -1 } },
      {
        $group: {
          _id: "$userId",
          uid: { $first: "$uid" },
          phoneNumber: { $first: "$phoneNumber" },
          lastMessage: { $first: "$message" },
          lastTime: { $first: "$createdAt" },
          lastType: { $first: "$type" },
          imageUrl: { $first: "$imageUrl" },
          fileName: { $first: "$fileName" },
          sender: { $first: "$sender" },
          status: { $first: "$status" },

          unreadCount: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$sender", "user"] },
                    { $ne: ["$adminRead", true] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
      { $sort: { lastTime: -1 } },
    ]);

    const conversations = rows.map((row) => ({
      userId: row._id,
      uid: row.uid || "",
      phoneNumber: row.phoneNumber || "",
      lastMessage:
        row.lastType === "image"
          ? row.lastMessage || "Image"
          : row.lastMessage || "",
      lastTime: row.lastTime,
      type: row.lastType || "text",
      imageUrl: row.imageUrl || "",
      fileName: row.fileName || "",
      sender: row.sender || "",
      status: row.status || "sent",
      unreadCount: Number(row.unreadCount || 0),
    }));

    res.json({ conversations });
  } catch (err) {
    console.error("chat conversations error:", err);
    res.status(500).json({ message: "Failed to fetch conversations" });
  }
});

/**
 * get messages for a user
 * also marks all user -> admin unread messages as read
 */
router.get("/messages/:userId", async (req, res) => {
  try {
    const userId = String(req.params.userId || "").trim();

    await ChatMessage.updateMany(
      {
        userId,
        sender: "user",
        adminRead: { $ne: true },
      },
      {
        $set: { adminRead: true },
      }
    );

    const rows = await ChatMessage.find({ userId })
      .sort({ createdAt: 1, _id: 1 })
      .lean();

    const messages = rows.map((row) => ({
      id: String(row._id),
      userId: row.userId,
      uid: row.uid || "",
      phoneNumber: row.phoneNumber || "",
      sender: row.sender,
      message: row.message || "",
      createdAt: row.createdAt,
      status: row.status || "sent",
      type: row.type || "text",
      imageUrl: row.imageUrl || "",
      fileName: row.fileName || "",
      adminRead: row.adminRead === true,
      userRead: row.userRead === true,
    
      // admin-side edit info
      edited: row.edited === true,
      editedAt: row.editedAt || null,
      editedBy: row.editedBy || "",
      editHistory: Array.isArray(row.editHistory) ? row.editHistory : [],
    }));

    res.json({ messages });
  } catch (err) {
    console.error("chat messages error:", err);
    res.status(500).json({ message: "Failed to fetch messages" });
  }
});

/**
 * admin: edit an admin-sent text message
 * keeps previous versions in editHistory
 */
router.patch("/messages/:messageId/edit", async (req, res) => {
  try {
    const messageId = String(req.params.messageId || "").trim();
    const newMessage = String(req.body?.message || "").trim();

    if (!messageId) {
      return res.status(400).json({ message: "messageId is required" });
    }

    if (!newMessage) {
      return res.status(400).json({ message: "Message cannot be empty" });
    }

    if (newMessage.length > 2000) {
      return res.status(400).json({ message: "Message is too long" });
    }

    const row = await ChatMessage.findById(messageId);

    if (!row) {
      return res.status(404).json({ message: "Message not found" });
    }

    if (row.sender !== "admin") {
      return res.status(403).json({
        message: "Only admin-sent messages can be edited",
      });
    }

    if (row.type !== "text") {
      return res.status(400).json({
        message: "Only text messages can be edited",
      });
    }

    const oldMessage = String(row.message || "");

    if (oldMessage === newMessage) {
      return res.json({
        ok: true,
        message: "No changes made",
        messageData: {
          id: String(row._id),
          userId: row.userId,
          uid: row.uid || "",
          phoneNumber: row.phoneNumber || "",
          sender: row.sender,
          message: row.message || "",
          createdAt: row.createdAt,
          status: row.status || "sent",
          type: row.type || "text",
          imageUrl: row.imageUrl || "",
          fileName: row.fileName || "",
          adminRead: row.adminRead === true,
          userRead: row.userRead === true,
          edited: row.edited === true,
          editedAt: row.editedAt || null,
          editedBy: row.editedBy || "",
          editHistory: Array.isArray(row.editHistory) ? row.editHistory : [],
        },
      });
    }

    const editedAt = new Date();

    row.editHistory.push({
      oldMessage,
      newMessage,
      editedAt,
      editedBy: String(req.user?.userId || req.user?._id || "admin"),
    });

    row.message = newMessage;
    row.edited = true;
    row.editedAt = editedAt;
    row.editedBy = String(req.user?.userId || req.user?._id || "admin");

    await row.save();

    return res.json({
      ok: true,
      message: "Message edited successfully",
      messageData: {
        id: String(row._id),
        userId: row.userId,
        uid: row.uid || "",
        phoneNumber: row.phoneNumber || "",
        sender: row.sender,
        message: row.message || "",
        createdAt: row.createdAt,
        status: row.status || "sent",
        type: row.type || "text",
        imageUrl: row.imageUrl || "",
        fileName: row.fileName || "",
        adminRead: row.adminRead === true,
        userRead: row.userRead === true,
        edited: row.edited === true,
        editedAt: row.editedAt || null,
        editedBy: row.editedBy || "",
        editHistory: Array.isArray(row.editHistory) ? row.editHistory : [],
      },
    });
  } catch (err) {
    console.error("chat message edit error:", err);
    res.status(500).json({ message: "Failed to edit message" });
  }
});

/**
 * manually mark one conversation as read for admin
 */
router.patch("/conversations/:userId/read-admin", async (req, res) => {
  try {
    const userId = String(req.params.userId || "").trim();

    if (!userId) {
      return res.status(400).json({ message: "userId is required" });
    }

    const result = await ChatMessage.updateMany(
      {
        userId,
        sender: "user",
        adminRead: { $ne: true },
      },
      {
        $set: { adminRead: true },
      }
    );

    return res.json({
      ok: true,
      userId,
      updatedCount: Number(result.modifiedCount || 0),
    });
  } catch (err) {
    console.error("read-admin error:", err);
    res.status(500).json({ message: "Failed to mark conversation as read" });
  }
});

/**
 * upload image message
 * form-data:
 * - image
 * - userId
 * - sender (optional, default user)
 * - message (optional caption)
 */
router.post("/upload", upload.single("image"), async (req, res) => {
  try {
    const userId = String(req.body.userId || "").trim();
    const sender = String(req.body.sender || "user").trim();
    const message = String(req.body.message || "").trim();

    if (!userId) {
      return res.status(400).json({ message: "userId is required" });
    }

    if (!req.file) {
      return res.status(400).json({ message: "Image file is required" });
    }

    const createdAt = new Date();
    const imageUrl = req.file.path;
    const imagePublicId = req.file.filename;

    const user = await User.findById(userId)
     .select("uid phoneNumber")
     .lean();

    const saved = await ChatMessage.create({
      userId,
      uid: user?.uid || "",
      phoneNumber: user?.phoneNumber || "",
      sender,
      message,
      createdAt,
      status: "sent",
      type: "image",
      imagePublicId,
      imageUrl,
      fileName: req.file.originalname || "",
      adminRead: sender === "admin",
      userRead: sender === "admin" ? false : true,
    });

    return res.json({
      success: true,
      messageData: {
        id: String(saved._id),
        userId: saved.userId,
        uid: saved.uid || "",
        phoneNumber: saved.phoneNumber || "",
        sender: saved.sender,
        message: saved.message || "",
        createdAt: saved.createdAt,
        status: saved.status || "sent",
        type: saved.type || "image",
        imageUrl: saved.imageUrl || "",
        fileName: saved.fileName || "",
        adminRead: saved.adminRead === true,
        userRead: saved.userRead === true,
      },
    });
  } catch (err) {
    console.error("chat upload error:", err);
    res.status(500).json({ message: err.message || "Upload failed" });
  }
});

/**
 * admin-only nickname get
 */
router.get("/admin-nickname/:userId", async (req, res) => {
  try {
    const userId = String(req.params.userId || "").trim();

    const row = await AdminNote.findOne({ userId }).lean();

    res.json({ nickname: row?.nickname || "" });
  } catch (err) {
    console.error("nickname get error:", err);
    res.status(500).json({ message: "Failed to fetch nickname" });
  }
});

/**
 * admin-only nickname patch
 */
router.patch("/admin-nickname/:userId", async (req, res) => {
  try {
    const userId = String(req.params.userId || "").trim();
    const nickname = String(req.body?.nickname || "")
      .trim()
      .slice(0, 40);
    const updatedAt = new Date();

    await AdminNote.findOneAndUpdate(
      { userId },
      { userId, nickname, updatedAt },
      { upsert: true, new: true }
    );

    res.json({ userId, nickname, updatedAt });
  } catch (err) {
    console.error("nickname patch error:", err);
    res.status(500).json({ message: "Failed to save nickname" });
  }
});

/**
 * admin: delete admin-sent image only
 * This will NOT delete text messages.
 */
router.delete("/messages/:messageId/image", async (req, res) => {
  try {
    const messageId = String(req.params.messageId || "").trim();

    if (!messageId) {
      return res.status(400).json({ message: "messageId is required" });
    }

    const row = await ChatMessage.findById(messageId);

    if (!row) {
      return res.status(404).json({ message: "Image message not found" });
    }

    // only images can be deleted
    if (row.type !== "image") {
      return res.status(400).json({
        message: "Only image messages can be deleted",
      });
    }

    // only admin-sent images can be deleted
    if (row.sender !== "admin") {
      return res.status(403).json({
        message: "Only admin-sent images can be deleted",
      });
    }

    const userId = String(row.userId || "");

    // delete image from Cloudinary
    if (row.imagePublicId) {
      try {
        await cloudinary.uploader.destroy(row.imagePublicId);
      } catch (e) {
        console.error("Cloudinary delete error:", e);
      }
    }

    await ChatMessage.deleteOne({ _id: row._id });

    const io = req.app.get("io");

    if (io) {
      io.to("admins").emit("chat:imageDeleted", {
        messageId,
        userId,
      });

      io.to(`user:${userId}`).emit("chat:imageDeleted", {
        messageId,
        userId,
      });
    }

    return res.json({
      ok: true,
      message: "Image deleted successfully",
      messageId,
      userId,
    });
  } catch (err) {
    console.error("delete image error:", err);
    res.status(500).json({ message: "Failed to delete image" });
  }
});

// ✅ Admin: get all chat hotkeys
router.get("/admin-hotkeys", async (req, res) => {
  try {
    const adminId = "global";

    const hotkeys = await AdminChatHotkey.find({ adminId })
      .sort({ sortOrder: 1, createdAt: 1 })
      .lean();

    return res.json({
      ok: true,
      hotkeys: hotkeys.map((h) => ({
        id: String(h._id),
        label: h.label || "",
        text: h.text || "",
        enabled: h.enabled !== false,
        sortOrder: Number(h.sortOrder || 0),
        createdAt: h.createdAt,
        updatedAt: h.updatedAt,
      })),
    });
  } catch (err) {
    console.error("get admin hotkeys error:", err);
    return res.status(500).json({
      ok: false,
      message: "Failed to fetch hotkeys",
    });
  }
});

// ✅ Admin: add new chat hotkey
router.post("/admin-hotkeys", async (req, res) => {
  try {
    const adminId = "global";

    const label = String(req.body?.label || "").trim();
    const text = String(req.body?.text || "").trim();
    const enabled = req.body?.enabled !== false;

    if (!label) {
      return res.status(400).json({
        ok: false,
        message: "Label is required",
      });
    }

    if (!text) {
      return res.status(400).json({
        ok: false,
        message: "Text is required",
      });
    }

    if (label.length > 40) {
      return res.status(400).json({
        ok: false,
        message: "Label is too long",
      });
    }

    if (text.length > 2000) {
      return res.status(400).json({
        ok: false,
        message: "Text is too long",
      });
    }

    const count = await AdminChatHotkey.countDocuments({ adminId });

    const hotkey = await AdminChatHotkey.create({
      adminId,
      label,
      text,
      enabled,
      sortOrder: count + 1,
    });

    return res.status(201).json({
      ok: true,
      message: "Hotkey added",
      hotkey: {
        id: String(hotkey._id),
        label: hotkey.label,
        text: hotkey.text,
        enabled: hotkey.enabled,
        sortOrder: hotkey.sortOrder,
        createdAt: hotkey.createdAt,
        updatedAt: hotkey.updatedAt,
      },
    });
  } catch (err) {
    console.error("add admin hotkey error:", err);
    return res.status(500).json({
      ok: false,
      message: "Failed to add hotkey",
    });
  }
});

// ✅ Admin: update one hotkey
router.patch("/admin-hotkeys/:id", async (req, res) => {
  try {
    const adminId = "global";
    const id = String(req.params.id || "").trim();

    const update = {};

    if (typeof req.body?.label !== "undefined") {
      const label = String(req.body.label || "").trim();

      if (!label) {
        return res.status(400).json({
          ok: false,
          message: "Label is required",
        });
      }

      if (label.length > 40) {
        return res.status(400).json({
          ok: false,
          message: "Label is too long",
        });
      }

      update.label = label;
    }

    if (typeof req.body?.text !== "undefined") {
      const text = String(req.body.text || "").trim();

      if (!text) {
        return res.status(400).json({
          ok: false,
          message: "Text is required",
        });
      }

      if (text.length > 2000) {
        return res.status(400).json({
          ok: false,
          message: "Text is too long",
        });
      }

      update.text = text;
    }

    if (typeof req.body?.enabled !== "undefined") {
      update.enabled = Boolean(req.body.enabled);
    }

    if (typeof req.body?.sortOrder !== "undefined") {
      update.sortOrder = Number(req.body.sortOrder || 0);
    }

    const hotkey = await AdminChatHotkey.findOneAndUpdate(
      { _id: id, adminId },
      update,
      { new: true, runValidators: true }
    ).lean();

    if (!hotkey) {
      return res.status(404).json({
        ok: false,
        message: "Hotkey not found",
      });
    }

    return res.json({
      ok: true,
      message: "Hotkey updated",
      hotkey: {
        id: String(hotkey._id),
        label: hotkey.label,
        text: hotkey.text,
        enabled: hotkey.enabled !== false,
        sortOrder: Number(hotkey.sortOrder || 0),
        createdAt: hotkey.createdAt,
        updatedAt: hotkey.updatedAt,
      },
    });
  } catch (err) {
    console.error("update admin hotkey error:", err);
    return res.status(500).json({
      ok: false,
      message: "Failed to update hotkey",
    });
  }
});

// ✅ Admin: delete one hotkey
router.delete("/admin-hotkeys/:id", async (req, res) => {
  try {
    const adminId = "global";
    const id = String(req.params.id || "").trim();

    const deleted = await AdminChatHotkey.findOneAndDelete({
      _id: id,
      adminId,
    }).lean();

    if (!deleted) {
      return res.status(404).json({
        ok: false,
        message: "Hotkey not found",
      });
    }

    return res.json({
      ok: true,
      message: "Hotkey deleted",
      id,
    });
  } catch (err) {
    console.error("delete admin hotkey error:", err);
    return res.status(500).json({
      ok: false,
      message: "Failed to delete hotkey",
    });
  }
});

module.exports = router;