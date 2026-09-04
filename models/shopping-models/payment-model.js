const { Schema, model } = require("mongoose");

const paymentSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: [true, "user is required"],
      index: true,
    },

    order: {
      type: Schema.Types.ObjectId,
      ref: "Order",
      required: [true, "order is required"],
      index: true,
    },

    gateway: {
      type: String,
      enum: {
        values: ["mock", "zarinpal"],
        message: "invalid payment gateway",
      },
      required: [true, "payment gateway is required"],
    },

    amount: {
      type: Number,
      required: [true, "payment amount is required"],
      min: [1, "payment amount must be greater than zero"],
    },

    gatewayAmount: {
      type: Number,
      required: [true, "gateway amount is required"],
      min: [1, "gateway amount must be greater than zero"],
    },

    status: {
      type: String,
      enum: {
        values: ["created", "pending", "processing", "paid", "failed", "cancelled"],
        message: "invalid payment status",
      },
      default: "created",
    },

    authority: {
      type: String,
      trim: true,
      default: null,
    },

    referenceId: {
      type: String,
      trim: true,
      default: null,
    },

    cardPan: {
      type: String,
      trim: true,
      default: null,
    },

    cardHash: {
      type: String,
      trim: true,
      default: null,
    },

    gatewayCode: {
      type: Number,
      default: null,
    },

    failureReason: {
      type: String,
      trim: true,
      default: null,
      maxlength: [500, "failure reason is too long"],
    },

    requiresReview: {
      type: Boolean,
      default: false,
    },

    reviewReason: {
      type: String,
      trim: true,
      default: null,
      maxlength: [500, "review reason is too long"],
    },

    verifiedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

paymentSchema.index(
  {
    authority: 1,
  },
  {
    unique: true,

    partialFilterExpression: {
      authority: {
        $type: "string",
      },
    },
  },
);

paymentSchema.index({
  order: 1,
  createdAt: -1,
});

paymentSchema.index({
  user: 1,
  createdAt: -1,
});

module.exports = model("Payment", paymentSchema);
