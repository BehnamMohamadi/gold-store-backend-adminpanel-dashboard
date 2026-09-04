const Joi = require("joi");

const orderIdSchema = Joi.string().hex().length(24).required();

const prepareOrderSchema = Joi.object({
  addressId: Joi.string().hex().length(24).optional(),
}).unknown(false);

const adminUpdateOrderSchema = Joi.object({
  status: Joi.string().valid("pending", "confirmed", "cancelled", "expired").required(),
}).unknown(false);

module.exports = {
  orderIdSchema,
  prepareOrderSchema,
  adminUpdateOrderSchema,
};
