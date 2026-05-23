const express = require("express");
const router = express.Router();

const VipConfig = require("../models/VipConfig");
const { protect } = require("../middleware/auth");

function normalizeVipConfig(config) {
  const defaultRanks = [
    { rank: 1, ordersLimit: 40, commissionRate: 0.01, depositRequirement: 50 },
    { rank: 2, ordersLimit: 60, commissionRate: 0.015, depositRequirement: 500 },
    { rank: 3, ordersLimit: 80, commissionRate: 0.02, depositRequirement: 5000 },
  ];

  const existingRanks = Array.isArray(config.ranks) ? config.ranks : [];

  config.ranks = defaultRanks.map((def) => {
    const found = existingRanks.find((r) => Number(r.rank) === def.rank);

    return {
      rank: def.rank,
      ordersLimit: Number(found?.ordersLimit ?? def.ordersLimit),
      commissionRate: Number(found?.commissionRate ?? def.commissionRate),
      depositRequirement: Number(
        found?.depositRequirement ?? def.depositRequirement
      ),
    };
  });

  return config;
}

// ✅ User can read VIP config
router.get("/vip/config", protect, async (req, res) => {
  try {
    let config = await VipConfig.findOne();

    if (!config) {
      config = await VipConfig.create({});
    }

    config = normalizeVipConfig(config);
    await config.save();

    return res.json({ ok: true, config });
  } catch (err) {
    console.error("VIP config error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

module.exports = router;