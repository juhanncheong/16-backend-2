const express = require("express");
const router = express.Router();

const VipConfig = require("../models/VipConfig");
const { protect } = require("../middleware/auth");

// ✅ User can read VIP config (ordersLimit + commissionRate)
router.get("/vip/config", protect, async (req, res) => {
  try {
    let config = await VipConfig.findOne().lean();

    if (!config) {
      config = await VipConfig.create({
        ranks: [
          { rank: 1, ordersLimit: 40, commissionRate: 0.01 },
          { rank: 2, ordersLimit: 60, commissionRate: 0.015 },
          { rank: 3, ordersLimit: 80, commissionRate: 0.02 },
        ],
      });
    }

    return res.json({ ok: true, config });
  } catch (err) {
    console.error("VIP config error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

module.exports = router;
