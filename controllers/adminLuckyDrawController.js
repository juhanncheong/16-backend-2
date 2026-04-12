const LuckyDrawCampaign = require("../models/LuckyDrawCampaign");
const User = require("../models/User");
const OrderPool = require("../models/OrderPool");

// ✅ admin creates lucky draw campaign for one user
async function createLuckyDrawCampaign(req, res) {
  try {
    const { uid, title, description, rewards, note } = req.body;

    if (!uid || !Array.isArray(rewards) || rewards.length !== 3) {
      return res.status(400).json({
        ok: false,
        message: "uid and exactly 3 rewards are required",
      });
    }

    const cleanUid = String(uid).trim();

    const user = await User.findOne({ uid: cleanUid }).select("_id uid");
    if (!user) {
      return res.status(404).json({ ok: false, message: "User not found" });
    }

    // ✅ validate all bonus_order poolOrder ids before create
    for (const reward of rewards) {
      if (reward.rewardType === "bonus_order") {
        if (!reward.poolOrder) {
          return res.status(400).json({
            ok: false,
            message: "bonus_order reward must include poolOrder",
          });
        }

        const exists = await OrderPool.findById(reward.poolOrder).select("_id isActive");
        if (!exists) {
          return res.status(404).json({
            ok: false,
            message: `Pool order not found for slot ${reward.slotIndex}`,
          });
        }
      }
    }

    const created = await LuckyDrawCampaign.create({
      user: user._id,
      title: title || "Lucky Draw",
      description: description || "",
      rewards,
      note: note || "",
      createdByAdmin: req.user?._id || null,
      isActive: true,
      status: "ACTIVE",
    });

    return res.json({
      ok: true,
      message: "Lucky draw campaign created",
      campaign: created,
    });
  } catch (err) {
    console.error("createLuckyDrawCampaign error:", err);
    return res.status(500).json({
      ok: false,
      message: err.message || "Server error",
    });
  }
}

// ✅ admin lists all lucky draw campaigns for one user by uid
async function listUserLuckyDrawCampaigns(req, res) {
  try {
    const { userId } = req.params;

    const user = await User.findOne({ uid: String(userId).trim() }).select("_id uid");
    if (!user) {
      return res.status(404).json({ ok: false, message: "User not found" });
    }

    const campaigns = await LuckyDrawCampaign.find({ user: user._id })
      .populate("chosenPoolOrder")
      .populate("rewards.poolOrder")
      .sort({ createdAt: -1 })
      .lean();

    return res.json({
      ok: true,
      campaigns,
    });
  } catch (err) {
    console.error("listUserLuckyDrawCampaigns error:", err);
    return res.status(500).json({
      ok: false,
      message: "Server error",
    });
  }
}

// ✅ admin gets one lucky draw campaign by id
async function getLuckyDrawCampaignById(req, res) {
  try {
    const { id } = req.params;

    const campaign = await LuckyDrawCampaign.findById(id)
      .populate("user", "_id uid phoneNumber")
      .populate("chosenPoolOrder")
      .populate("rewards.poolOrder")
      .lean();

    if (!campaign) {
      return res.status(404).json({
        ok: false,
        message: "Lucky draw campaign not found",
      });
    }

    return res.json({
      ok: true,
      campaign,
    });
  } catch (err) {
    console.error("getLuckyDrawCampaignById error:", err);
    return res.status(500).json({
      ok: false,
      message: "Server error",
    });
  }
}

// ✅ admin disables campaign
async function disableLuckyDrawCampaign(req, res) {
  try {
    const { id } = req.params;

    const campaign = await LuckyDrawCampaign.findById(id);
    if (!campaign) {
      return res.status(404).json({
        ok: false,
        message: "Lucky draw campaign not found",
      });
    }

    if (campaign.status === "CLAIMED") {
      return res.status(400).json({
        ok: false,
        message: "Claimed campaign cannot be disabled",
      });
    }

    campaign.isActive = false;
    campaign.status = "DISABLED";
    await campaign.save();

    return res.json({
      ok: true,
      message: "Lucky draw campaign disabled",
      campaign,
    });
  } catch (err) {
    console.error("disableLuckyDrawCampaign error:", err);
    return res.status(500).json({
      ok: false,
      message: "Server error",
    });
  }
}

// ✅ admin deletes campaign
async function deleteLuckyDrawCampaign(req, res) {
  try {
    const { id } = req.params;

    const deleted = await LuckyDrawCampaign.findByIdAndDelete(id);
    if (!deleted) {
      return res.status(404).json({
        ok: false,
        message: "Lucky draw campaign not found",
      });
    }

    return res.json({
      ok: true,
      message: "Lucky draw campaign deleted",
    });
  } catch (err) {
    console.error("deleteLuckyDrawCampaign error:", err);
    return res.status(500).json({
      ok: false,
      message: "Server error",
    });
  }
}

module.exports = {
  createLuckyDrawCampaign,
  listUserLuckyDrawCampaigns,
  getLuckyDrawCampaignById,
  disableLuckyDrawCampaign,
  deleteLuckyDrawCampaign,
};