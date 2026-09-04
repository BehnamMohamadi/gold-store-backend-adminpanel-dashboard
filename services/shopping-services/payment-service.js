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

const getGatewayName = () => {
  const gateway = String(process.env.PAYMENT_GATEWAY || "mock").toLowerCase();

  if (!["mock", "zarinpal"].includes(gateway)) {
    throw new AppError(500, "invalid payment gateway configuration");
  }

  if (process.env.NODE_ENV === "production" && gateway === "mock") {
    throw new AppError(500, "mock payment gateway is disabled in production");
  }

  return gateway;
};

const getAmountMultiplier = () => {
  const value = Number(process.env.PAYMENT_AMOUNT_MULTIPLIER || 1);

  if (!Number.isFinite(value) || value <= 0) {
    throw new AppError(500, "invalid payment amount multiplier");
  }

  return value;
};

const getCallbackUrl = () =>
  process.env.PAYMENT_CALLBACK_URL?.trim() ||
  `http://127.0.0.1:${process.env.PORT || 3000}/api/payments/zarinpal/callback`;

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
      return "one or more order products no longer exist";
    }

    if (!product.isActive) {
      return `${product.name} is not available`;
    }

    if (product.stock < item.quantity) {
      return `requested quantity for ${product.name} is not available`;
    }
  }

  return null;
};

const markPaymentFailed = async (paymentId, reason, gatewayCode = null) => {
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
        },
      },
    );
  }

  return payment;
};

const markPaidForReview = async (paymentId, gatewayData, reason) => {
  const payment = await Payment.findByIdAndUpdate(
    paymentId,

    {
      $set: {
        status: "paid",

        referenceId: gatewayData.referenceId || null,

        cardPan: gatewayData.cardPan || null,

        cardHash: gatewayData.cardHash || null,

        gatewayCode: gatewayData.code || null,

        verifiedAt: new Date(),

        requiresReview: true,

        reviewReason: reason,

        failureReason: null,
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
      },

      {
        $set: {
          paymentStatus: "paid",
        },
      },
    );
  }

  return payment;
};

const finalizeWithTransaction = async (paymentId, gatewayData) => {
  const session = await mongoose.startSession();

  let finalizedPayment = null;

  try {
    await session.withTransaction(async () => {
      const payment = await Payment.findById(paymentId).session(session);

      if (!payment) {
        throw new AppError(404, "payment not found");
      }

      if (payment.status === "paid") {
        finalizedPayment = payment;

        return;
      }

      const order = await Order.findById(payment.order).session(session);

      if (!order) {
        throw new AppError(404, "order not found");
      }

      const stockIssue = await checkOrderStock(order, session);

      /*
       * پول واقعاً پرداخت شده،
       * ولی موجودی تغییر کرده.
       *
       * اینجا نباید دروغ بگوییم
       * که پرداخت failed شده.
       */
      if (stockIssue) {
        payment.status = "paid";

        payment.referenceId = gatewayData.referenceId || null;

        payment.cardPan = gatewayData.cardPan || null;

        payment.cardHash = gatewayData.cardHash || null;

        payment.gatewayCode = gatewayData.code || null;

        payment.verifiedAt = new Date();

        payment.requiresReview = true;

        payment.reviewReason = stockIssue;

        payment.failureReason = null;

        order.paymentStatus = "paid";

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
        const updateResult = await Product.updateOne(
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

        if (updateResult.modifiedCount !== 1) {
          throw new AppError(409, "product stock changed during payment finalization");
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

      payment.failureReason = null;

      await order.save({
        session,

        validateModifiedOnly: true,
      });

      await payment.save({
        session,
      });

      /*
       * فقط بعد از پرداخت موفق
       * Cart پاک می‌شود.
       */
      await Cart.updateOne(
        {
          user: payment.user,
        },

        {
          $set: {
            items: [],
          },
        },

        {
          session,
        },
      );

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
      throw new AppError(404, "payment not found");
    }

    if (payment.status === "paid") {
      return payment;
    }

    throw new AppError(409, "payment is being finalized");
  }

  const order = await Order.findById(payment.order);

  if (!order) {
    return markPaidForReview(
      paymentId,
      gatewayData,
      "order not found after successful payment",
    );
  }

  const stockIssue = await checkOrderStock(order);

  if (stockIssue) {
    return markPaidForReview(paymentId, gatewayData, stockIssue);
  }

  const decrementedItems = [];

  try {
    for (const item of order.items) {
      const updateResult = await Product.updateOne(
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

      if (updateResult.modifiedCount !== 1) {
        throw new AppError(409, "product stock changed during payment finalization");
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

    await Cart.updateOne(
      {
        user: payment.user,
      },

      {
        $set: {
          items: [],
        },
      },
    );

    payment.status = "paid";

    payment.referenceId = gatewayData.referenceId || null;

    payment.cardPan = gatewayData.cardPan || null;

    payment.cardHash = gatewayData.cardHash || null;

    payment.gatewayCode = gatewayData.code || null;

    payment.verifiedAt = new Date();

    payment.requiresReview = false;

    payment.reviewReason = null;

    payment.failureReason = null;

    await payment.save();

    return payment;
  } catch (error) {
    /*
     * اگر MongoDB لوکال
     * Transaction نداشته باشد،
     * تغییرات Stock انجام‌شده
     * برگردانده می‌شوند.
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
    throw new AppError(404, "payment not found");
  }

  /*
   * Idempotency
   *
   * Callback تکراری نباید
   * دوباره Stock کم کند.
   */
  if (existingPayment.status === "paid") {
    return existingPayment;
  }

  try {
    return await finalizeWithTransaction(paymentId, gatewayData);
  } catch (error) {
    /*
     * MongoDB standalone محلی
     * Transaction ندارد.
     */
    if (isTransactionUnsupported(error)) {
      return finalizeWithoutTransaction(paymentId, gatewayData);
    }

    /*
     * بانک پول را تأیید کرده.
     * پس دیگر نباید Payment را
     * failed کنیم.
     */
    return markPaidForReview(
      paymentId,

      gatewayData,

      error.message || "payment was verified but order finalization needs review",
    );
  }
};

const startPayment = async ({ user, orderId }) => {
  const order = await Order.findOne({
    _id: orderId,

    user: user._id,
  });

  if (!order) {
    throw new AppError(404, "order not found");
  }

  if (order.status !== "pending") {
    throw new AppError(409, "only pending order can be paid");
  }

  if (order.paymentStatus === "paid") {
    throw new AppError(409, "order is already paid");
  }

  if (order.paymentStatus === "pending") {
    throw new AppError(409, "payment is already in progress");
  }

  /*
   * تا اینجا Order می‌توانست
   * بدون Address ساخته شود.
   *
   * اما Payment بدون Address
   * اجازه شروع ندارد.
   */
  if (!order.shippingAddressSnapshot?.addressId) {
    throw new AppError(400, "shipping address is required before payment");
  }

  /*
   * قیمت Order دیگر معتبر نیست.
   */
  if (order.priceExpiresAt.getTime() <= Date.now()) {
    order.status = "expired";

    await order.save({
      validateModifiedOnly: true,
    });

    throw new AppError(
      409,
      "order price has expired; prepare a new order before payment",
    );
  }

  /*
   * قبل از فرستادن کاربر
   * به بانک یک بار دیگر
   * موجودی بررسی می‌شود.
   */
  const stockIssue = await checkOrderStock(order);

  if (stockIssue) {
    throw new AppError(409, stockIssue);
  }

  /*
   * Lock اتمیک Order.
   *
   * دو Request هم‌زمان نباید
   * دو Payment شروع کنند.
   */
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
        paymentStatus: "pending",
      },
    },

    {
      new: true,
    },
  );

  if (!lockedOrder) {
    throw new AppError(409, "order is not available for payment");
  }

  const gateway = getGatewayName();

  const multiplier = getAmountMultiplier();

  const gatewayAmount = Math.round(lockedOrder.totalAmount * multiplier);

  let payment;

  try {
    payment = await Payment.create({
      user: user._id,

      order: lockedOrder._id,

      gateway,

      /*
       * مبلغ snapshot شده‌ی Order
       */
      amount: lockedOrder.totalAmount,

      /*
       * مبلغی که واقعاً
       * به Gateway ارسال شد
       */
      gatewayAmount,

      status: "created",
    });

    /*
     * درگاه Fake فقط برای
     * Development/Postman.
     */
    if (gateway === "mock") {
      const authority = `MOCK-${crypto.randomUUID()}`;

      payment.authority = authority;

      payment.gatewayCode = 100;

      payment.status = "pending";

      await payment.save();

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

    return {
      payment,

      redirectUrl: gatewayResult.redirectUrl,

      mockVerifyPath: null,
    };
  } catch (error) {
    /*
     * Gateway حتی شروع نشد.
     * پس Order دوباره اجازه Retry دارد.
     */
    if (payment?._id) {
      await markPaymentFailed(payment._id, error.message);
    } else {
      await Order.updateOne(
        {
          _id: lockedOrder._id,

          paymentStatus: "pending",
        },

        {
          $set: {
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
    throw new AppError(400, "payment authority is required");
  }

  const payment = await Payment.findOne({
    gateway: "zarinpal",

    authority,
  });

  if (!payment) {
    throw new AppError(404, "payment not found");
  }

  /*
   * Callback دوباره آمده.
   * Stock دوباره کم نمی‌شود.
   */
  if (payment.status === "paid") {
    return {
      payment,

      verified: true,

      alreadyVerified: true,
    };
  }

  /*
   * کاربر در بانک Cancel زده
   * یا پرداخت ناموفق بوده.
   */
  if (String(status || "").toUpperCase() !== "OK") {
    payment.status = "cancelled";

    payment.failureReason = "payment was cancelled or rejected by user";

    await payment.save();

    await Order.updateOne(
      {
        _id: payment.order,

        paymentStatus: "pending",
      },

      {
        $set: {
          paymentStatus: "failed",
        },
      },
    );

    return {
      payment,

      verified: false,

      alreadyVerified: false,
    };
  }

  let gatewayData;

  try {
    /*
     * Status=OK به تنهایی
     * اثبات پرداخت نیست.
     *
     * Verify سرور به سرور
     * لازم است.
     */
    gatewayData = await verifyZarinpalPayment({
      amount: payment.gatewayAmount,

      authority: payment.authority,
    });
  } catch (error) {
    /*
     * اگر بانک واقعاً Verify را
     * reject کرد payment failed می‌شود.
     *
     * ولی اگر مشکل شبکه/timeout بود
     * pending می‌ماند تا دوباره Verify شود.
     */
    if (error?.statusCode === 402) {
      await markPaymentFailed(
        payment._id,

        error.message,
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
    throw new AppError(404, "mock payment route is not available");
  }

  const payment = await Payment.findOne({
    _id: paymentId,

    user: userId,

    gateway: "mock",
  });

  if (!payment) {
    throw new AppError(404, "mock payment not found");
  }

  if (payment.status === "paid") {
    return payment;
  }

  if (!["created", "pending", "failed"].includes(payment.status)) {
    throw new AppError(409, "mock payment cannot be completed");
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

module.exports = {
  startPayment,

  handleZarinpalCallback,

  completeMockPayment,
};
