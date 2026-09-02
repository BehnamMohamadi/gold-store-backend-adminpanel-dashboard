const multer = require("multer");

const { AppError } = require("../utils/app-error");

const handleDuplicateKeyError = (err) => {
  const field = Object.keys(err.keyValue || {})[0];

  const value = err.keyValue?.[field];

  if (field === "phonenumber") {
    return new AppError(409, "this phonenumber is already registered", {
      field,
      value,
    });
  }

  if (field === "email") {
    return new AppError(409, "this email is already registered", {
      field,
      value,
    });
  }

  return new AppError(409, `${field || "value"} already exists`, {
    field,
    value,
  });
};

const handleMulterError = (err) => {
  if (err.code === "LIMIT_UNEXPECTED_FILE") {
    return new AppError(400, "only one image can be uploaded");
  }

  if (err.code === "LIMIT_FILE_SIZE") {
    return new AppError(400, "image size must not exceed 5MB");
  }

  return new AppError(400, err.message || "file upload failed");
};

const handleValidationError = (err) => {
  const details = Object.values(err.errors || {}).map((item) => ({
    field: item.path,
    message: item.message,
  }));

  return new AppError(400, "validation failed", details);
};

const globalErrorHandler = (err, req, res, next) => {
  let error = err;

  if (err?.code === 11000) {
    error = handleDuplicateKeyError(err);
  }

  if (err instanceof multer.MulterError) {
    error = handleMulterError(err);
  }

  if (err?.name === "CastError") {
    error = new AppError(400, `invalid ${err.path}`);
  }

  if (err?.name === "ValidationError") {
    error = handleValidationError(err);
  }

  res.status(error.statusCode || 500).json({
    status: error.status || "error",

    message:
      error.isOperational || process.env.NODE_ENV !== "production"
        ? error.message
        : "internal server error",

    ...(error.details
      ? {
          details: error.details,
        }
      : {}),
  });
};

module.exports = {
  globalErrorHandler,
};
