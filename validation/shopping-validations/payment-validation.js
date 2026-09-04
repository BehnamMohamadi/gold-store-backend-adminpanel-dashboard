const Joi = require("joi");

const paymentIdSchema = Joi.string().hex().length(24).required();

module.exports = {
  paymentIdSchema,
};
