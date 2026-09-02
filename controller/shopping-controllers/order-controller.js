const Order = require("../../models/shopping-models/order-model");

const { prepareCurrentOrder } = require("../../services/shopping-services/order-service");

const { ApiFeatures } = require("../../utils/api-features");

const { AppError } = require("../../utils/app-error");

const { catchAsync } = require("../../utils/catch-async");

const prepareOrder = catchAsync(async (req, res) => {
  const { order, created } = await prepareCurrentOrder(
    req.user._id,
    req.body?.addressId || null,
  );

  res.status(created ? 201 : 200).json({
    status: "success",
    data: {
      order,
    },
  });
});

const getMyOrders = catchAsync(async (req, res) => {
  const query = {
    ...req.query,
  };

  delete query.user;

  const features = new ApiFeatures(
    Order.find({
      user: req.user._id,
    }),
    query,
  )
    .filter()
    .sort()
    .limitFields()
    .paginate();

  const orders = await features.query;

  const total = await Order.countDocuments({
    ...features.filterObject,
    user: req.user._id,
  });

  res.status(200).json({
    status: "success",
    page: features.page,
    perPage: features.limit,
    total,
    totalPages: Math.ceil(total / features.limit),
    results: orders.length,
    data: {
      orders,
    },
  });
});

const getMyOrderHistory = catchAsync(async (req, res) => {
  const query = {
    ...req.query,
  };

  delete query.user;
  delete query.status;

  const features = new ApiFeatures(
    Order.find({
      user: req.user._id,
      status: {
        $ne: "pending",
      },
    }),
    query,
  )
    .filter()
    .sort()
    .limitFields()
    .paginate();

  const orders = await features.query;

  const total = await Order.countDocuments({
    ...features.filterObject,
    user: req.user._id,
    status: {
      $ne: "pending",
    },
  });

  res.status(200).json({
    status: "success",
    page: features.page,
    perPage: features.limit,
    total,
    totalPages: Math.ceil(total / features.limit),
    results: orders.length,
    data: {
      orders,
    },
  });
});

const getMyOrder = catchAsync(async (req, res, next) => {
  const order = await Order.findOne({
    _id: req.params.orderId,
    user: req.user._id,
  });

  if (!order) {
    return next(new AppError(404, "order not found"));
  }

  res.status(200).json({
    status: "success",
    data: {
      order,
    },
  });
});

const cancelOrder = catchAsync(async (req, res, next) => {
  const order = await Order.findOne({
    _id: req.params.orderId,
    user: req.user._id,
  });

  if (!order) {
    return next(new AppError(404, "order not found"));
  }

  if (order.status !== "pending") {
    return next(new AppError(400, "only pending order can be cancelled"));
  }

  if (order.paymentStatus === "pending") {
    return next(new AppError(400, "order with pending payment cannot be cancelled"));
  }

  if (order.paymentStatus === "paid") {
    return next(new AppError(400, "paid order cannot be cancelled"));
  }

  order.status = "cancelled";

  await order.save();

  res.status(204).send();
});

const getAllOrders = catchAsync(async (req, res) => {
  const features = new ApiFeatures(
    Order.find().populate(
      "user",
      ["firstname", "lastname", "phonenumber", "email"].join(" "),
    ),
    req.query,
  )
    .filter()
    .sort()
    .limitFields()
    .paginate();

  const orders = await features.query;

  const total = await Order.countDocuments(features.filterObject);

  res.status(200).json({
    status: "success",
    page: features.page,
    perPage: features.limit,
    total,
    totalPages: Math.ceil(total / features.limit),
    results: orders.length,
    data: {
      orders,
    },
  });
});

const getOrderForAdmin = catchAsync(async (req, res, next) => {
  const order = await Order.findById(req.params.orderId).populate(
    "user",
    ["firstname", "lastname", "phonenumber", "email", "role", "accountStatus"].join(" "),
  );

  if (!order) {
    return next(new AppError(404, "order not found"));
  }

  res.status(200).json({
    status: "success",
    data: {
      order,
    },
  });
});

const updateOrderForAdmin = catchAsync(async (req, res, next) => {
  const order = await Order.findById(req.params.orderId);

  if (!order) {
    return next(new AppError(404, "order not found"));
  }

  if (req.body.status !== undefined) {
    order.status = req.body.status;
  }

  if (req.body.paymentStatus !== undefined) {
    order.paymentStatus = req.body.paymentStatus;
  }

  await order.save({
    validateModifiedOnly: true,
  });

  res.status(200).json({
    status: "success",
    data: {
      order,
    },
  });
});

module.exports = {
  prepareOrder,
  getMyOrders,
  getMyOrderHistory,
  getMyOrder,
  cancelOrder,
  getAllOrders,
  getOrderForAdmin,
  updateOrderForAdmin,
};
