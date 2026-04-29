const express = require("express");
const router = express.Router();

const PushSubscription = require("../models/PushSubscription");
const { sendPushToUser } = require("../utils/pushService");

router.get("/vapid-public-key", (req, res) => {
  const publicKey = process.env.VAPID_PUBLIC_KEY || "";

  if (!publicKey) {
    return res.status(500).json({
      ok: false,
      message: "VAPID public key missing",
    });
  }

  res.json({
    ok: true,
    publicKey,
  });
});

router.post("/subscribe", async (req, res) => {
  try {
    const userId = String(req.body.userId || "").trim();
    const subscription = req.body.subscription;

    if (!userId) {
      return res.status(400).json({
        ok: false,
        message: "userId is required",
      });
    }

    if (!subscription || !subscription.endpoint || !subscription.keys) {
      return res.status(400).json({
        ok: false,
        message: "Invalid push subscription",
      });
    }

    const saved = await PushSubscription.findOneAndUpdate(
      { endpoint: subscription.endpoint },
      {
        userId,
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.keys.p256dh,
          auth: subscription.keys.auth,
        },
        userAgent: req.headers["user-agent"] || "",
        active: true,
      },
      {
        upsert: true,
        new: true,
      }
    );

    res.json({
      ok: true,
      id: String(saved._id),
    });
  } catch (err) {
    console.error("push subscribe error:", err);
    res.status(500).json({
      ok: false,
      message: "Failed to save push subscription",
    });
  }
});

router.post("/unsubscribe", async (req, res) => {
  try {
    const endpoint = String(req.body.endpoint || "").trim();

    if (!endpoint) {
      return res.status(400).json({
        ok: false,
        message: "endpoint is required",
      });
    }

    await PushSubscription.updateOne(
      { endpoint },
      { $set: { active: false } }
    );

    res.json({ ok: true });
  } catch (err) {
    console.error("push unsubscribe error:", err);
    res.status(500).json({
      ok: false,
      message: "Failed to unsubscribe",
    });
  }
});

router.post("/test", async (req, res) => {
  try {
    const userId = String(req.body.userId || "").trim();

    if (!userId) {
      return res.status(400).json({
        ok: false,
        message: "userId is required",
      });
    }

    await sendPushToUser(userId, {
      title: "Test notification",
      body: "This is a test push notification.",
      url: "/chat.html",
      type: "test",
      userId,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error("push test error:", err);
    res.status(500).json({
      ok: false,
      message: "Failed to send test push",
    });
  }
});

module.exports = router;