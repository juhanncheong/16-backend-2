const mongoose = require("mongoose");
const WalletTransaction = require("../models/WalletTransaction");

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

    const rawLimit = String(req.query.limit || "10").trim().toLowerCase();
    const noLimit = rawLimit === "all";

    let limit = 10;
    if (!noLimit) {
      limit = Math.max(1, parseInt(rawLimit || "10", 10));
      if (!Number.isFinite(limit)) limit = 10;
    }

    const skip = noLimit ? 0 : (page - 1) * limit;

    const q = String(req.query.q || "").trim();
    const userId = String(req.query.userId || "").trim();
    const pickedUser = userId || q;

    const listFilter = { type: { $in: ["DEPOSIT", "ADMIN_ADJUST"] } };
    const statsFilter = { type: "DEPOSIT" };

    if (pickedUser && isValidObjectId(pickedUser)) {
      const oid = new mongoose.Types.ObjectId(pickedUser);
      listFilter.userId = oid;
      statsFilter.userId = oid;
    }

    const rowsQuery = WalletTransaction.find(listFilter)
      .sort({ createdAt: -1 })
      .populate("userId", "uid phoneNumber")
      .lean();

    if (!noLimit) {
      rowsQuery.skip(skip).limit(limit);
    }

    const [rows, totalRows] = await Promise.all([
      rowsQuery,
      WalletTransaction.countDocuments(listFilter),
    ]);

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

    const totalPages = noLimit ? 1 : Math.max(1, Math.ceil(totalRows / limit));

    return res.json({
      deposits: rows,
      pagination: {
        page: noLimit ? 1 : page,
        limit: noLimit ? totalRows : limit,
        total: totalRows,
        totalPages,
        noLimit,
      },
      stats: {
        totalDeposits,
        totalDepositAmount,
        todayDeposits,
        todayDepositAmount,
      },
    });
  } catch (err) {
    console.error("adminListDeposits error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};