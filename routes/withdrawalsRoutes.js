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
} = require("../controllers/withdrawalsController");

router.get("/methods", protect, getWithdrawalMethods);
router.post("/set-pin", protect, setWithdrawalPin);
router.post("/change-pin", protect, changeWithdrawalPin);

router.post("/", protect, createWithdrawal);
router.get("/me", protect, getMyWithdrawals);
router.get("/recent-addresses", protect, getRecentWithdrawalAddresses);

module.exports = router;