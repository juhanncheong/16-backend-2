const express = require("express");
const router = express.Router();

const { protect } = require("../middleware/auth");
const {
  createWithdrawal,
  getMyWithdrawals,
  getRecentWithdrawalAddresses,
  setWithdrawalPin,
  changeWithdrawalPin,
  getWithdrawalMethods,
  getLastWithdrawalDetails,
} = require("../controllers/withdrawalsController");

router.get("/methods", protect, getWithdrawalMethods);
router.post("/set-pin", protect, setWithdrawalPin);
router.post("/change-pin", protect, changeWithdrawalPin);

router.post("/", protect, createWithdrawal);
router.get("/me", protect, getMyWithdrawals);
router.get("/recent-addresses", protect, getRecentWithdrawalAddresses);
router.get("/last-details", protect, getLastWithdrawalDetails);

module.exports = router;