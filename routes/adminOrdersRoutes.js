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

module.exports = router;
