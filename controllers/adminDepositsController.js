const mongoose = require("mongoose");
const WalletTransaction = require("../models/WalletTransaction");
const User = require("../models/User");

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
      limit = Math.min(limit, 100);
    }

    const skip = noLimit ? 0 : (page - 1) * limit;

    const q = String(req.query.q || "").trim();
    const userId = String(req.query.userId || "").trim();
    const fromDate = String(req.query.fromDate || "").trim();
    const toDate = String(req.query.toDate || "").trim();

    const listFilter = { type: { $in: ["DEPOSIT", "ADMIN_ADJUST"] } };
    const statsFilter = { type: "DEPOSIT" };

    if (userId) {
      if (!isValidObjectId(userId)) {
        return res.status(400).json({
          ok: false,
          message: "Invalid userId",
        });
      }

      const oid = new mongoose.Types.ObjectId(userId);
      listFilter.userId = oid;
      statsFilter.userId = oid;
    }

    if (fromDate || toDate) {
      listFilter.createdAt = {};
      statsFilter.createdAt = {};

      if (fromDate) {
        const start = new Date(`${fromDate}T00:00:00.000Z`);
        listFilter.createdAt.$gte = start;
        statsFilter.createdAt.$gte = start;
      }

      if (toDate) {
        const end = new Date(`${toDate}T23:59:59.999Z`);
        listFilter.createdAt.$lte = end;
        statsFilter.createdAt.$lte = end;
      }
    }

    if (q && !userId) {
      const or = [
        { type: { $regex: q, $options: "i" } },
        { note: { $regex: q, $options: "i" } },
      ];

      if (isValidObjectId(q)) {
        const oid = new mongoose.Types.ObjectId(q);
        or.push({ _id: oid });
        or.push({ userId: oid });
      }

      const users = await User.find({
        $or: [
          { uid: { $regex: q, $options: "i" } },
          { phoneNumber: { $regex: q, $options: "i" } },
        ],
      })
        .select("_id")
        .lean();

      const userIds = users.map((u) => u._id);

      if (userIds.length > 0) {
        or.push({ userId: { $in: userIds } });
      }

      listFilter.$or = or;
      statsFilter.$or = or;
    }

    const rowsQuery = WalletTransaction.find(listFilter)
      .sort({ createdAt: -1 })
      .populate("userId", "uid phoneNumber balance")
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
        {
          $match: {
            ...statsFilter,
            createdAt: { $gte: today },
          },
        },
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
      ok: true,
      deposits: rows,
      pagination: {
        page: noLimit ? 1 : page,
        limit: noLimit ? totalRows : limit,
        total: totalRows,
        totalPages,
        pages: totalPages,
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
    return res.status(500).json({
      ok: false,
      message: err.message || "Server error",
    });
  }
};

exports.adminDepositRanks = async (req, res) => {
  try {
    const sortBy = String(req.query.sortBy || "amount").trim().toLowerCase();
    const q = String(req.query.q || "").trim();

    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.min(
      100,
      Math.max(1, parseInt(req.query.limit || "10", 10))
    );
    const skip = (page - 1) * limit;

    const sortStage =
      sortBy === "quantity"
        ? { totalDeposits: -1, totalAmount: -1, lastDepositAt: -1 }
        : { totalAmount: -1, totalDeposits: -1, lastDepositAt: -1 };

    const searchMatch = q
      ? [
          {
            $match: {
              $or: [
                { uid: { $regex: q, $options: "i" } },
                { phoneNumber: { $regex: q, $options: "i" } },
                { userIdText: { $regex: q, $options: "i" } },
              ],
            },
          },
        ]
      : [];

    const basePipeline = [
      {
        $match: {
          type: "DEPOSIT",
          amount: { $gt: 0 },
        },
      },
      {
        $group: {
          _id: "$userId",
          totalDeposits: { $sum: 1 },
          totalAmount: { $sum: "$amount" },
          firstDepositAt: { $min: "$createdAt" },
          lastDepositAt: { $max: "$createdAt" },
        },
      },
      {
        $lookup: {
          from: "users",
          localField: "_id",
          foreignField: "_id",
          as: "user",
        },
      },
      {
        $unwind: {
          path: "$user",
          preserveNullAndEmptyArrays: true,
        },
      },
      {
        $project: {
          _id: 0,
          userId: "$_id",
          userIdText: { $toString: "$_id" },
          uid: { $ifNull: ["$user.uid", "Unknown"] },
          phoneNumber: { $ifNull: ["$user.phoneNumber", "-"] },
          balance: { $ifNull: ["$user.balance", 0] },
          totalDeposits: 1,
          totalAmount: 1,
          firstDepositAt: 1,
          lastDepositAt: 1,
        },
      },
      ...searchMatch,
    ];

    const [rows, countResult, summaryResult] = await Promise.all([
      WalletTransaction.aggregate([
        ...basePipeline,
        { $sort: sortStage },
        { $skip: skip },
        { $limit: limit },
      ]),

      WalletTransaction.aggregate([
        ...basePipeline,
        { $count: "total" },
      ]),

      WalletTransaction.aggregate([
        ...basePipeline,
        {
          $group: {
            _id: null,
            rankedUsers: { $sum: 1 },
            totalDeposits: { $sum: "$totalDeposits" },
            totalAmount: { $sum: "$totalAmount" },
          },
        },
      ]),
    ]);

    const total = Number(countResult[0]?.total || 0);

    const ranks = rows.map((row, index) => ({
      rank: skip + index + 1,
      ...row,
      totalAmount: Number(row.totalAmount || 0),
      totalDeposits: Number(row.totalDeposits || 0),
      balance: Number(row.balance || 0),
    }));

    return res.json({
      ok: true,
      sortBy: sortBy === "quantity" ? "quantity" : "amount",
      ranks,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
      summary: {
        rankedUsers: Number(summaryResult[0]?.rankedUsers || 0),
        totalDeposits: Number(summaryResult[0]?.totalDeposits || 0),
        totalAmount: Number(summaryResult[0]?.totalAmount || 0),
      },
    });
  } catch (err) {
    console.error("adminDepositRanks error:", err);
    return res.status(500).json({ message: "Server error" });
  }
};