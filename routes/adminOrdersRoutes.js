const router = require("express").Router();
const { protect, adminOnly } = require("../middleware/auth");

const {
  createPoolOrder,
  createBonusRule,
  resetUserOrders,
  listPoolOrders,
  togglePoolOrder,
  updatePoolOrder,
  deletePoolOrder,
  listUserBonusRules,
  disableBonusRule,
  deleteBonusRule,
  createOrderImageMap,
  listOrderImageMaps,
  updateOrderImageMap,
  deleteOrderImageMap,
  adminUserOrderHistory,
} = require("../controllers/adminOrdersController");

router.post("/pool/create", protect, adminOnly, createPoolOrder);
router.get("/pool/list", protect, adminOnly, listPoolOrders);
router.patch("/pool/:id/toggle", protect, adminOnly, togglePoolOrder);
router.patch("/pool/:id", protect, adminOnly, updatePoolOrder);
router.delete("/pool/:id", protect, adminOnly, deletePoolOrder);
router.post("/bonus/create", protect, adminOnly, createBonusRule);
router.get("/bonus/user/:userId", protect, adminOnly, listUserBonusRules);
router.patch("/bonus/:id/disable", protect, adminOnly, disableBonusRule);
router.delete("/bonus/:id", protect, adminOnly, deleteBonusRule);
router.post("/users/:userId/reset-orders", protect, adminOnly, resetUserOrders);
router.get("/users/:userId/orders", protect, adminOnly, adminUserOrderHistory);
router.post("/pool-image/create", protect, adminOnly, createOrderImageMap);
router.get("/pool-image/list", protect, adminOnly, listOrderImageMaps);
router.patch("/pool-image/:id", protect, adminOnly, updateOrderImageMap);
router.delete("/pool-image/:id", protect, adminOnly, deleteOrderImageMap);

module.exports = router;
