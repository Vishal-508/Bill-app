const { Product, CuttingChargeRule, ShapeCuttingRate, SystemSetting } = require('../models');
const { toInches, sqInchesToSqFt } = require('./unitConverter');

/**
 * PricingEngine — Calculates order pricing based on:
 * - Product type (RAW_SHEET, BUNDLE, CUSTOM_CUT)
 * - Cutting rules and shape multipliers
 * - Customer location (for GST split)
 * - Quantity tiers (volume discounts)
 * - Wastage policy
 */

// ───────────────────────────────────────────────
// FULL_SHEET pricing
// ───────────────────────────────────────────────
async function calculateFullSheet(item) {
  const product = await Product.findById(item.product);
  if (!product) throw new Error(`Product not found: ${item.product}`);
  if (product.productType !== 'RAW_SHEET') {
    throw new Error(`Product ${product.sku} is not a RAW_SHEET`);
  }

  const quantity = item.quantity;
  const pricePerSqFt = product.basePrice;
  const areaPerSheet = product.areaSqFt;
  const pricePerSheet = pricePerSqFt * areaPerSheet;

  const tier = product.quantityTiers.find(t =>
    quantity >= t.minQty && (t.maxQty === null || quantity <= t.maxQty)
  );
  const discountPct = tier?.discountPct || 0;

  const subtotal = pricePerSheet * quantity;
  const discountAmount = +(subtotal * (discountPct / 100)).toFixed(2);
  const lineSubtotal = +(subtotal - discountAmount).toFixed(2);

  return {
    itemType: 'FULL_SHEET',
    quantity,
    pricePerUnit: +pricePerSheet.toFixed(2),
    materialCost: +subtotal.toFixed(2),
    cuttingCharges: 0,
    wastageAreaSqFt: 0,
    wastageCost: 0,
    discountPct,
    discountAmount,
    lineSubtotal,
    breakdown: {
      pricePerSqFt,
      areaPerSheet,
      pricePerSheet: +pricePerSheet.toFixed(2),
      tier: tier ? `${tier.minQty}+ → ${tier.discountPct}% off` : 'No tier',
    },
  };
}

// ───────────────────────────────────────────────
// BUNDLE pricing
// ───────────────────────────────────────────────
async function calculateBundle(item) {
  const product = await Product.findById(item.product);
  if (!product) throw new Error(`Product not found: ${item.product}`);
  if (product.productType !== 'PRE_CUT_BUNDLE') {
    throw new Error(`Product ${product.sku} is not a PRE_CUT_BUNDLE`);
  }

  const quantity = item.quantity;
  const pricingMode = item.pricingMode || product.bundle?.pricingMode || 'per-bundle';

  let pricePerUnit, materialCost, modeUsed;

  if (pricingMode === 'per-piece') {
    const pieces = item.pieces || quantity;
    pricePerUnit = product.bundle?.pricePerPiece || 0;
    materialCost = pricePerUnit * pieces;
    modeUsed = `${pieces} pieces × ₹${pricePerUnit}/piece`;
  } else {
    pricePerUnit = product.bundle?.pricePerBundle || 0;
    materialCost = pricePerUnit * quantity;
    modeUsed = `${quantity} bundles × ₹${pricePerUnit}/bundle`;
  }

  const lineSubtotal = +materialCost.toFixed(2);

  return {
    itemType: 'BUNDLE',
    quantity,
    pricePerUnit: +pricePerUnit.toFixed(2),
    materialCost: +materialCost.toFixed(2),
    cuttingCharges: 0,
    wastageAreaSqFt: 0,
    wastageCost: 0,
    discountPct: 0,
    discountAmount: 0,
    lineSubtotal,
    breakdown: {
      pricingMode,
      piecesPerBundle: product.bundle?.piecesPerBundle,
      calculation: modeUsed,
    },
  };
}

// ───────────────────────────────────────────────
// CUSTOM_CUT pricing
// ───────────────────────────────────────────────
async function calculateCustomCut(item) {
  const rawSheet = await Product.findById(item.fromRawSheet);
  if (!rawSheet) throw new Error(`Raw sheet not found: ${item.fromRawSheet}`);
  if (rawSheet.productType !== 'RAW_SHEET') {
    throw new Error(`Source must be RAW_SHEET, got ${rawSheet.productType}`);
  }

  const dimensions = item.dimensions || {};
  if (!dimensions.lengthInches || !dimensions.widthInches) {
    throw new Error('CUSTOM_CUT requires dimensions.lengthInches and dimensions.widthInches');
  }

  const pieceAreaSqIn = dimensions.lengthInches * dimensions.widthInches;
  const pieceAreaSqFt = pieceAreaSqIn / 144;
  const quantity = item.quantity;
  const totalAreaNeeded = pieceAreaSqFt * quantity;

  const sheetArea = rawSheet.areaSqFt;
  const sheetsNeeded = Math.ceil(totalAreaNeeded / sheetArea);
  const totalSheetArea = sheetsNeeded * sheetArea;
  const wastageAreaSqFt = +(totalSheetArea - totalAreaNeeded).toFixed(2);

  const materialCost = +(totalSheetArea * rawSheet.basePrice).toFixed(2);

  const cuttingRule = item.cuttingRule
    ? await CuttingChargeRule.findById(item.cuttingRule)
    : await CuttingChargeRule.findOne({
        code: await SystemSetting.getValue('DEFAULT_CUTTING_RULE_CODE', 'PER_PIECE_STD')
      });

  if (!cuttingRule) {
    throw new Error('No cutting rule found (provide cuttingRule ID or seed defaults)');
  }

  const shape = item.shape
    ? await ShapeCuttingRate.findById(item.shape)
    : await ShapeCuttingRate.findByCode('RECTANGLE');

  if (!shape) {
    throw new Error('Shape not found (defaults to RECTANGLE if available)');
  }

  let baseCuttingCharge = 0;
  let cuttingBreakdown = '';

  switch (cuttingRule.mode) {
    case 'per-piece':
      baseCuttingCharge = cuttingRule.perPieceRate * quantity;
      cuttingBreakdown = `${quantity} pieces × ₹${cuttingRule.perPieceRate}/piece`;
      break;
    case 'per-cut': {
      const totalCuts = quantity * (shape.cutsPerPiece || 4);
      baseCuttingCharge = cuttingRule.perCutRate * totalCuts;
      cuttingBreakdown = `${totalCuts} cuts × ₹${cuttingRule.perCutRate}/cut`;
      break;
    }
    case 'per-sqft':
      baseCuttingCharge = cuttingRule.perSqftRate * (pieceAreaSqFt * quantity);
      cuttingBreakdown = `${(pieceAreaSqFt * quantity).toFixed(2)} sqft × ₹${cuttingRule.perSqftRate}/sqft`;
      break;
    case 'included':
      baseCuttingCharge = 0;
      cuttingBreakdown = 'Included in material price';
      break;
    case 'tiered': {
      const applicableTier = cuttingRule.tieredRates.find(t =>
        t.maxAreaSqFt === null || pieceAreaSqFt <= t.maxAreaSqFt
      );
      if (applicableTier) {
        if (applicableTier.unit === 'per-piece') {
          baseCuttingCharge = applicableTier.rate * quantity;
          cuttingBreakdown = `${quantity} pcs × ₹${applicableTier.rate}/piece (tier: ≤${applicableTier.maxAreaSqFt} sqft)`;
        } else {
          baseCuttingCharge = applicableTier.rate * (pieceAreaSqFt * quantity);
          cuttingBreakdown = `${(pieceAreaSqFt * quantity).toFixed(2)} sqft × ₹${applicableTier.rate}/sqft`;
        }
      }
      break;
    }
  }

  let cuttingCharges = baseCuttingCharge;
  let shapeBreakdown = `${shape.label} (×${shape.baseMultiplier})`;

  if (shape.calculationMode === 'multiplier') {
    cuttingCharges = baseCuttingCharge * shape.baseMultiplier;
  } else if (shape.calculationMode === 'fixed-addon') {
    cuttingCharges = baseCuttingCharge + (shape.fixedAddOnPerPiece * quantity);
    shapeBreakdown = `${shape.label} (+₹${shape.fixedAddOnPerPiece}/piece)`;
  }

  cuttingCharges = +cuttingCharges.toFixed(2);

  const lineSubtotal = +(materialCost + cuttingCharges).toFixed(2);

  return {
    itemType: 'CUSTOM_CUT',
    quantity,
    pricePerUnit: +(lineSubtotal / quantity).toFixed(2),
    materialCost,
    cuttingCharges,
    wastageAreaSqFt,
    wastageCost: +(wastageAreaSqFt * rawSheet.basePrice).toFixed(2),
    discountPct: 0,
    discountAmount: 0,
    lineSubtotal,
    breakdown: {
      pieceSize: `${dimensions.lengthInches}×${dimensions.widthInches} inch`,
      pieceArea: `${pieceAreaSqFt.toFixed(2)} sqft`,
      totalAreaNeeded: `${totalAreaNeeded.toFixed(2)} sqft`,
      sheetsNeeded,
      totalSheetArea: `${totalSheetArea.toFixed(2)} sqft`,
      wastagePct: +((wastageAreaSqFt / totalSheetArea) * 100).toFixed(1),
      materialCalc: `${totalSheetArea} sqft × ₹${rawSheet.basePrice}/sqft`,
      cuttingRule: cuttingRule.code,
      cuttingMode: cuttingRule.mode,
      cuttingCalc: cuttingBreakdown,
      shapeMultiplier: shapeBreakdown,
    },
  };
}

// ───────────────────────────────────────────────
// Main calculator
// ───────────────────────────────────────────────

exports.calculateLineItem = async (item) => {
  switch (item.itemType) {
    case 'FULL_SHEET':
      return calculateFullSheet(item);
    case 'BUNDLE':
      return calculateBundle(item);
    case 'CUSTOM_CUT':
      return calculateCustomCut(item);
    default:
      throw new Error(`Unknown itemType: ${item.itemType}`);
  }
};

exports.calculateOrderTotal = async (items, customer, options = {}) => {
  const calculatedItems = await Promise.all(
    items.map(item => exports.calculateLineItem(item))
  );

  const subtotal = +calculatedItems.reduce((sum, item) => sum + item.lineSubtotal, 0).toFixed(2);

  const additionalCharges = options.additionalCharges || 0;
  const orderDiscount = options.discountAmount || 0;

  const taxableAmount = +(subtotal + additionalCharges - orderDiscount).toFixed(2);

  const hasGstBill = options.hasGstBill !== false;
  const gstRatePct = options.gstRatePct ?? await SystemSetting.getValue('DEFAULT_GST_RATE_PCT', 18);

  let cgst = 0, sgst = 0, igst = 0, totalGst = 0, isIntraState = true;

  if (hasGstBill) {
    const businessState = await SystemSetting.getValue('BUSINESS_STATE', 'Madhya Pradesh');
    const customerState = customer?.billingAddress?.state || businessState;
    isIntraState = businessState === customerState;

    if (isIntraState) {
      cgst = +(taxableAmount * (gstRatePct / 200)).toFixed(2);
      sgst = +(taxableAmount * (gstRatePct / 200)).toFixed(2);
      totalGst = +(cgst + sgst).toFixed(2);
    } else {
      igst = +(taxableAmount * (gstRatePct / 100)).toFixed(2);
      totalGst = igst;
    }
  }

  const totalAmount = +(taxableAmount + totalGst).toFixed(2);

  return {
    items: calculatedItems,
    subtotal,
    additionalCharges,
    discountAmount: orderDiscount,
    taxableAmount,
    isIntraState,
    gstRatePct,
    hasGstBill,
    cgst,
    sgst,
    igst,
    totalGst,
    totalAmount,
    summary: {
      itemCount: calculatedItems.length,
      totalQuantity: calculatedItems.reduce((sum, i) => sum + i.quantity, 0),
      totalMaterialCost: +calculatedItems.reduce((sum, i) => sum + i.materialCost, 0).toFixed(2),
      totalCuttingCharges: +calculatedItems.reduce((sum, i) => sum + i.cuttingCharges, 0).toFixed(2),
      totalWastageSqFt: +calculatedItems.reduce((sum, i) => sum + (i.wastageAreaSqFt || 0), 0).toFixed(2),
    },
  };
};
