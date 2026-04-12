const express = require("express");
const router = express.Router();

const { protect } = require("../middleware/auth");
const {
  createWithdrawal,
  getMyWithdrawals,
  getRecentWithdrawalAddresses,
  setWithdrawalPin,
  changeWithdrawalPin,
} = require("../controllers/withdrawalsController");

router.post("/set-pin", protect, setWithdrawalPin);
router.post("/change-pin", protect, changeWithdrawalPin);

router.post("/", protect, createWithdrawal);
router.get("/me", protect, getMyWithdrawals);
router.get("/recent-addresses", protect, getRecentWithdrawalAddresses);

module.exports = router;
