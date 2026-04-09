const router = require("express").Router();
const { protect } = require("../middleware/auth");

const { searchFlights, submitOrder, orderHistory, currentOrder } = require("../controllers/ordersController");

router.post("/search", protect, searchFlights);
router.post("/submit", protect, submitOrder);
router.get("/history", protect, orderHistory);
router.get("/current", protect, currentOrder);

module.exports = router;
