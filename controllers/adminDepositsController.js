const WalletTransaction = require("../models/WalletTransaction");

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

exports.adminListDeposits = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || "10", 10)));
    const skip = (page - 1) * limit;

    // ✅ only DEPOSIT transactions
    const baseFilter = { type: "DEPOSIT" };

    // optional filters
    const q = String(req.query.q || "").trim();
    const userId = String(req.query.userId || "").trim();

    if (userId) baseFilter.userId = userId;

    // We’ll filter user phone by populate match if q provided
    // but Mongo can't directly query populated field, so we do a simple approach:
    // if q looks like a Mongo id -> filter userId
    if (q && q.length >= 18) {
      baseFilter.userId = q;
    }

    // ✅ total count
    const total = await WalletTransaction.countDocuments(baseFilter);

    // ✅ list
    const deposits = await WalletTransaction.find(baseFilter)
      .populate("userId", "phoneNumber balance role")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    // ✅ stats
    const todayStart = startOfToday();

    const totalAmountAgg = await WalletTransaction.aggregate([
      { $match: baseFilter },
      { $group: { _id: null, amount: { $sum: "$amount" }, count: { $sum: 1 } } },
    ]);

    const todayAgg = await WalletTransaction.aggregate([
      { $match: { ...baseFilter, createdAt: { $gte: todayStart } } },
      { $group: { _id: null, amount: { $sum: "$amount" }, count: { $sum: 1 } } },
    ]);

    const totalAmount = totalAmountAgg?.[0]?.amount || 0;
    const totalCount = totalAmountAgg?.[0]?.count || 0;

    const todayAmount = todayAgg?.[0]?.amount || 0;
    const todayCount = todayAgg?.[0]?.count || 0;

    return res.json({
      ok: true,
      deposits,
      stats: {
        totalCount,
        totalAmount,
        todayCount,
        todayAmount,
      },
      pagination: {
        page,
        limit,
        total,
        pages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (err) {
    console.error("adminListDeposits error:", err);
    return res.status(500).json({ ok: false, message: "Server error" });
  }
};
