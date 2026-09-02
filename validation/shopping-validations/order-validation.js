const Joi = require("joi");

const orderIdSchema = Joi.string().hex().length(24).required();

const prepareOrderSchema = Joi.object({
  addressId: Joi.string().hex().length(24).optional(),
}).unknown(false);

const adminUpdateOrderSchema = Joi.object({
  status: Joi.string().valid("pending", "confirmed", "cancelled", "expired").optional(),

  paymentStatus: Joi.string()
    .valid("unpaid", "pending", "paid", "failed", "refunded")
    .optional(),
})
  .min(1)
  .unknown(false);

module.exports = {
  orderIdSchema,
  prepareOrderSchema,
  adminUpdateOrderSchema,
};
