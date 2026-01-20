const express = require("express");
const router = express.Router();
const WalletTransaction = require("../models/WalletTransaction");
const { protect } = require("../middleware/auth");

router.get("/me", protect, async (req, res) => {
  try {
    const userId = req.user._id;

    const transactions = await WalletTransaction.find({ userId })
      .sort({ createdAt: -1 })
      .limit(200);

    res.json({ ok: true, transactions });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

module.exports = router;
