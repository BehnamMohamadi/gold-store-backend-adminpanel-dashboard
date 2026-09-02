const { AppError } = require("../../utils/app-error");

const getGoldPriceByKarat = (goldPricing, karat) => {
  const priceMap = {
    18: goldPricing.prices.gold18,
    21: goldPricing.prices.gold21,
    22: goldPricing.prices.gold22,
    24: goldPricing.prices.gold24,
  };

  const goldPricePerGram = priceMap[karat];

  if (goldPricePerGram === null || goldPricePerGram === undefined) {
    throw new AppError(400, `gold price for ${karat}k is not available`);
  }

  return goldPricePerGram;
};

const resolvePricingRules = (product, goldPricing) => {
  const pricing = product.pricing || {};

  if (pricing.mode === "custom") {
    return {
      profitPercent: pricing.profitPercent ?? goldPricing.profitPercent,

      taxPercent: pricing.taxPercent ?? goldPricing.taxPercent,

      wageEnabled: pricing.wageEnabled ?? true,
    };
  }

  return {
    profitPercent: goldPricing.profitPercent,

    taxPercent: goldPricing.taxPercent,

    wageEnabled: true,
  };
};

const calculateWage = ({ goldValue, wage, wageEnabled }) => {
  if (!wageEnabled) {
    return 0;
  }

  if (!wage) {
    return 0;
  }

  if (wage.type === "percent") {
    return goldValue * (wage.value / 100);
  }

  if (wage.type === "fixed") {
    return wage.value;
  }

  throw new AppError(400, "invalid product wage type");
};

const calculateProductPrice = ({ product, goldPricing }) => {
  if (!product) {
    throw new AppError(400, "product is required for price calculation");
  }

  if (!goldPricing) {
    throw new AppError(400, "gold pricing is required for price calculation");
  }

  const goldPricePerGram = getGoldPriceByKarat(goldPricing, product.karat);

  const { profitPercent, taxPercent, wageEnabled } = resolvePricingRules(
    product,
    goldPricing,
  );

  /*
   * Value of the actual gold
   */
  const goldValue = product.goldWeight * goldPricePerGram;

  /*
   * Manufacturing wage
   */
  const wageAmount = calculateWage({
    goldValue,

    wage: product.wage,

    wageEnabled,
  });

  /*
   * Accessories such as stones
   */
  const accessoriesPrice = product.accessoriesPrice || 0;

  /*
   * Seller profit
   *
   * Current formula:
   * profit is calculated on:
   *
   * gold value + wage
   */
  const profitBase = goldValue + wageAmount;

  const profitAmount = profitBase * (profitPercent / 100);

  /*
   * Tax
   *
   * Current formula:
   * tax is calculated only on:
   *
   * wage + profit
   *
   * NOT on the raw gold value.
   */
  const taxBase = wageAmount + profitAmount;

  const taxAmount = taxBase * (taxPercent / 100);

  /*
   * Final price
   */
  const finalPrice = goldValue + wageAmount + profitAmount + accessoriesPrice + taxAmount;

  return {
    goldWeight: product.goldWeight,

    karat: product.karat,

    goldPricePerGram: Math.round(goldPricePerGram),

    goldValue: Math.round(goldValue),

    wage: {
      type: product.wage?.type || "percent",

      value: product.wage?.value || 0,

      enabled: wageEnabled,

      amount: Math.round(wageAmount),
    },

    profit: {
      percent: profitPercent,

      amount: Math.round(profitAmount),
    },

    accessoriesPrice: Math.round(accessoriesPrice),

    tax: {
      percent: taxPercent,

      amount: Math.round(taxAmount),
    },

    finalPrice: Math.round(finalPrice),
  };
};

module.exports = {
  calculateProductPrice,
};
