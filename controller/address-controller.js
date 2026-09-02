const Address = require("../models/address-model");

const { AppError } = require("../utils/app-error");
const { catchAsync } = require("../utils/catch-async");

const unsetOtherDefaults = async (userId, addressId) => {
  await Address.updateMany(
    {
      user: userId,
      _id: { $ne: addressId },
      isDefault: true,
    },
    {
      $set: { isDefault: false },
    },
  );
};

const getMyAddresses = catchAsync(async (req, res) => {
  const addresses = await Address.find({
    user: req.user._id,
  }).sort({
    isDefault: -1,
    createdAt: -1,
  });

  res.status(200).json({
    status: "success",
    results: addresses.length,
    data: {
      addresses,
    },
  });
});

const getMyAddress = catchAsync(async (req, res, next) => {
  const address = await Address.findOne({
    _id: req.params.addressId,
    user: req.user._id,
  });

  if (!address) {
    return next(new AppError(404, "address not found"));
  }

  res.status(200).json({
    status: "success",
    data: {
      address,
    },
  });
});

const addAddress = catchAsync(async (req, res) => {
  const addressCount = await Address.countDocuments({
    user: req.user._id,
  });

  const shouldBeDefault =
    addressCount === 0 ||
    req.body.isDefault === true;

  const address = await Address.create({
    ...req.body,
    user: req.user._id,
    isDefault: shouldBeDefault,
  });

  if (shouldBeDefault) {
    await unsetOtherDefaults(
      req.user._id,
      address._id,
    );
  }

  res.status(201).json({
    status: "success",
    data: {
      address,
    },
  });
});

const editAddress = catchAsync(async (req, res, next) => {
  const address = await Address.findOne({
    _id: req.params.addressId,
    user: req.user._id,
  });

  if (!address) {
    return next(new AppError(404, "address not found"));
  }

  Object.assign(address, req.body);

  /*
   * A user must not end up with addresses but no default address.
   * If the current default is manually turned off, another address
   * becomes default when possible.
   */
  if (
    req.body.isDefault === false &&
    address.isDefault === false
  ) {
    const replacement = await Address.findOne({
      user: req.user._id,
      _id: { $ne: address._id },
    }).sort({ createdAt: -1 });

    if (!replacement) {
      address.isDefault = true;
    } else {
      replacement.isDefault = true;
      await replacement.save({
        validateModifiedOnly: true,
      });
    }
  }

  await address.save({
    validateModifiedOnly: true,
  });

  if (address.isDefault) {
    await unsetOtherDefaults(
      req.user._id,
      address._id,
    );
  }

  res.status(200).json({
    status: "success",
    data: {
      address,
    },
  });
});

const setDefaultAddress = catchAsync(async (req, res, next) => {
  const address = await Address.findOne({
    _id: req.params.addressId,
    user: req.user._id,
  });

  if (!address) {
    return next(new AppError(404, "address not found"));
  }

  address.isDefault = true;

  await address.save({
    validateModifiedOnly: true,
  });

  await unsetOtherDefaults(
    req.user._id,
    address._id,
  );

  res.status(200).json({
    status: "success",
    data: {
      address,
    },
  });
});

const deleteAddress = catchAsync(async (req, res, next) => {
  const address = await Address.findOne({
    _id: req.params.addressId,
    user: req.user._id,
  });

  if (!address) {
    return next(new AppError(404, "address not found"));
  }

  const wasDefault = address.isDefault;

  await address.deleteOne();

  if (wasDefault) {
    const replacement = await Address.findOne({
      user: req.user._id,
    }).sort({
      createdAt: -1,
    });

    if (replacement) {
      replacement.isDefault = true;

      await replacement.save({
        validateModifiedOnly: true,
      });
    }
  }

  res.status(204).send();
});

const getUserAddressesForAdmin = catchAsync(async (req, res) => {
  const addresses = await Address.find({
    user: req.params.userId,
  }).sort({
    isDefault: -1,
    createdAt: -1,
  });

  res.status(200).json({
    status: "success",
    results: addresses.length,
    data: {
      addresses,
    },
  });
});

module.exports = {
  getMyAddresses,
  getMyAddress,
  addAddress,
  editAddress,
  setDefaultAddress,
  deleteAddress,
  getUserAddressesForAdmin,
};
