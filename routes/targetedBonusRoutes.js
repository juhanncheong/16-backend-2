const express = require("express");
const { protect } = require("../middleware/auth");
const TargetedBonusOffer = require("../models/TargetedBonusOffer");

const router = express.Router();

/**
 * ============================
 * ✅ USER TARGETED BONUS OFFERS
 * ============================
 */

// ✅ User get own active targeted bonus offers
router.get("/my-offers", protect, async (req, res) => {
  try {
    const userId = req.user.userId;

    const offers = await TargetedBonusOffer.find({
      user: userId,
      status: { $in: ["active", "reserved"] },
    })
      .sort({ createdAt: -1 })
      .lean();

    return res.json({
      ok: true,
      offers,
    });
  } catch (err) {
    console.error("get my targeted bonus offers error:", err);
    return res.status(500).json({
      ok: false,
      message: err.message || "Server error",
    });
  }
});

// ✅ User reserve one targeted bonus offer option
router.post("/:offerId/reserve", protect, async (req, res) => {
  try {
    const userId = req.user.userId;
    const offerId = req.params.offerId;
    const { depositAmount, bonusAmount } = req.body || {};

    const selectedDepositAmount = Number(depositAmount);
    const selectedBonusAmount = Number(bonusAmount);

    if (!Number.isFinite(selectedDepositAmount) || selectedDepositAmount <= 0) {
      return res.status(400).json({
        ok: false,
        message: "Invalid deposit amount",
      });
    }

    if (!Number.isFinite(selectedBonusAmount) || selectedBonusAmount < 0) {
      return res.status(400).json({
        ok: false,
        message: "Invalid bonus amount",
      });
    }

    const offer = await TargetedBonusOffer.findOne({
      _id: offerId,
      user: userId,
    });

    if (!offer) {
      return res.status(404).json({
        ok: false,
        message: "Offer not found",
      });
    }

    if (offer.isReserved || offer.status === "reserved") {
      return res.status(400).json({
        ok: false,
        message: "You already reserved this offer",
      });
    }

    if (offer.status !== "active") {
      return res.status(400).json({
        ok: false,
        message: "This offer is not active",
      });
    }

    const matchedOption = offer.options.find((option) => {
      return (
        Number(option.depositAmount) === selectedDepositAmount &&
        Number(option.bonusAmount) === selectedBonusAmount
      );
    });
 
    if (!matchedOption) {
      return res.status(400).json({
        ok: false,
        message: "Selected bonus option does not exist",
      });
    }
        
    if (matchedOption?.isFull) {
      return res.status(400).json({
        ok: false,
        message: "This bonus option is already full",
      });
    }

    offer.selectedOption = {
      depositAmount: selectedDepositAmount,
      bonusAmount: selectedBonusAmount,
    };

    offer.isReserved = true;
    offer.reservedAt = new Date();
    offer.status = "reserved";

    await offer.save();

    return res.json({
      ok: true,
      message: "✅ Bonus offer reserved successfully",
      offer,
    });
  } catch (err) {
    console.error("reserve targeted bonus offer error:", err);
    return res.status(500).json({
      ok: false,
      message: err.message || "Server error",
    });
  }
});

module.exports = router;