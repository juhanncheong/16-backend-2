const mongoose = require("mongoose");
const Withdrawal = require("../models/Withdrawal");
const User = require("../models/User");

// ✅ User creates a withdrawal (deduct balance immediately)
exports.createWithdrawal = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const userId = req.user.userId; 

    let { amount, cryptoType, address } = req.body;

    amount = Number(amount);

    // ✅ basic validation
    if (!amount || isNaN(amount)) {
      throw new Error("Invalid amount");
    }

    if (amount < 10) {
      throw new Error("Minimum withdrawal is 10");
    }

    const allowedTypes = ["BTC_MAINNET", "ETH_ERC20", "SOL", "USDC_ERC20", "USDT_TRC20"];
    if (!allowedTypes.includes(cryptoType)) {
      throw new Error("Invalid crypto type");
    }

    if (!address || typeof address !== "string" || address.trim().length < 8) {
      throw new Error("Invalid withdrawal address");
    }

    // ✅ load user inside transaction
    const user = await User.findById(userId).session(session);
    if (!user) throw new Error("User not found");

    const balanceBefore = Number(user.balance || 0);

    if (balanceBefore < amount) {
      throw new Error("Insufficient balance");
    }

    // ✅ deduct immediately
    user.balance = balanceBefore - amount;
    await user.save({ session });

    const withdrawal = await Withdrawal.create(
      [
        {
          user: user._id,
          amount,
          cryptoType,
          address: address.trim(),
          status: "PENDING",
          balanceBefore,
          balanceAfter: user.balance,
        },
      ],
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    return res.json({
      ok: true,
      message: "Withdrawal submitted successfully",
      withdrawal: withdrawal[0],
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();

    return res.status(400).json({
      ok: false,
      message: err.message || "Withdrawal failed",
    });
  }
};

// ✅ User withdrawal history
exports.getMyWithdrawals = async (req, res) => {
  try {
    const userId = req.user.userId;

    const withdrawals = await Withdrawal.find({ user: userId })
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ ok: true, withdrawals });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      message: "Failed to fetch withdrawals",
    });
  }
};
