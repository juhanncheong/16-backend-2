const webpush = require("web-push");
const PushSubscription = require("../models/PushSubscription");

const publicKey = process.env.VAPID_PUBLIC_KEY;
const privateKey = process.env.VAPID_PRIVATE_KEY;
const subject = process.env.VAPID_SUBJECT || "mailto:support@example.com";

if (publicKey && privateKey) {
  webpush.setVapidDetails(subject, publicKey, privateKey);
} else {
  console.warn("⚠️ Web Push VAPID keys are missing. Push notifications disabled.");
}

async function sendPushToUser(userId, payload) {
  try {
    if (!publicKey || !privateKey) {
      console.warn("Push skipped: missing VAPID keys");
      return;
    }

    if (!userId) return;

    const subscriptions = await PushSubscription.find({
      userId: String(userId),
      active: true,
    }).lean();

    if (!subscriptions.length) {
      console.log("No push subscriptions for user:", userId);
      return;
    }

    const body = JSON.stringify(payload || {});

    await Promise.all(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: sub.keys,
            },
            body
          );

          await PushSubscription.updateOne(
            { endpoint: sub.endpoint },
            {
              $set: {
                lastUsedAt: new Date(),
                active: true,
              },
            }
          );
        } catch (err) {
          const statusCode = err.statusCode || err.status;

          console.error("Push send failed:", {
            userId,
            endpoint: sub.endpoint,
            statusCode,
            message: err.message,
          });

          if (statusCode === 404 || statusCode === 410) {
            await PushSubscription.updateOne(
              { endpoint: sub.endpoint },
              { $set: { active: false } }
            );
          }
        }
      })
    );
  } catch (err) {
    console.error("sendPushToUser error:", err);
  }
}

module.exports = {
  sendPushToUser,
};