const Payment = require("../../models/shopping-models/payment-model");

const {
  startPayment,
  handleZarinpalCallback,
  completeMockPayment,
} = require("../../services/shopping-services/payment-service");

const { ApiFeatures } = require("../../utils/api-features");

const { AppError } = require("../../utils/app-error");

const { catchAsync } = require("../../utils/catch-async");

const createPayment = catchAsync(async (req, res) => {
  const result = await startPayment({
    user: req.user,

    orderId: req.params.orderId,
  });

  res.status(201).json({
    status: "success",

    data: result,
  });
});

const zarinpalCallback = catchAsync(async (req, res) => {
  const result = await handleZarinpalCallback({
    authority: req.query.Authority || req.query.authority,

    status: req.query.Status || req.query.status,
  });

  res.status(200).json({
    status: "success",

    data: result,
  });
});

const mockPaymentSuccess = catchAsync(async (req, res) => {
  const payment = await completeMockPayment({
    paymentId: req.params.paymentId,

    userId: req.user._id,
  });

  res.status(200).json({
    status: "success",

    data: {
      payment,
    },
  });
});

const getMyPayments = catchAsync(async (req, res) => {
  const query = {
    ...req.query,
  };

  delete query.user;
  delete query.order;

  const features = new ApiFeatures(
    Payment.find({
      user: req.user._id,
    }).populate("order", "orderNumber status paymentStatus totalAmount"),

    query,
  )
    .filter()
    .sort()
    .limitFields()
    .paginate();

  const payments = await features.query;

  const total = await Payment.countDocuments({
    ...features.filterObject,

    user: req.user._id,
  });

  res.status(200).json({
    status: "success",

    page: features.page,

    perPage: features.limit,

    total,

    totalPages: Math.ceil(total / features.limit),

    results: payments.length,

    data: {
      payments,
    },
  });
});

const getMyPayment = catchAsync(async (req, res, next) => {
  const payment = await Payment.findOne({
    _id: req.params.paymentId,

    user: req.user._id,
  }).populate("order", "orderNumber status paymentStatus totalAmount");

  if (!payment) {
    return next(new AppError(404, "payment not found"));
  }

  res.status(200).json({
    status: "success",

    data: {
      payment,
    },
  });
});

const getAllPayments = catchAsync(async (req, res) => {
  const features = new ApiFeatures(
    Payment.find()
      .populate("user", "firstname lastname phonenumber email")
      .populate("order", "orderNumber status paymentStatus totalAmount"),

    req.query,
  )
    .filter()
    .sort()
    .limitFields()
    .paginate();

  const payments = await features.query;

  const total = await Payment.countDocuments(features.filterObject);

  res.status(200).json({
    status: "success",

    page: features.page,

    perPage: features.limit,

    total,

    totalPages: Math.ceil(total / features.limit),

    results: payments.length,

    data: {
      payments,
    },
  });
});

const getOrderPaymentsForAdmin = catchAsync(async (req, res) => {
  const payments = await Payment.find({
    order: req.params.orderId,
  })
    .populate("user", "firstname lastname phonenumber email")
    .sort("-createdAt");

  res.status(200).json({
    status: "success",

    results: payments.length,

    data: {
      payments,
    },
  });
});

module.exports = {
  createPayment,
  zarinpalCallback,
  mockPaymentSuccess,
  getMyPayments,
  getMyPayment,
  getAllPayments,
  getOrderPaymentsForAdmin,
};
