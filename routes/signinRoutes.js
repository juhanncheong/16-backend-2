const router = require("express").Router();

const { protect } = require("../middleware/auth");
const User = require("../models/User");
const SigninClaim = require("../models/SigninClaim");
const SigninRewardRule = require("../models/SigninRewardRule");

const FIRST_CLAIM_ROUND = 3;
const REPEAT_CLAIM_EVERY_ROUNDS = 2;

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

  const roundsSinceLastClaim = currentRound - lastRound;

  // first time claim
  if (lastRound === 0) {
    return 1;
  }

  // not enough rounds yet, streak doesn't move
  if (roundsSinceLastClaim < REPEAT_CLAIM_EVERY_ROUNDS) {
    return streakNow > 0 ? streakNow : 1;
  }

  // enough rounds passed -> move to next day
  // after day 6, go back to day 1
  const currentDay = streakNow > 0 ? streakNow : 1;
  return currentDay >= 6 ? 1 : currentDay + 1;
}

/**
 * STATUS
 */
router.get("/status", protect, async (req, res) => {
  try {
    const userId = req.user.userId;

    const user = await User.findById(userId).lean();
    if (!user) {
      return res.status(404).json({ ok: false, message: "User not found" });
    }

    const ordersCompleted = Number(user.ordersCompleted || 0);
    const ordersLimit = Number(user.ordersLimit || 40);

    const totalResetCount = Number(user.totalResetCount || 1);
    const lastClaimedResetCount = Number(user.lastClaimedResetCount || 0);

    const unlocked = ordersCompleted >= ordersLimit;
    const roundsSinceLastClaim = totalResetCount - lastClaimedResetCount;
    const isFirstClaim = lastClaimedResetCount === 0;

    const signinStreak = Number(user.signinStreak || 0);

    const nextStreakDay = calcNextStreakDay({
      totalResetCount,
      lastClaimedResetCount,
      signinStreak,
    });

    const rewardAmount = await getRewardForDay(nextStreakDay);

    const firstClaimUnlocked = totalResetCount >= FIRST_CLAIM_ROUND;

    const canClaim =
      unlocked &&
      (
        (isFirstClaim && firstClaimUnlocked) ||
        (!isFirstClaim && roundsSinceLastClaim >= REPEAT_CLAIM_EVERY_ROUNDS)
      );

    const rule = await SigninRewardRule.findOne({ isActive: true }).lean();
    const dayRewards = rule?.dayRewards || [10, 10, 10, 10, 10, 10];

    return res.json({
      ok: true,
      ordersCompleted,
      ordersLimit,
      totalResetCount,
      lastClaimedResetCount,
      roundsSinceLastClaim,
      requiredRounds: isFirstClaim ? FIRST_CLAIM_ROUND : REPEAT_CLAIM_EVERY_ROUNDS,

      nextStreakDay,
      signinStreak,

      unlocked,
      canClaim,

      rewardAmount,
      dayRewards,

      message: canClaim
        ? "You can claim your sign-in reward now."
        : !unlocked
        ? `Complete ${ordersLimit} orders to finish this round.`
        : isFirstClaim && totalResetCount < FIRST_CLAIM_ROUND
        ? `Sign-in reward will unlock on round ${FIRST_CLAIM_ROUND}. Current round: ${totalResetCount}.`
        : `You must complete ${REPEAT_CLAIM_EVERY_ROUNDS} rounds before claiming again. Current progress: ${Math.max(0, roundsSinceLastClaim)}/${REPEAT_CLAIM_EVERY_ROUNDS} rounds.`,
    });
  } catch (err) {
    console.error("signin status error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
});

/**
 * CLAIM
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
    const roundsSinceLastClaim = totalResetCount - lastClaimedResetCount;
    const isFirstClaim = lastClaimedResetCount === 0;

    if (!unlocked) {
      return res.status(400).json({
        ok: false,
        message: `Complete ${ordersLimit} orders to finish this round.`,
        ordersCompleted,
        ordersLimit,
        totalResetCount,
        lastClaimedResetCount,
        roundsSinceLastClaim,
        requiredRounds: isFirstClaim ? FIRST_CLAIM_ROUND : REPEAT_CLAIM_EVERY_ROUNDS,
      });
    }

    if (isFirstClaim && totalResetCount < FIRST_CLAIM_ROUND) {
      return res.status(400).json({
        ok: false,
        message: `Sign-in reward will unlock on round ${FIRST_CLAIM_ROUND}. Current round: ${totalResetCount}.`,
        totalResetCount,
        lastClaimedResetCount,
        roundsSinceLastClaim,
        requiredRounds: FIRST_CLAIM_ROUND,
      });
    }

    if (!isFirstClaim && roundsSinceLastClaim < REPEAT_CLAIM_EVERY_ROUNDS) {
      return res.status(400).json({
        ok: false,
        message: `You must complete ${REPEAT_CLAIM_EVERY_ROUNDS} rounds before claiming again. Current progress: ${Math.max(0, roundsSinceLastClaim)}/${REPEAT_CLAIM_EVERY_ROUNDS} rounds.`,
        totalResetCount,
        lastClaimedResetCount,
        roundsSinceLastClaim,
        requiredRounds: REPEAT_CLAIM_EVERY_ROUNDS,
      });
    }

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

    try {
      await SigninClaim.create({
        userId,
        localDate: `ROUND-${totalResetCount}`,
        timezone: "ROUND",
        streakDay,
        rewardAmount,
      });
    } catch (e) {
      // duplicate record, ignore
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