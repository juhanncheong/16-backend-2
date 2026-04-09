// adminDepositsController.js
const mongoose = require("mongoose");
const WalletTransaction = require("../models/WalletTransaction"); // <-- adjust path if needed

function isValidObjectId(v) {
  return mongoose.Types.ObjectId.isValid(v);
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

exports.adminListDeposits = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || "10", 10)));
    const skip = (page - 1) * limit;

    // Your UI might pass `q` or `userId`
    const q = String(req.query.q || "").trim();
    const userId = String(req.query.userId || "").trim();
    const pickedUser = userId || q;

    // TABLE: show both DEPOSIT and ADMIN_ADJUST
    const listFilter = { type: { $in: ["DEPOSIT", "ADMIN_ADJUST"] } };

    // STATS: deposits only
    const statsFilter = { type: "DEPOSIT" };

    if (pickedUser && isValidObjectId(pickedUser)) {
      listFilter.userId = new mongoose.Types.ObjectId(pickedUser);
      statsFilter.userId = new mongoose.Types.ObjectId(pickedUser);
    }

    const [rows, totalRows] = await Promise.all([
      WalletTransaction.find(listFilter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("userId", "uid phoneNumber")
        .lean(),
      WalletTransaction.countDocuments(listFilter),
    ]);

    // ---- STATS (DEPOSIT only) ----
    const today = startOfToday();

    const [depositTotalsAgg, todayTotalsAgg] = await Promise.all([
      WalletTransaction.aggregate([
        { $match: statsFilter },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            amount: { $sum: "$amount" },
          },
        },
      ]),
      WalletTransaction.aggregate([
        { $match: { ...statsFilter, createdAt: { $gte: today } } },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            amount: { $sum: "$amount" },
          },
        },
      ]),
    ]);

    const totalDeposits = depositTotalsAgg[0]?.count || 0;
    const totalDepositAmount = Number(depositTotalsAgg[0]?.amount || 0);

    const todayDeposits = todayTotalsAgg[0]?.count || 0;
    const todayDepositAmount = Number(todayTotalsAgg[0]?.amount || 0);

    const totalPages = Math.max(1, Math.ceil(totalRows / limit));

    return res.json({
      deposits: rows, // includes DEPOSIT + ADMIN_ADJUST
      pagination: {
        page,
        limit,
        total: totalRows, // count of rows shown (both types)
        totalPages,
      },
      stats: {
        totalDeposits, // DEPOSIT only
        totalDepositAmount, // DEPOSIT only
        todayDeposits, // DEPOSIT only
        todayDepositAmount, // DEPOSIT only
      },
    });
  } catch (err) {
    console.error("adminListDeposits error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};
