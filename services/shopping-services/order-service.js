const crypto = require("crypto");

const Cart = require("../../models/shopping-models/cart-model");
const Order = require("../../models/shopping-models/order-model");
const Address = require("../../models/address-model");

const GoldPricing = require("../../models/product-models/goldPricing-model");

const { calculateProductPrice } = require("../product-services/pricing-service");

const { AppError } = require("../../utils/app-error");

const ORDER_PRICE_VALIDITY_MS = 2 * 60 * 1000;

const generateOrderNumber = () => {
  const randomPart = crypto.randomBytes(3).toString("hex").toUpperCase();

  return `ORD-${Date.now()}-${randomPart}`;
};

const buildAddressSnapshot = async (userId, addressId) => {
  let address = null;

  if (addressId) {
    address = await Address.findOne({
      _id: addressId,
      user: userId,
    });

    if (!address) {
      throw new AppError(404, "shipping address not found");
    }
  } else {
    /*
     * UX-friendly behavior:
     * If the client does not explicitly send an address,
     * use the user's default address when one exists.
     * Existing order flow therefore does not break.
     */
    address = await Address.findOne({
      user: userId,
      isDefault: true,
    });
  }

  if (!address) {
    return null;
  }

  return {
    addressId: address._id,
    title: address.title,
    recipientName: address.recipientName,
    recipientPhone: address.recipientPhone,
    province: address.province,
    city: address.city,
    addressLine: address.addressLine,
    postalCode: address.postalCode,
    buildingNumber: address.buildingNumber,
    unit: address.unit,
  };
};

const buildOrderDataFromCart = async (userId) => {
  const cart = await Cart.findOne({
    user: userId,
  }).populate("items.product");

  if (!cart || cart.items.length === 0) {
    throw new AppError(400, "cart is empty");
  }

  const goldPricing = await GoldPricing.findOne({
    key: "main",
  });

  if (!goldPricing) {
    throw new AppError(503, "gold pricing is not available");
  }

  const items = [];

  let totalItems = 0;
  let totalAmount = 0;

  for (const cartItem of cart.items) {
    const product = cartItem.product;

    if (!product) {
      throw new AppError(400, "one or more cart products no longer exist");
    }

    if (!product.isActive) {
      throw new AppError(400, `${product.name} is not available`);
    }

    if (product.stock < cartItem.quantity) {
      throw new AppError(400, `requested quantity for ${product.name} is not available`);
    }

    const pricing = calculateProductPrice({
      product,
      goldPricing,
    });

    const unitPrice = pricing.finalPrice;

    const totalPrice = unitPrice * cartItem.quantity;

    totalItems += cartItem.quantity;

    totalAmount += totalPrice;

    items.push({
      product: product._id,

      productSnapshot: {
        name: product.name,
        slug: product.slug,
        sku: product.sku,
        coverImage: product.coverImage,
      },

      quantity: cartItem.quantity,

      pricingSnapshot: {
        goldWeight: pricing.goldWeight,

        karat: pricing.karat,

        goldPricePerGram: pricing.goldPricePerGram,

        goldValue: pricing.goldValue,

        wage: {
          type: pricing.wage.type,

          value: pricing.wage.value,

          enabled: pricing.wage.enabled,

          amount: pricing.wage.amount,
        },

        profit: {
          percent: pricing.profit.percent,

          amount: pricing.profit.amount,
        },

        accessoriesPrice: pricing.accessoriesPrice,

        tax: {
          percent: pricing.tax.percent,

          amount: pricing.tax.amount,
        },
      },

      unitPrice,
      totalPrice,
    });
  }

  return {
    items,
    totalItems,
    totalAmount,

    priceExpiresAt: new Date(Date.now() + ORDER_PRICE_VALIDITY_MS),
  };
};

const prepareCurrentOrder = async (userId, addressId = null) => {
  let order = await Order.findOne({
    user: userId,
    status: "pending",
  });

  if (order && order.paymentStatus === "pending") {
    throw new AppError(409, "order is locked for payment");
  }

  if (order && order.paymentStatus === "paid") {
    throw new AppError(409, "order is already paid");
  }

  const orderData = await buildOrderDataFromCart(userId);

  const addressSnapshot = await buildAddressSnapshot(userId, addressId);

  if (order) {
    order.items = orderData.items;

    order.totalItems = orderData.totalItems;

    order.totalAmount = orderData.totalAmount;

    order.priceExpiresAt = orderData.priceExpiresAt;

    /*
     * Only replace the snapshot when an address
     * was resolved. This preserves an already-selected
     * address if a later cart re-sync does not send one.
     */
    if (addressSnapshot) {
      order.shippingAddressSnapshot = addressSnapshot;
    }

    if (order.paymentStatus === "failed") {
      order.paymentStatus = "unpaid";
    }

    await order.save();

    return {
      order,
      created: false,
    };
  }

  order = await Order.create({
    orderNumber: generateOrderNumber(),

    user: userId,

    shippingAddressSnapshot: addressSnapshot,

    items: orderData.items,

    totalItems: orderData.totalItems,

    totalAmount: orderData.totalAmount,

    status: "pending",

    paymentStatus: "unpaid",

    priceExpiresAt: orderData.priceExpiresAt,
  });

  return {
    order,
    created: true,
  };
};

const getCurrentOrder = async (userId) => {
  const order = await Order.findOne({
    user: userId,
    status: "pending",
  });

  if (!order) {
    throw new AppError(404, "current order not found");
  }

  return order;
};

module.exports = {
  prepareCurrentOrder,
  getCurrentOrder,
};
