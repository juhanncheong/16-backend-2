const { DateTime } = require("luxon");
const UserOrder = require("../models/UserOrder");

const ET_ZONE = "America/New_York";

/**
 * Count COMPLETED orders for user's Eastern Time day (00:00 -> 23:59 ET)
 */
async function countCompletedOrdersET(userId, etDate) {
  // etDate = "YYYY-MM-DD" in Eastern Time
  const startET = DateTime.fromFormat(etDate, "yyyy-MM-dd", { zone: ET_ZONE }).startOf("day");
  const endET = startET.plus({ days: 1 });

  // Convert ET boundaries to UTC for Mongo date filtering
  const startUTC = startET.toUTC().toJSDate();
  const endUTC = endET.toUTC().toJSDate();

  const count = await UserOrder.countDocuments({
    user: userId,
    status: "COMPLETED",
    completedAt: { $gte: startUTC, $lt: endUTC },
  });

  return count;
}

function getTodayETDate() {
  const nowET = DateTime.now().setZone(ET_ZONE);
  return nowET.toFormat("yyyy-MM-dd");
}

function getYesterdayETDate(etDate) {
  return DateTime.fromFormat(etDate, "yyyy-MM-dd").minus({ days: 1 }).toFormat("yyyy-MM-dd");
}

module.exports = {
  ET_ZONE,
  getTodayETDate,
  getYesterdayETDate,
  countCompletedOrdersET,
};
