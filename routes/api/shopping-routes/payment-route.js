const express = require("express");

const {
  createPayment,

  zarinpalCallback,

  mockPaymentSuccess,

  getMyPayments,

  getMyPayment,

  getAllPayments,

  getOrderPaymentsForAdmin,
} = require("../../../controller/shopping-controllers/payment-controller");

const { protect, restrictTo } = require("../../../middleware/auth-middleware");

const { validateParam } = require("../../../middleware/validate-param");

const {
  orderIdSchema,
} = require("../../../validation/shopping-validations/order-validation");

const {
  paymentIdSchema,
} = require("../../../validation/shopping-validations/payment-validation");

const router = express.Router();

/*
 * Public callback.
 *
 * عمداً قبل از router.use(protect)
 */
router.get("/zarinpal/callback", zarinpalCallback);

router.use(protect);

/*
 * Admin
 */
router.get("/all", restrictTo("admin"), getAllPayments);

router.get(
  "/admin/order/:orderId",
  restrictTo("admin"),
  validateParam("orderId", orderIdSchema),
  getOrderPaymentsForAdmin,
);

/*
 * Start payment
 * Body ندارد.
 */
router.post("/order/:orderId", validateParam("orderId", orderIdSchema), createPayment);

/*
 * Development-only mock success
 */
router.post(
  "/mock/:paymentId/success",
  validateParam("paymentId", paymentIdSchema),
  mockPaymentSuccess,
);

/*
 * Current user's payments
 */
router.get("/", getMyPayments);

router.get("/:paymentId", validateParam("paymentId", paymentIdSchema), getMyPayment);

module.exports = router;
