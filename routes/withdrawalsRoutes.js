const express = require("express");
const router = express.Router();

const { protect } = require("../middleware/auth");
const {
  createWithdrawal,
  getMyWithdrawals,
} = require("../controllers/withdrawalsController");

// user create withdrawal
router.post("/", protect, createWithdrawal);

// user view own history
router.get("/me", protect, getMyWithdrawals);

module.exports = router;
