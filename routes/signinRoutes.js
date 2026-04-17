const router = require("express").Router();

const { protect } = require("../middleware/auth");
const User = require("../models/User");
const SigninClaim = require("../models/SigninClaim");
const SigninRewardRule = require("../models/SigninRewardRule");

async function getRewardForDay(streakDay) {
  // streakDay = 1..6
  const rule = await SigninRewardRule.findOne({ isActive: true }).lean();
  const rewards = rule?.dayRewards || [10, 10, 10, 10, 10, 10];

  const idx = Math.max(0, Math.min(5, Number(streakDay) - 1));
  return Number(rewards[idx] || 0);
}

function calcNextStreakDay({ totalResetCount, lastClaimedResetCount, signinStreak }) {
  const streakNow = Number(signinStreak || 0);
  const lastRound = Number(lastClaimedResetCount || 0);
  const currentRound = Number(totalResetCount || 1);

  // first ever claim
  if (lastRound === 0) {
    return 1;
  }

  // already claimed this round => show current streak
  if (lastRound >= currentRound) {
    return streakNow > 0 ? Math.min(6, streakNow) : 1;
  }

  // any later round claim => continue streak
  // no reset for skipped rounds
  // after day 6 => back to day 1
  const currentDay = streakNow > 0 ? streakNow : 1;
  return currentDay >= 6 ? 1 : currentDay + 1;
}

/**
 * STATUS (Round-based, 1 claim per round)
 * Rule:
 * - user can claim if ordersCompleted >= ordersLimit
 * - AND sign-in reward is enabled
 * - AND user has NOT claimed in current reset round
 */
router.get("/status", protect, async (req, res) => {
  try {
    const userId = req.user.userId;

    const user = await User.findById(userId).lean();
    if (!user) {
      return res.status(404).json({ ok: false, message: "User not found" });
    }

    const signinRewardEnabled = Boolean(user.signinRewardEnabled);
    const ordersCompleted = Number(user.ordersCompleted || 0);
    const ordersLimit = Number(user.ordersLimit || 40);

    const totalResetCount = Number(user.totalResetCount || 1);
    const lastClaimedResetCount = Number(user.lastClaimedResetCount || 0);

    const unlocked = ordersCompleted >= ordersLimit;
    const claimedThisRound = lastClaimedResetCount >= totalResetCount;

    const signinStreak = Number(user.signinStreak || 0);

    const nextStreakDay = calcNextStreakDay({
      totalResetCount,
      lastClaimedResetCount,
      signinStreak,
    });

    // reward should match what user would claim next
    const rewardAmount = await getRewardForDay(nextStreakDay);

    const canClaim = signinRewardEnabled && unlocked && !claimedThisRound;

    const rule = await SigninRewardRule.findOne({ isActive: true }).lean();
    const dayRewards = rule?.dayRewards || [10, 10, 10, 10, 10, 10];

    return res.json({
      ok: true,
      ordersCompleted,
      ordersLimit,
      totalResetCount,
      lastClaimedResetCount,

      nextStreakDay,
      signinStreak,

      unlocked,
      claimedThisRound,
      canClaim,

      rewardAmount,
      dayRewards,

      message: canClaim
        ? "You can claim your sign-in reward now."
        : !signinRewardEnabled
        ? "Sign-in reward is not enabled yet. Please wait for admin approval."
        : !unlocked
        ? `Complete ${ordersLimit} orders to unlock sign-in reward.`
        : "Already claimed this round. Wait for admin reset.",
    });
  } catch (err) {
    console.error("signin status error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * CLAIM (Round-based, 1 claim per round)
 * Rule:
 * - user must have ordersCompleted >= ordersLimit
 * - user must have sign-in reward enabled
 * - user must NOT have claimed in current totalResetCount round
 * - after claim => set lastClaimedResetCount = totalResetCount
 */
router.post("/claim", protect, async (req, res) => {
  try {
    const userId = req.user.userId;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ ok: false, message: "User not found" });
    }

    const ordersCompleted = Number(user.ordersCompleted || 0);
    const ordersLimit = Number(user.ordersLimit || 40);

    const totalResetCount = Number(user.totalResetCount || 1);
    const lastClaimedResetCount = Number(user.lastClaimedResetCount || 0);

    const unlocked = ordersCompleted >= ordersLimit;
    const claimedThisRound = lastClaimedResetCount >= totalResetCount;

    if (!user.signinRewardEnabled) {
      return res.status(403).json({
        ok: false,
        message: "Sign-in reward is not enabled yet. Please wait for admin approval.",
      });
    }

    if (!unlocked) {
      return res.status(400).json({
        ok: false,
        message: `Complete ${ordersLimit} orders to unlock sign-in reward.`,
        ordersCompleted,
        ordersLimit,
        totalResetCount,
        lastClaimedResetCount,
      });
    }

    if (claimedThisRound) {
      return res.status(400).json({
        ok: false,
        message: "Already claimed this round. Wait for admin reset.",
        totalResetCount,
        lastClaimedResetCount,
      });
    }

    // Give reward
    const streakDay = calcNextStreakDay({
      totalResetCount,
      lastClaimedResetCount,
      signinStreak: user.signinStreak,
    });

    const rewardAmount = await getRewardForDay(streakDay);

    user.balance = Number(user.balance || 0) + rewardAmount;
    user.signinStreak = streakDay;
    user.lastClaimedResetCount = totalResetCount;
    user.lastSigninDate = new Date().toISOString().slice(0, 10);

    await user.save();

    // Save claim history (one record per round)
    try {
      await SigninClaim.create({
        userId,
        localDate: `ROUND-${totalResetCount}`,
        timezone: "ROUND",
        streakDay,
        rewardAmount,
      });
    } catch (e) {
      // If duplicate key happens, ignore it
    }

    return res.json({
      ok: true,
      message: "Claimed successfully",
      rewardAmount,
      streakDay,
      newBalance: user.balance,
      totalResetCount,
      lastClaimedResetCount: user.lastClaimedResetCount,
    });
  } catch (err) {
    if (String(err.message).includes("duplicate key")) {
      return res.status(400).json({
        ok: false,
        message: "Already claimed this round.",
      });
    }

    console.error("signin claim error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

module.exports = router;