const crypto = require("crypto");

const mongoose = require("mongoose");

const Payment = require("../../models/shopping-models/payment-model");

const Order = require("../../models/shopping-models/order-model");

const Product = require("../../models/product-models/product-model");

const Cart = require("../../models/shopping-models/cart-model");

const {
  requestPayment: requestZarinpalPayment,

  verifyPayment: verifyZarinpalPayment,
} = require("./zarinpal-service");

const { AppError } = require("../../utils/app-error");

const PAYMENT_WINDOW_MS = 10 * 60 * 1000;

const EXPIRATION_SWEEP_MS = 15 * 1000;

let expirationTimer = null;

const getGatewayName = () => {
  const gateway = String(process.env.PAYMENT_GATEWAY || "mock").toLowerCase();

  if (!["mock", "zarinpal"].includes(gateway)) {
    throw new AppError(
      500,

      "invalid payment gateway configuration",

      null,

      "INVALID_PAYMENT_GATEWAY",
    );
  }

  if (process.env.NODE_ENV === "production" && gateway === "mock") {
    throw new AppError(
      500,

      "mock payment gateway is disabled in production",

      null,

      "MOCK_GATEWAY_DISABLED",
    );
  }

  return gateway;
};

const getAmountMultiplier = () => {
  const value = Number(process.env.PAYMENT_AMOUNT_MULTIPLIER || 1);

  if (!Number.isFinite(value) || value <= 0) {
    throw new AppError(
      500,

      "invalid payment amount multiplier",

      null,

      "INVALID_PAYMENT_MULTIPLIER",
    );
  }

  return value;
};

const getCallbackUrl = () =>
  process.env.PAYMENT_CALLBACK_URL?.trim() ||
  `http://127.0.0.1:${process.env.PORT || 3000}/api/payments/zarinpal/callback`;

const getPaymentExpiresAt = () => new Date(Date.now() + PAYMENT_WINDOW_MS);

const clearUserCart = async (userId, session = null) => {
  const options = {};

  if (session) {
    options.session = session;
  }

  await Cart.updateOne(
    {
      user: userId,
    },

    {
      $set: {
        items: [],
      },
    },

    options,
  );
};

const checkOrderStock = async (order, session = null) => {
  const productIds = order.items.map((item) => item.product);

  let query = Product.find({
    _id: {
      $in: productIds,
    },
  }).select("name stock isActive");

  if (session) {
    query = query.session(session);
  }

  const products = await query;

  const productMap = new Map(products.map((product) => [String(product._id), product]));

  for (const item of order.items) {
    const product = productMap.get(String(item.product));

    if (!product) {
      return {
        code: "PRODUCT_NOT_FOUND",

        message: "one or more order products no longer exist",

        productName: item.productSnapshot?.name || null,

        requestedQuantity: item.quantity,
      };
    }

    if (!product.isActive) {
      return {
        code: "PRODUCT_INACTIVE",

        message: `${product.name} is not available`,

        productName: product.name,

        availableStock: product.stock,

        requestedQuantity: item.quantity,
      };
    }

    if (product.stock < item.quantity) {
      return {
        code: "INSUFFICIENT_STOCK",

        message: `requested quantity for ${product.name} is not available`,

        productName: product.name,

        availableStock: product.stock,

        requestedQuantity: item.quantity,
      };
    }
  }

  return null;
};

const createStockError = (stockIssue, message = null) =>
  new AppError(
    409,

    message || stockIssue.message || "order stock is not available",

    stockIssue,

    stockIssue.code || "STOCK_NOT_AVAILABLE",
  );

const appendOpenedReview = (payment, reason) => {
  payment.reviewHistory = payment.reviewHistory || [];

  const alreadyOpened = payment.reviewHistory.some(
    (entry) => entry.action === "opened" && entry.reason === reason,
  );

  if (!alreadyOpened) {
    payment.reviewHistory.push({
      action: "opened",

      fromResolution: null,

      toResolution: null,

      reason,

      actor: null,

      createdAt: new Date(),
    });
  }
};

const normalizeLegacyActivePayments = async () => {
  const payments = await Payment.find({
    status: {
      $in: ["created", "pending"],
    },

    $or: [
      {
        expiresAt: {
          $exists: false,
        },
      },

      {
        expiresAt: null,
      },
    ],
  });

  for (const payment of payments) {
    const baseTime = payment.createdAt ? payment.createdAt.getTime() : Date.now();

    payment.expiresAt = new Date(baseTime + PAYMENT_WINDOW_MS);

    await payment.save({
      validateModifiedOnly: true,
    });

    await Order.updateOne(
      {
        _id: payment.order,

        status: "pending",

        paymentStatus: "pending",
      },

      {
        $set: {
          status: "payment_pending",
        },
      },
    );
  }
};

const expireStalePayments = async () => {
  await normalizeLegacyActivePayments();

  const now = new Date();

  const stalePayments = await Payment.find({
    status: {
      $in: ["created", "pending"],
    },

    expiresAt: {
      $lte: now,
    },
  }).select("_id order");

  let expiredCount = 0;

  for (const stalePayment of stalePayments) {
    const payment = await Payment.findOneAndUpdate(
      {
        _id: stalePayment._id,

        status: {
          $in: ["created", "pending"],
        },

        expiresAt: {
          $lte: now,
        },
      },

      {
        $set: {
          status: "expired",

          failureReason: "payment window expired",
        },
      },

      {
        new: true,
      },
    );

    if (!payment) {
      continue;
    }

    expiredCount += 1;

    await Order.updateOne(
      {
        _id: payment.order,

        status: "payment_pending",

        paymentStatus: "pending",
      },

      {
        $set: {
          status: "expired",

          paymentStatus: "failed",
        },
      },
    );
  }

  return expiredCount;
};

const startPaymentExpirationWorker = () => {
  if (expirationTimer) {
    return expirationTimer;
  }

  expireStalePayments().catch((error) => {
    console.error("[payment-expiration]", error);
  });

  expirationTimer = setInterval(
    () => {
      expireStalePayments().catch((error) => {
        console.error("[payment-expiration]", error);
      });
    },

    EXPIRATION_SWEEP_MS,
  );

  expirationTimer.unref?.();

  return expirationTimer;
};

const markPaymentFailed = async (
  paymentId,
  reason,
  gatewayCode = null,
  orderStatus = "cancelled",
) => {
  const payment = await Payment.findByIdAndUpdate(
    paymentId,

    {
      $set: {
        status: "failed",

        failureReason: reason,

        gatewayCode,
      },
    },

    {
      new: true,
    },
  );

  if (payment) {
    await Order.updateOne(
      {
        _id: payment.order,

        paymentStatus: "pending",
      },

      {
        $set: {
          paymentStatus: "failed",

          status: orderStatus,
        },
      },
    );
  }

  return payment;
};

const markPaidForReview = async (paymentId, gatewayData, reason) => {
  const payment = await Payment.findById(paymentId);

  if (!payment) {
    throw new AppError(404, "payment not found", null, "PAYMENT_NOT_FOUND");
  }

  payment.status = "paid";

  payment.referenceId = gatewayData.referenceId || payment.referenceId || null;

  payment.cardPan = gatewayData.cardPan || payment.cardPan || null;

  payment.cardHash = gatewayData.cardHash || payment.cardHash || null;

  payment.gatewayCode = gatewayData.code || payment.gatewayCode || null;

  payment.verifiedAt = payment.verifiedAt || new Date();

  payment.requiresReview = true;

  payment.reviewReason = reason;

  payment.reviewStatus = "pending";

  payment.resolution = null;

  payment.resolvedAt = null;

  payment.resolvedBy = null;

  payment.failureReason = null;

  appendOpenedReview(payment, reason);

  await payment.save();

  await Order.updateOne(
    {
      _id: payment.order,
    },

    {
      $set: {
        paymentStatus: "paid",

        status: "review",
      },
    },
  );

  return payment;
};

const finalizeWithTransaction = async (paymentId, gatewayData) => {
  const session = await mongoose.startSession();

  let finalizedPayment = null;

  try {
    await session.withTransaction(async () => {
      const payment = await Payment.findById(paymentId).session(session);

      if (!payment) {
        throw new AppError(404, "payment not found", null, "PAYMENT_NOT_FOUND");
      }

      if (["paid", "refunded"].includes(payment.status)) {
        finalizedPayment = payment;

        return;
      }

      const order = await Order.findById(payment.order).session(session);

      if (!order) {
        throw new AppError(404, "order not found", null, "ORDER_NOT_FOUND");
      }

      if (order.status !== "payment_pending") {
        throw new AppError(
          409,

          "order is not awaiting payment",

          null,

          "ORDER_NOT_AWAITING_PAYMENT",
        );
      }

      const stockIssue = await checkOrderStock(order, session);

      if (stockIssue) {
        const reason = stockIssue.message;

        payment.status = "paid";

        payment.referenceId = gatewayData.referenceId || null;

        payment.cardPan = gatewayData.cardPan || null;

        payment.cardHash = gatewayData.cardHash || null;

        payment.gatewayCode = gatewayData.code || null;

        payment.verifiedAt = new Date();

        payment.requiresReview = true;

        payment.reviewReason = reason;

        payment.reviewStatus = "pending";

        payment.resolution = null;

        payment.failureReason = null;

        appendOpenedReview(payment, reason);

        order.paymentStatus = "paid";

        order.status = "review";

        await payment.save({
          session,
        });

        await order.save({
          session,

          validateModifiedOnly: true,
        });

        finalizedPayment = payment;

        return;
      }

      for (const item of order.items) {
        const result = await Product.updateOne(
          {
            _id: item.product,

            stock: {
              $gte: item.quantity,
            },
          },

          {
            $inc: {
              stock: -item.quantity,
            },
          },

          {
            session,
          },
        );

        if (result.modifiedCount !== 1) {
          throw new AppError(
            409,

            "product stock changed during payment finalization",

            null,

            "STOCK_CHANGED",
          );
        }
      }

      order.status = "confirmed";

      order.paymentStatus = "paid";

      payment.status = "paid";

      payment.referenceId = gatewayData.referenceId || null;

      payment.cardPan = gatewayData.cardPan || null;

      payment.cardHash = gatewayData.cardHash || null;

      payment.gatewayCode = gatewayData.code || null;

      payment.verifiedAt = new Date();

      payment.requiresReview = false;

      payment.reviewReason = null;

      payment.reviewStatus = "not_required";

      payment.resolution = null;

      payment.failureReason = null;

      await order.save({
        session,

        validateModifiedOnly: true,
      });

      await payment.save({
        session,
      });

      finalizedPayment = payment;
    });

    return finalizedPayment;
  } finally {
    await session.endSession();
  }
};

const isTransactionUnsupported = (error) => {
  const message = String(error?.message || "");

  return (
    message.includes(
      "Transaction numbers are only allowed on a replica set member or mongos",
    ) ||
    message.includes("does not support retryable writes") ||
    message.includes("replica set")
  );
};

const finalizeWithoutTransaction = async (paymentId, gatewayData) => {
  let payment = await Payment.findOneAndUpdate(
    {
      _id: paymentId,

      status: {
        $in: ["created", "pending", "failed"],
      },
    },

    {
      $set: {
        status: "processing",
      },
    },

    {
      new: true,
    },
  );

  if (!payment) {
    payment = await Payment.findById(paymentId);

    if (!payment) {
      throw new AppError(404, "payment not found", null, "PAYMENT_NOT_FOUND");
    }

    if (["paid", "refunded"].includes(payment.status)) {
      return payment;
    }

    throw new AppError(
      409,

      "payment is being finalized",

      null,

      "PAYMENT_FINALIZING",
    );
  }

  const order = await Order.findById(payment.order);

  if (!order) {
    return markPaidForReview(
      paymentId,

      gatewayData,

      "order not found after successful payment",
    );
  }

  if (order.status !== "payment_pending") {
    return markPaidForReview(
      paymentId,

      gatewayData,

      "payment was verified after the order left the payment window",
    );
  }

  const stockIssue = await checkOrderStock(order);

  if (stockIssue) {
    return markPaidForReview(
      paymentId,

      gatewayData,

      stockIssue.message,
    );
  }

  const decrementedItems = [];

  try {
    for (const item of order.items) {
      const result = await Product.updateOne(
        {
          _id: item.product,

          stock: {
            $gte: item.quantity,
          },
        },

        {
          $inc: {
            stock: -item.quantity,
          },
        },
      );

      if (result.modifiedCount !== 1) {
        throw new AppError(
          409,

          "product stock changed during payment finalization",

          null,

          "STOCK_CHANGED",
        );
      }

      decrementedItems.push({
        product: item.product,

        quantity: item.quantity,
      });
    }

    order.status = "confirmed";

    order.paymentStatus = "paid";

    await order.save({
      validateModifiedOnly: true,
    });

    payment.status = "paid";

    payment.referenceId = gatewayData.referenceId || null;

    payment.cardPan = gatewayData.cardPan || null;

    payment.cardHash = gatewayData.cardHash || null;

    payment.gatewayCode = gatewayData.code || null;

    payment.verifiedAt = new Date();

    payment.requiresReview = false;

    payment.reviewReason = null;

    payment.reviewStatus = "not_required";

    payment.resolution = null;

    payment.failureReason = null;

    await payment.save();

    return payment;
  } catch (error) {
    for (const item of decrementedItems) {
      await Product.updateOne(
        {
          _id: item.product,
        },

        {
          $inc: {
            stock: item.quantity,
          },
        },
      );
    }

    return markPaidForReview(
      paymentId,

      gatewayData,

      error.message || "payment was verified but order finalization needs review",
    );
  }
};

const finalizeSuccessfulPayment = async (paymentId, gatewayData) => {
  const existingPayment = await Payment.findById(paymentId);

  if (!existingPayment) {
    throw new AppError(404, "payment not found", null, "PAYMENT_NOT_FOUND");
  }

  /*
   * Idempotency:
   * Callback تکراری نباید Stock
   * را دوباره کم کند.
   */
  if (["paid", "refunded"].includes(existingPayment.status)) {
    return existingPayment;
  }

  /*
   * پرداخت بعد از مهلت.
   *
   * بانک پول را گرفته؛ پس Payment
   * failed نیست و برای Review می‌رود.
   */
  if (
    existingPayment.status === "expired" ||
    existingPayment.status === "cancelled" ||
    (existingPayment.expiresAt && existingPayment.expiresAt.getTime() <= Date.now())
  ) {
    return markPaidForReview(
      paymentId,

      gatewayData,

      "payment was completed after the 10-minute payment window",
    );
  }

  try {
    return await finalizeWithTransaction(paymentId, gatewayData);
  } catch (error) {
    if (isTransactionUnsupported(error)) {
      return finalizeWithoutTransaction(paymentId, gatewayData);
    }

    /*
     * Verify بانکی موفق بوده.
     * خطای داخلی را نباید Payment Failed
     * حساب کنیم.
     */
    return markPaidForReview(
      paymentId,

      gatewayData,

      error.message || "payment was verified but order finalization needs review",
    );
  }
};

const startPayment = async ({ user, orderId }) => {
  await expireStalePayments();

  const order = await Order.findOne({
    _id: orderId,

    user: user._id,
  });

  if (!order) {
    throw new AppError(404, "order not found", null, "ORDER_NOT_FOUND");
  }

  if (order.status !== "pending") {
    throw new AppError(
      409,

      "only pending order can be paid",

      null,

      "ORDER_NOT_PAYABLE",
    );
  }

  if (order.paymentStatus === "paid") {
    throw new AppError(
      409,

      "order is already paid",

      null,

      "ORDER_ALREADY_PAID",
    );
  }

  if (order.paymentStatus === "pending") {
    throw new AppError(
      409,

      "payment is already in progress",

      null,

      "PAYMENT_ALREADY_IN_PROGRESS",
    );
  }

  if (!order.shippingAddressSnapshot?.addressId) {
    throw new AppError(
      400,

      "shipping address is required before payment",

      null,

      "SHIPPING_ADDRESS_REQUIRED",
    );
  }

  if (order.priceExpiresAt.getTime() <= Date.now()) {
    order.status = "expired";

    await order.save({
      validateModifiedOnly: true,
    });

    throw new AppError(
      409,

      "order price has expired; prepare a new order before payment",

      null,

      "ORDER_PRICE_EXPIRED",
    );
  }

  const stockIssue = await checkOrderStock(order);

  if (stockIssue) {
    throw createStockError(stockIssue);
  }

  const lockedOrder = await Order.findOneAndUpdate(
    {
      _id: order._id,

      user: user._id,

      status: "pending",

      paymentStatus: {
        $in: ["unpaid", "failed"],
      },

      priceExpiresAt: {
        $gt: new Date(),
      },
    },

    {
      $set: {
        status: "payment_pending",

        paymentStatus: "pending",
      },
    },

    {
      new: true,
    },
  );

  if (!lockedOrder) {
    throw new AppError(
      409,

      "order is not available for payment",

      null,

      "ORDER_NOT_PAYABLE",
    );
  }

  const gateway = getGatewayName();

  const multiplier = getAmountMultiplier();

  const gatewayAmount = Math.round(lockedOrder.totalAmount * multiplier);

  let payment = null;

  try {
    payment = await Payment.create({
      user: user._id,

      order: lockedOrder._id,

      gateway,

      amount: lockedOrder.totalAmount,

      gatewayAmount,

      status: "created",

      expiresAt: getPaymentExpiresAt(),
    });

    if (gateway === "mock") {
      payment.authority = `MOCK-${crypto.randomUUID()}`;

      payment.gatewayCode = 100;

      payment.status = "pending";

      await payment.save();

      /*
       * Cart قبلی از اینجا تمام شده.
       *
       * کاربر می‌تواند همزمان Cart
       * و Order جدید بسازد.
       */
      await clearUserCart(user._id);

      return {
        payment,

        redirectUrl: null,

        mockVerifyPath: `/api/payments/mock/${payment._id}/success`,
      };
    }

    const gatewayResult = await requestZarinpalPayment({
      amount: gatewayAmount,

      callbackUrl: getCallbackUrl(),

      description: `Payment for order ${lockedOrder.orderNumber}`,

      mobile: user.phonenumber,

      email: user.email,
    });

    payment.authority = gatewayResult.authority;

    payment.gatewayCode = gatewayResult.code;

    payment.status = "pending";

    await payment.save();

    await clearUserCart(user._id);

    return {
      payment,

      redirectUrl: gatewayResult.redirectUrl,

      mockVerifyPath: null,
    };
  } catch (error) {
    /*
     * اگر هنوز Payment واقعاً شروع نشده،
     * Order را دوباره آزاد می‌کنیم.
     */
    if (payment?._id && payment.status !== "pending") {
      await markPaymentFailed(
        payment._id,

        error.message,

        null,

        "pending",
      );
    } else if (!payment?._id) {
      await Order.updateOne(
        {
          _id: lockedOrder._id,

          paymentStatus: "pending",
        },

        {
          $set: {
            status: "pending",

            paymentStatus: "failed",
          },
        },
      );
    }

    throw error;
  }
};

const handleZarinpalCallback = async ({ authority, status }) => {
  if (!authority) {
    throw new AppError(
      400,

      "payment authority is required",

      null,

      "PAYMENT_AUTHORITY_REQUIRED",
    );
  }

  const payment = await Payment.findOne({
    gateway: "zarinpal",

    authority,
  });

  if (!payment) {
    throw new AppError(404, "payment not found", null, "PAYMENT_NOT_FOUND");
  }

  if (["paid", "refunded"].includes(payment.status)) {
    return {
      payment,

      verified: true,

      alreadyVerified: true,
    };
  }

  if (String(status || "").toUpperCase() !== "OK") {
    if (payment.status !== "expired") {
      payment.status = "cancelled";

      payment.failureReason = "payment was cancelled or rejected by user";

      await payment.save();

      await Order.updateOne(
        {
          _id: payment.order,

          status: "payment_pending",

          paymentStatus: "pending",
        },

        {
          $set: {
            status: "cancelled",

            paymentStatus: "failed",
          },
        },
      );
    }

    return {
      payment,

      verified: false,

      alreadyVerified: false,
    };
  }

  let gatewayData;

  try {
    gatewayData = await verifyZarinpalPayment({
      amount: payment.gatewayAmount,

      authority: payment.authority,
    });
  } catch (error) {
    if (error?.statusCode === 402) {
      await markPaymentFailed(
        payment._id,

        error.message,

        null,

        "cancelled",
      );
    }

    throw error;
  }

  const finalizedPayment = await finalizeSuccessfulPayment(payment._id, gatewayData);

  return {
    payment: finalizedPayment,

    verified: true,

    alreadyVerified: gatewayData.alreadyVerified || false,
  };
};

const completeMockPayment = async ({ paymentId, userId }) => {
  if (process.env.NODE_ENV === "production") {
    throw new AppError(
      404,

      "mock payment route is not available",

      null,

      "MOCK_ROUTE_DISABLED",
    );
  }

  const payment = await Payment.findOne({
    _id: paymentId,

    user: userId,

    gateway: "mock",
  });

  if (!payment) {
    throw new AppError(
      404,

      "mock payment not found",

      null,

      "PAYMENT_NOT_FOUND",
    );
  }

  if (["paid", "refunded"].includes(payment.status)) {
    return payment;
  }

  /*
   * expired مجاز است تا سناریوی
   * Late Payment با Mock قابل تست باشد.
   */
  if (!["created", "pending", "failed", "expired"].includes(payment.status)) {
    throw new AppError(
      409,

      "mock payment cannot be completed",

      null,

      "PAYMENT_NOT_COMPLETABLE",
    );
  }

  return finalizeSuccessfulPayment(
    payment._id,

    {
      code: 100,

      referenceId: `MOCK-REF-${Date.now()}`,

      cardPan: "000000******0000",

      cardHash: null,
    },
  );
};

const decrementOrderStock = async (order) => {
  const stockIssue = await checkOrderStock(order);

  if (stockIssue) {
    throw createStockError(
      stockIssue,

      stockIssue.code === "INSUFFICIENT_STOCK"
        ? "stock is still insufficient for this order"
        : stockIssue.message,
    );
  }

  const decrementedItems = [];

  try {
    for (const item of order.items) {
      const result = await Product.updateOne(
        {
          _id: item.product,

          stock: {
            $gte: item.quantity,
          },
        },

        {
          $inc: {
            stock: -item.quantity,
          },
        },
      );

      if (result.modifiedCount !== 1) {
        throw new AppError(
          409,

          "product stock changed while resolving payment review",

          null,

          "STOCK_CHANGED",
        );
      }

      decrementedItems.push({
        product: item.product,

        quantity: item.quantity,
      });
    }

    return true;
  } catch (error) {
    /*
     * Standalone MongoDB:
     * اگر چند آیتم داشتیم و وسط کار
     * خطا خورد، مقادیر قبلی برگردند.
     */
    for (const item of decrementedItems) {
      await Product.updateOne(
        {
          _id: item.product,
        },

        {
          $inc: {
            stock: item.quantity,
          },
        },
      );
    }

    throw error;
  }
};

const restoreOrderStock = async (order) => {
  for (const item of order.items) {
    await Product.updateOne(
      {
        _id: item.product,
      },

      {
        $inc: {
          stock: item.quantity,
        },
      },
    );
  }
};

const resolvePaymentReview = async ({ paymentId, adminUserId, resolution }) => {
  const originalPayment = await Payment.findById(paymentId);

  if (!originalPayment) {
    throw new AppError(404, "payment not found", null, "PAYMENT_NOT_FOUND");
  }

  if (
    !originalPayment.reviewReason &&
    !originalPayment.requiresReview &&
    !originalPayment.resolution
  ) {
    throw new AppError(
      409,

      "payment does not have review history",

      null,

      "PAYMENT_REVIEW_NOT_FOUND",
    );
  }

  if (!["paid", "refunded"].includes(originalPayment.status)) {
    throw new AppError(
      409,

      "only paid or refunded payment review can be edited",

      null,

      "PAYMENT_REVIEW_NOT_EDITABLE",
    );
  }

  const previousResolution = originalPayment.resolution || null;

  const previousReviewStatus = originalPayment.reviewStatus;

  const previousRequiresReview = originalPayment.requiresReview;

  /*
   * همان نتیجه قبلی:
   * هیچ Stock یا History جدیدی
   * ایجاد نمی‌کنیم.
   */
  if (previousResolution === resolution && previousReviewStatus === "resolved") {
    return originalPayment;
  }

  /*
   * Claim Review.
   *
   * اگر Double Click یا دو Admin
   * همزمان درخواست بدهند فقط یکی
   * می‌تواند reviewStatus را resolving کند.
   */
  const payment = await Payment.findOneAndUpdate(
    {
      _id: originalPayment._id,

      reviewStatus: previousReviewStatus,

      resolution: previousResolution,
    },

    {
      $set: {
        reviewStatus: "resolving",
      },
    },

    {
      new: true,
    },
  );

  if (!payment) {
    throw new AppError(
      409,

      "payment review is already being resolved",

      null,

      "PAYMENT_REVIEW_BUSY",
    );
  }

  const restoreReviewState = async () => {
    await Payment.updateOne(
      {
        _id: payment._id,

        reviewStatus: "resolving",
      },

      {
        $set: {
          reviewStatus: previousReviewStatus,

          requiresReview: previousRequiresReview,
        },
      },
    );
  };

  try {
    const order = await Order.findById(payment.order);

    if (!order) {
      throw new AppError(
        404,

        "order not found",

        null,

        "ORDER_NOT_FOUND",
      );
    }

    /*
     * ----------------------------------
     * موجودی تأمین شد
     * ----------------------------------
     */
    if (resolution === "stock_supplied") {
      /*
       * اگر وضعیت قبلی refunded بوده
       * یا این اولین Resolution است،
       * Stock بابت این Order هنوز کم نشده.
       */
      await decrementOrderStock(order);

      order.status = "confirmed";

      order.paymentStatus = "paid";

      payment.status = "paid";

      payment.requiresReview = false;

      payment.reviewStatus = "resolved";

      payment.resolution = "stock_supplied";

      payment.resolvedAt = new Date();

      payment.resolvedBy = adminUserId;

      payment.reviewHistory.push({
        action: previousResolution ? "resolution_changed" : "resolved",

        fromResolution: previousResolution,

        toResolution: "stock_supplied",

        reason: payment.reviewReason,

        actor: adminUserId,

        createdAt: new Date(),
      });

      await order.save({
        validateModifiedOnly: true,
      });

      await payment.save();

      return payment;
    }

    /*
     * ----------------------------------
     * برگشت وجه
     * ----------------------------------
     */
    if (resolution === "refunded") {
      /*
       * اگر قبلاً Stock Supplied بوده،
       * همان Stock بابت این Order کم شده.
       * با لغو سفارش دوباره برمی‌گردانیم.
       */
      if (previousResolution === "stock_supplied") {
        await restoreOrderStock(order);
      }

      order.status = "cancelled";

      order.paymentStatus = "refunded";

      payment.status = "refunded";

      payment.requiresReview = false;

      payment.reviewStatus = "resolved";

      payment.resolution = "refunded";

      payment.resolvedAt = new Date();

      payment.resolvedBy = adminUserId;

      payment.reviewHistory.push({
        action: previousResolution ? "resolution_changed" : "resolved",

        fromResolution: previousResolution,

        toResolution: "refunded",

        reason: payment.reviewReason,

        actor: adminUserId,

        createdAt: new Date(),
      });

      await order.save({
        validateModifiedOnly: true,
      });

      await payment.save();

      return payment;
    }

    throw new AppError(
      400,

      "invalid payment resolution",

      null,

      "INVALID_REVIEW_RESOLUTION",
    );
  } catch (error) {
    await restoreReviewState();

    throw error;
  }
};

module.exports = {
  startPayment,

  handleZarinpalCallback,

  completeMockPayment,

  expireStalePayments,

  startPaymentExpirationWorker,

  resolvePaymentReview,
};
