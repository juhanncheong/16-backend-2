// utils/balance.js
const mongoose = require("mongoose");
const WalletTransaction = require("../models/WalletTransaction");

/**
 * Returns the ledger total (sum of WalletTransaction.amount)
 * availableBalance = user.balance + ledgerTotal
 */
async function getLedgerTotal(userId) {
  const rows = await WalletTransaction.aggregate([
    { $match: { userId: new mongoose.Types.ObjectId(userId) } },
    { $group: { _id: null, total: { $sum: "$amount" } } },
  ]);

  return rows[0]?.total || 0;
}

module.exports = { getLedgerTotal };
