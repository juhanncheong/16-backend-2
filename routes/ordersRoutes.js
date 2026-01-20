const router = require("express").Router();
const { protect } = require("../middleware/auth");

const { searchFlights, submitOrder, orderHistory } = require("../controllers/ordersController");

router.post("/search", protect, searchFlights);
router.post("/submit", protect, submitOrder);
router.get("/history", protect, orderHistory);

module.exports = router;
