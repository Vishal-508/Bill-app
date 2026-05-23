const mongoose = require('mongoose');
const { Product, StockMovement } = require('../models');
const ApiError = require('./ApiError');
const logger = require('../config/logger');

/**
 * StockService — manages all inventory changes with audit logging.
 *
 * Design principles:
 * 1. Single source of truth for stock changes
 * 2. Every change logged in StockMovement
 * 3. Throws errors instead of silent failures
 */

/**
 * Check if there's sufficient stock for an order's items.
 * Returns { sufficient: boolean, issues: [...] }
 */
exports.checkStockAvailability = async (items) => {
  const issues = [];

  const requirements = new Map();

  for (const item of items) {
    if (item.itemType === 'FULL_SHEET') {
      const current = requirements.get(item.product.toString()) || { quantity: 0, type: 'RAW_SHEET' };
      current.quantity += item.quantity;
      requirements.set(item.product.toString(), current);
    } else if (item.itemType === 'BUNDLE') {
      const current = requirements.get(item.product.toString()) || { quantity: 0, type: 'PRE_CUT_BUNDLE' };
      current.quantity += item.quantity;
      requirements.set(item.product.toString(), current);
    } else if (item.itemType === 'CUSTOM_CUT') {
      const rawSheet = await Product.findById(item.fromRawSheet);
      if (!rawSheet) {
        issues.push({ item, error: 'Raw sheet not found' });
        continue;
      }

      const pieceAreaSqFt = (item.dimensions.lengthInches * item.dimensions.widthInches) / 144;
      const totalAreaNeeded = pieceAreaSqFt * item.quantity;
      const sheetsNeeded = Math.ceil(totalAreaNeeded / rawSheet.areaSqFt);

      const current = requirements.get(item.fromRawSheet.toString()) || { quantity: 0, type: 'RAW_SHEET' };
      current.quantity += sheetsNeeded;
      requirements.set(item.fromRawSheet.toString(), current);
    }
  }

  for (const [productId, req] of requirements) {
    const product = await Product.findById(productId);
    if (!product) {
      issues.push({ productId, error: 'Product not found' });
      continue;
    }

    let available;
    if (req.type === 'PRE_CUT_BUNDLE') {
      available = product.bundle?.currentBundles || 0;
      if (req.quantity > available) {
        issues.push({
          productId,
          productName: product.name,
          sku: product.sku,
          required: req.quantity,
          available,
          shortfall: req.quantity - available,
          type: 'INSUFFICIENT_BUNDLES',
        });
      }
    } else {
      available = product.currentStock;
      if (req.quantity > available) {
        issues.push({
          productId,
          productName: product.name,
          sku: product.sku,
          required: req.quantity,
          available,
          shortfall: req.quantity - available,
          type: 'INSUFFICIENT_SHEETS',
        });
      }
    }
  }

  return {
    sufficient: issues.length === 0,
    issues,
    requirements: Object.fromEntries(requirements),
  };
};

/**
 * Deduct stock for an order's items.
 */
exports.deductForOrder = async (order, userId) => {
  const availability = await exports.checkStockAvailability(order.items);
  if (!availability.sufficient) {
    throw ApiError.conflict('Insufficient stock', { issues: availability.issues });
  }

  const movements = [];

  for (const item of order.items) {
    if (item.itemType === 'FULL_SHEET') {
      const product = await Product.findById(item.product);
      const before = product.currentStock;
      product.currentStock -= item.quantity;
      await product.save();

      movements.push(await StockMovement.create({
        product: product._id,
        productSnapshot: { sku: product.sku, name: product.name, productType: product.productType },
        movementType: 'DEDUCTION',
        quantityBefore: before,
        quantityChange: -item.quantity,
        quantityAfter: product.currentStock,
        reason: `Order fulfillment: ${order.orderNumber}`,
        relatedOrder: order._id,
        relatedOrderNumber: order.orderNumber,
        performedBy: userId,
      }));

    } else if (item.itemType === 'BUNDLE') {
      const product = await Product.findById(item.product);
      const bundleBefore = product.bundle.currentBundles;
      product.bundle.currentBundles -= item.quantity;
      product.currentStock = product.bundle.currentBundles;
      await product.save();

      movements.push(await StockMovement.create({
        product: product._id,
        productSnapshot: { sku: product.sku, name: product.name, productType: product.productType },
        movementType: 'DEDUCTION',
        quantityBefore: bundleBefore,
        quantityChange: -item.quantity,
        quantityAfter: product.bundle.currentBundles,
        bundleQuantityBefore: bundleBefore,
        bundleQuantityChange: -item.quantity,
        bundleQuantityAfter: product.bundle.currentBundles,
        reason: `Order fulfillment: ${order.orderNumber}`,
        relatedOrder: order._id,
        relatedOrderNumber: order.orderNumber,
        performedBy: userId,
      }));

    } else if (item.itemType === 'CUSTOM_CUT') {
      const rawSheet = await Product.findById(item.fromRawSheet);
      const pieceAreaSqFt = (item.dimensions.lengthInches * item.dimensions.widthInches) / 144;
      const totalAreaNeeded = pieceAreaSqFt * item.quantity;
      const sheetsNeeded = Math.ceil(totalAreaNeeded / rawSheet.areaSqFt);

      const before = rawSheet.currentStock;
      rawSheet.currentStock -= sheetsNeeded;
      await rawSheet.save();

      movements.push(await StockMovement.create({
        product: rawSheet._id,
        productSnapshot: { sku: rawSheet.sku, name: rawSheet.name, productType: rawSheet.productType },
        movementType: 'DEDUCTION',
        quantityBefore: before,
        quantityChange: -sheetsNeeded,
        quantityAfter: rawSheet.currentStock,
        reason: `Order fulfillment (custom cut): ${order.orderNumber} — ${item.quantity} pieces of ${item.dimensions.lengthInches}×${item.dimensions.widthInches} inch`,
        relatedOrder: order._id,
        relatedOrderNumber: order.orderNumber,
        performedBy: userId,
      }));
    }
  }

  logger.info(`Stock deducted for order ${order.orderNumber}: ${movements.length} movements`);
  return movements;
};

/**
 * Restore stock for a cancelled order.
 */
exports.restoreForOrder = async (order, userId) => {
  const deductions = await StockMovement.find({
    relatedOrder: order._id,
    movementType: 'DEDUCTION',
  });

  if (deductions.length === 0) {
    logger.warn(`No deductions found to restore for order ${order.orderNumber}`);
    return [];
  }

  const restorations = [];

  for (const deduction of deductions) {
    const product = await Product.findById(deduction.product);
    if (!product) continue;

    const restoreQty = Math.abs(deduction.quantityChange);

    if (deduction.productSnapshot.productType === 'PRE_CUT_BUNDLE') {
      const before = product.bundle.currentBundles;
      product.bundle.currentBundles += restoreQty;
      product.currentStock = product.bundle.currentBundles;
      await product.save();

      restorations.push(await StockMovement.create({
        product: product._id,
        productSnapshot: deduction.productSnapshot,
        movementType: 'RESTORATION',
        quantityBefore: before,
        quantityChange: restoreQty,
        quantityAfter: product.bundle.currentBundles,
        bundleQuantityBefore: before,
        bundleQuantityChange: restoreQty,
        bundleQuantityAfter: product.bundle.currentBundles,
        reason: `Order cancelled: ${order.orderNumber}`,
        relatedOrder: order._id,
        relatedOrderNumber: order.orderNumber,
        performedBy: userId,
      }));
    } else {
      const before = product.currentStock;
      product.currentStock += restoreQty;
      await product.save();

      restorations.push(await StockMovement.create({
        product: product._id,
        productSnapshot: deduction.productSnapshot,
        movementType: 'RESTORATION',
        quantityBefore: before,
        quantityChange: restoreQty,
        quantityAfter: product.currentStock,
        reason: `Order cancelled: ${order.orderNumber}`,
        relatedOrder: order._id,
        relatedOrderNumber: order.orderNumber,
        performedBy: userId,
      }));
    }
  }

  logger.info(`Stock restored for cancelled order ${order.orderNumber}: ${restorations.length} restorations`);
  return restorations;
};

/**
 * Update customer purchase insights when order completes.
 */
exports.updateCustomerInsights = async (order) => {
  const { Customer } = require('../models');
  const customer = await Customer.findById(order.customer);
  if (!customer) return;

  const insights = customer.purchaseInsights || {};

  insights.totalOrders = (insights.totalOrders || 0) + 1;
  insights.totalRevenue = +((insights.totalRevenue || 0) + order.totalAmount).toFixed(2);
  insights.lifetimeValue = insights.totalRevenue;
  insights.avgOrderValue = +(insights.totalRevenue / insights.totalOrders).toFixed(2);
  insights.lastOrderDate = order.orderDate;
  insights.lastOrderAmount = order.totalAmount;

  if (!insights.firstOrderDate) {
    insights.firstOrderDate = order.orderDate;
  }

  customer.purchaseInsights = insights;

  if (order.amountDue > 0) {
    customer.currentDues = +(customer.currentDues + order.amountDue).toFixed(2);
  }

  await customer.save();
  logger.info(`Customer insights updated for ${customer.customerName} after order ${order.orderNumber}`);
};
