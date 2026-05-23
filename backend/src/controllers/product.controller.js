const mongoose = require('mongoose');
const { Product, ProductGrade } = require('../models');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const logger = require('../config/logger');
const QueryBuilder = require('../utils/queryBuilder');
const { generateSKU, validateSKUFormat } = require('../utils/skuGenerator');

/**
 * POST /api/products
 * Create product (auto-generates SKU if not provided)
 * Access: ADMIN, SUPER_ADMIN
 */
exports.create = asyncHandler(async (req, res) => {
  const grade = await ProductGrade.findOne({ _id: req.body.grade, isActive: true });
  if (!grade) {
    throw ApiError.badRequest('Invalid or inactive grade');
  }

  if (!req.body.sku) {
    req.body.sku = await generateSKU({
      thicknessMM: req.body.thicknessMM,
      lengthFT: req.body.lengthFT,
      widthFT: req.body.widthFT,
      grade: req.body.grade,
    });
  } else {
    if (!validateSKUFormat(req.body.sku.toUpperCase())) {
      throw ApiError.badRequest('Invalid SKU format');
    }
    req.body.sku = req.body.sku.toUpperCase();
  }

  if (req.body.gstRatePct === undefined) {
    req.body.gstRatePct = grade.defaultGstRatePct || 18;
  }

  const product = await Product.create({
    ...req.body,
    createdBy: req.user._id,
  });

  await product.populate('grade', 'code label');

  logger.info(`Product created: ${product.sku} by ${req.user.email}`);

  res.status(201).json({ status: 'success', data: product });
});

/**
 * GET /api/products
 * Advanced query with filters
 */
exports.list = asyncHandler(async (req, res) => {
  const q = req.query;
  const builder = new QueryBuilder(Product, q);

  const includeDeleted = q.includeDeleted === 'true';
  if (includeDeleted && !['ADMIN', 'SUPER_ADMIN'].includes(req.user.role)) {
    throw ApiError.forbidden('Only admins can view deleted products');
  }
  if (!includeDeleted) {
    builder.setFilter({ isDeleted: false });
  }

  if (q.search) {
    builder.addTextSearch(q.search, ['name', 'sku', 'brand', 'description']);
  }

  builder
    .addObjectIdFilter('grade', q.grade)
    .addFilter('brand', q.brand)
    .addFilter('pricingUnit', q.pricingUnit)
    .addFilter('productType', q.productType);  // carry-forward fix from Prompt 3 Section H

  if (q.gradeCode) {
    const grade = await ProductGrade.findByCode(q.gradeCode);
    if (grade) {
      builder.addObjectIdFilter('grade', grade._id.toString());
    } else {
      builder.addFilter('grade', new mongoose.Types.ObjectId());
    }
  }

  if (q.thicknessMM) {
    builder.addFilter('thicknessMM', parseFloat(q.thicknessMM));
  }
  if (q.minThickness || q.maxThickness) {
    builder.addRangeFilter('thicknessMM',
      q.minThickness ? parseFloat(q.minThickness) : undefined,
      q.maxThickness ? parseFloat(q.maxThickness) : undefined
    );
  }

  if (q.lengthFT) builder.addFilter('lengthFT', parseFloat(q.lengthFT));
  if (q.widthFT) builder.addFilter('widthFT', parseFloat(q.widthFT));

  builder.addRangeFilter('basePrice',
    q.minPrice ? parseFloat(q.minPrice) : undefined,
    q.maxPrice ? parseFloat(q.maxPrice) : undefined
  );

  if (q.inStock === 'true') {
    builder.setFilter({ currentStock: { $gt: 0 } });
  } else if (q.inStock === 'false') {
    builder.setFilter({ currentStock: { $lte: 0 } });
  }

  if (q.lowStock === 'true') {
    builder.setFilter({ $expr: { $lte: ['$currentStock', '$minStockAlert'] } });
  }

  if (q.tags) builder.addArrayFilter('tags', q.tags, 'all');
  if (q.anyTags) builder.addArrayFilter('tags', q.anyTags, 'any');

  if (q.isActive !== undefined) builder.addBoolFilter('isActive', q.isActive);

  builder
    .setSort(q.sort || '-createdAt')
    .setPagination(q.page, q.limit)
    .setFields(q.fields)
    .populate('grade', 'code label iconName')
    .populate('createdBy', 'name email');

  const result = await builder.execute();

  res.json({
    status: 'success',
    ...result,
  });
});

/**
 * GET /api/products/:id
 */
exports.getById = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw ApiError.badRequest('Invalid product ID');
  }

  const product = await Product.findById(req.params.id)
    .populate('grade', 'code label description defaultGstRatePct')
    .populate('createdBy', 'name email')
    .populate('updatedBy', 'name email')
    .populate('priceHistory.changedBy', 'name email');

  if (!product) {
    throw ApiError.notFound('Product not found');
  }

  if (product.isDeleted && !['ADMIN', 'SUPER_ADMIN'].includes(req.user.role)) {
    throw ApiError.notFound('Product not found');
  }

  res.json({ status: 'success', data: product });
});

/**
 * PUT /api/products/:id
 */
exports.update = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw ApiError.badRequest('Invalid product ID');
  }

  const product = await Product.findById(req.params.id);
  if (!product || product.isDeleted) {
    throw ApiError.notFound('Product not found');
  }

  if (req.body.grade && req.body.grade !== product.grade.toString()) {
    const gradeExists = await ProductGrade.exists({ _id: req.body.grade, isActive: true });
    if (!gradeExists) {
      throw ApiError.badRequest('Invalid or inactive grade');
    }
  }

  const protectedFields = ['_id', 'createdBy', 'createdAt', 'priceHistory', 'isDeleted', 'deletedAt', 'deletedBy', 'deletionReason', 'sku'];
  protectedFields.forEach((field) => delete req.body[field]);

  if (req.body.basePrice !== undefined && req.body.basePrice !== product.basePrice) {
    throw ApiError.badRequest(
      'Price changes must go through POST /api/products/:id/update-price for proper audit logging'
    );
  }

  Object.assign(product, req.body);
  product.updatedBy = req.user._id;

  await product.save();
  await product.populate('grade', 'code label');

  logger.info(`Product updated: ${product.sku} by ${req.user.email}`);

  res.json({ status: 'success', data: product });
});

/**
 * POST /api/products/:id/update-price
 */
exports.updatePrice = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw ApiError.badRequest('Invalid product ID');
  }

  const { newPrice, reason } = req.body;

  const product = await Product.findById(req.params.id);
  if (!product || product.isDeleted) {
    throw ApiError.notFound('Product not found');
  }

  if (newPrice === product.basePrice) {
    throw ApiError.badRequest('New price is same as current price');
  }

  const oldPrice = product.basePrice;

  // Set transient properties — pre-save hook will use these
  product._priceChangeReason = reason || 'Price updated';
  product._priceChangedByUser = req.user._id;

  // Update price — pre-save hook handles history tracking (single source of truth)
  product.basePrice = newPrice;
  product.updatedBy = req.user._id;

  await product.save();

  logger.info(`Price updated for ${product.sku}: ₹${oldPrice} → ₹${newPrice} by ${req.user.email}. Reason: ${reason || 'N/A'}`);

  res.json({
    status: 'success',
    data: {
      sku: product.sku,
      oldPrice,
      newPrice,
      changePct: +((((newPrice - oldPrice) / oldPrice) * 100).toFixed(2)),
      historyEntries: product.priceHistory.length,
    },
  });
});

/**
 * POST /api/products/:id/adjust-stock
 */
exports.adjustStock = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw ApiError.badRequest('Invalid product ID');
  }

  const { delta, reason } = req.body;

  const product = await Product.findById(req.params.id);
  if (!product || product.isDeleted) {
    throw ApiError.notFound('Product not found');
  }

  const oldStock = product.currentStock;
  const newStock = oldStock + delta;

  if (newStock < 0) {
    throw ApiError.badRequest(
      `Cannot deduct ${Math.abs(delta)} units — only ${oldStock} in stock`
    );
  }

  product.currentStock = newStock;
  product.updatedBy = req.user._id;

  if (delta > 0) {
    product.lastRestockedAt = new Date();
  }

  await product.save();

  logger.info(`Stock ${delta > 0 ? 'added' : 'deducted'} for ${product.sku}: ${oldStock} → ${newStock} (Δ${delta}) by ${req.user.email}. Reason: ${reason}`);

  res.json({
    status: 'success',
    data: {
      sku: product.sku,
      oldStock,
      newStock,
      delta,
      isLowStock: newStock <= product.minStockAlert,
      reason,
    },
  });
});

/**
 * POST /api/products/:id/calculate-price
 */
exports.calculatePrice = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw ApiError.badRequest('Invalid product ID');
  }

  const { quantity, unit } = req.body;

  if (!quantity || quantity <= 0) {
    throw ApiError.badRequest('Quantity must be greater than 0');
  }

  const product = await Product.findById(req.params.id);
  if (!product || product.isDeleted || !product.isActive) {
    throw ApiError.notFound('Product not found or inactive');
  }

  const calculation = product.calculatePrice(quantity, unit);

  res.json({
    status: 'success',
    data: {
      product: {
        sku: product.sku,
        name: product.name,
        basePrice: product.basePrice,
        pricingUnit: product.pricingUnit,
      },
      calculation,
    },
  });
});

/**
 * GET /api/products/low-stock
 */
exports.lowStock = asyncHandler(async (req, res) => {
  const products = await Product.find({
    isDeleted: false,
    isActive: true,
    $expr: { $lte: ['$currentStock', '$minStockAlert'] },
  })
    .populate('grade', 'code label')
    .sort({ currentStock: 1 })
    .lean();

  res.json({
    status: 'success',
    count: products.length,
    data: products,
  });
});

/**
 * DELETE /api/products/:id (soft)
 */
exports.softDelete = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw ApiError.badRequest('Invalid product ID');
  }

  const product = await Product.findById(req.params.id);
  if (!product) throw ApiError.notFound('Product not found');
  if (product.isDeleted) throw ApiError.badRequest('Product already deleted');

  const reason = req.body?.reason || 'No reason provided';
  await product.softDelete(req.user._id, reason);

  logger.info(`Product soft-deleted: ${product.sku} by ${req.user.email}. Reason: ${reason}`);

  res.json({
    status: 'success',
    message: 'Product soft-deleted',
    data: { id: product._id, sku: product.sku },
  });
});

/**
 * POST /api/products/:id/restore
 */
exports.restore = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) throw ApiError.notFound('Product not found');
  if (!product.isDeleted) throw ApiError.badRequest('Product is not deleted');

  await product.restore();
  product.updatedBy = req.user._id;
  await product.save();

  logger.info(`Product restored: ${product.sku} by ${req.user.email}`);

  res.json({ status: 'success', message: 'Product restored', data: { id: product._id } });
});

/**
 * DELETE /api/products/:id/hard-delete
 */
exports.hardDelete = asyncHandler(async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) throw ApiError.notFound('Product not found');
  if (!product.isDeleted) {
    throw ApiError.badRequest('Product must be soft-deleted first');
  }

  const info = { id: product._id, sku: product.sku, name: product.name };
  await product.deleteOne();

  logger.warn(`Product HARD-DELETED: ${info.sku} by ${req.user.email} — IRREVERSIBLE`);

  res.json({
    status: 'success',
    message: 'Product permanently deleted',
    data: info,
  });
});

/**
 * GET /api/products/analytics/by-grade
 */
exports.analyticsByGrade = asyncHandler(async (req, res) => {
  const result = await Product.aggregate([
    { $match: { isDeleted: false } },
    {
      $group: {
        _id: '$grade',
        productCount: { $sum: 1 },
        totalStock: { $sum: '$currentStock' },
        avgPrice: { $avg: '$basePrice' },
        totalInventoryValue: { $sum: { $multiply: ['$basePrice', '$currentStock', '$areaSqFt'] } },
      },
    },
    {
      $lookup: { from: 'productgrades', localField: '_id', foreignField: '_id', as: 'grade' },
    },
    { $unwind: { path: '$grade', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 0,
        gradeId: '$_id',
        code: '$grade.code',
        label: { $ifNull: ['$grade.label', 'Ungraded'] },
        productCount: 1,
        totalStock: 1,
        avgPrice: { $round: ['$avgPrice', 2] },
        totalInventoryValue: { $round: ['$totalInventoryValue', 2] },
      },
    },
    { $sort: { totalInventoryValue: -1 } },
  ]);

  res.json({ status: 'success', count: result.length, data: result });
});

/**
 * GET /api/products/analytics/inventory-value
 */
exports.inventoryValue = asyncHandler(async (req, res) => {
  const [totalAgg, byUnit, stockSummary] = await Promise.all([
    Product.aggregate([
      { $match: { isDeleted: false, isActive: true } },
      {
        $group: {
          _id: null,
          totalProducts: { $sum: 1 },
          totalStock: { $sum: '$currentStock' },
          totalValue: { $sum: { $multiply: ['$basePrice', '$currentStock', '$areaSqFt'] } },
          avgPrice: { $avg: '$basePrice' },
        },
      },
    ]),
    Product.aggregate([
      { $match: { isDeleted: false } },
      { $group: { _id: '$pricingUnit', count: { $sum: 1 } } },
    ]),
    Product.aggregate([
      { $match: { isDeleted: false, isActive: true } },
      {
        $group: {
          _id: null,
          inStock: { $sum: { $cond: [{ $gt: ['$currentStock', 0] }, 1, 0] } },
          lowStock: {
            $sum: { $cond: [{ $lte: ['$currentStock', '$minStockAlert'] }, 1, 0] },
          },
          outOfStock: { $sum: { $cond: [{ $lte: ['$currentStock', 0] }, 1, 0] } },
        },
      },
    ]),
  ]);

  const total = totalAgg[0] || { totalProducts: 0, totalStock: 0, totalValue: 0, avgPrice: 0 };
  const stock = stockSummary[0] || { inStock: 0, lowStock: 0, outOfStock: 0 };

  res.json({
    status: 'success',
    data: {
      totals: {
        products: total.totalProducts,
        totalSheetsInStock: total.totalStock,
        totalInventoryValueRs: +((total.totalValue || 0)).toFixed(2),
        avgPriceRs: +((total.avgPrice || 0)).toFixed(2),
      },
      stockStatus: {
        inStock: stock.inStock,
        lowStock: stock.lowStock,
        outOfStock: stock.outOfStock,
      },
      byPricingUnit: byUnit.reduce((acc, item) => {
        acc[item._id] = item.count;
        return acc;
      }, {}),
    },
  });
});
