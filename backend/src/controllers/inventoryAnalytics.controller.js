const mongoose = require('mongoose');
const { StockMovement, Product, ProductGrade } = require('../models');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');

/**
 * Inventory Analytics (Prompt 8 Section B) — admin-internal READ-ONLY
 * aggregation layer. Reads StockMovement + Product. No mutations.
 *
 * See [[prompt8_inventory_analytics_only]] memory: this data informs
 * admin decisions only; it never gates customer-facing flows.
 */

const MS_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_RANGE_DAYS = 90;

// ─── tiny in-memory TTL cache for /dashboard ───
// Keyed by from+to range. 5-minute TTL keeps dashboard widgets snappy
// without staleness becoming noticeable (consumption data updates daily).
const _cache = new Map();
const DASHBOARD_TTL_MS = 5 * 60 * 1000;

function cacheGet(key) {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    _cache.delete(key);
    return null;
  }
  return entry.value;
}

function cacheSet(key, value, ttl = DASHBOARD_TTL_MS) {
  _cache.set(key, { value, expiresAt: Date.now() + ttl });
}

exports._clearCache = () => _cache.clear(); // for tests

// ─── Shared helpers ───

/**
 * Resolve a date range from query params, with defaults + validation.
 */
function resolveRange(q, defaultDays = DEFAULT_RANGE_DAYS) {
  const to = q.dateTo ? new Date(q.dateTo) : new Date();
  const from = q.dateFrom ? new Date(q.dateFrom) : new Date(to.getTime() - defaultDays * MS_DAY);
  if (from > to) {
    throw ApiError.badRequest('dateFrom must be <= dateTo');
  }
  return { from, to };
}

/**
 * Compute the equivalent previous-period range, same length as current.
 * Used for trend calculation.
 */
function previousPeriod(from, to) {
  const len = to.getTime() - from.getTime();
  return { from: new Date(from.getTime() - len), to: new Date(from.getTime() - 1) };
}

function trendFromPct(pctChange) {
  if (pctChange == null || Number.isNaN(pctChange)) return 'stable';
  if (pctChange > 10) return 'up';
  if (pctChange < -10) return 'down';
  return 'stable';
}

/**
 * $dateToString format string for a groupBy bucket.
 */
function dateFormatFor(groupBy) {
  switch (groupBy) {
    case 'week': return '%G-W%V';   // ISO week-year + ISO week (2 digits)
    case 'month': return '%Y-%m';
    case 'day':
    default: return '%Y-%m-%d';
  }
}

/**
 * GET /api/inventory/analytics/consumption
 * Time-series sheets-consumed bucketed by day/week/month.
 */
exports.consumption = asyncHandler(async (req, res) => {
  const { from, to } = resolveRange(req.query);
  const groupBy = req.query.groupBy || 'day';
  const productId = req.query.productId;

  const match = {
    movementType: 'DEDUCTION',
    createdAt: { $gte: from, $lte: to },
  };
  if (productId) match.product = new mongoose.Types.ObjectId(productId);

  const pipeline = [
    { $match: match },
    // Join product to get basePrice + areaSqFt for value approximation
    { $lookup: { from: 'products', localField: 'product', foreignField: '_id', as: '_product' } },
    { $unwind: { path: '$_product', preserveNullAndEmptyArrays: true } },
    {
      $addFields: {
        absQty: { $abs: '$quantityChange' },
        approxLineValue: {
          $multiply: [
            { $abs: '$quantityChange' },
            { $ifNull: ['$_product.basePrice', 0] },
            { $ifNull: ['$_product.areaSqFt', 1] },
          ],
        },
      },
    },
    {
      $group: {
        _id: { $dateToString: { format: dateFormatFor(groupBy), date: '$createdAt' } },
        sheets: { $sum: '$absQty' },
        value: { $sum: '$approxLineValue' },
        movements: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
    {
      $project: {
        _id: 0,
        period: '$_id',
        sheets: 1,
        value: { $round: ['$value', 2] },
        movements: 1,
      },
    },
  ];

  const data = await StockMovement.aggregate(pipeline);

  res.json({
    status: 'success',
    period: { from, to, groupBy },
    data,
  });
});

/**
 * GET /api/inventory/analytics/by-product
 * Per-product consumption breakdown with up/down/stable trend vs previous period.
 */
exports.byProduct = asyncHandler(async (req, res) => {
  const { from, to } = resolveRange(req.query);
  const limit = Math.min(parseInt(req.query.limit) || 20, 200);
  const prev = previousPeriod(from, to);

  // Aggregate both periods in parallel
  const aggregate = async (start, end) => StockMovement.aggregate([
    { $match: { movementType: 'DEDUCTION', createdAt: { $gte: start, $lte: end } } },
    { $lookup: { from: 'products', localField: 'product', foreignField: '_id', as: '_product' } },
    { $unwind: { path: '$_product', preserveNullAndEmptyArrays: true } },
    { $lookup: { from: 'productgrades', localField: '_product.grade', foreignField: '_id', as: '_grade' } },
    { $unwind: { path: '$_grade', preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: '$product',
        productId: { $first: '$product' },
        sku: { $first: '$_product.sku' },
        name: { $first: '$_product.name' },
        thicknessMM: { $first: '$_product.thicknessMM' },
        lengthFT: { $first: '$_product.lengthFT' },
        widthFT: { $first: '$_product.widthFT' },
        gradeLabel: { $first: '$_grade.label' },
        gradeCode: { $first: '$_grade.code' },
        basePrice: { $first: '$_product.basePrice' },
        areaSqFt: { $first: '$_product.areaSqFt' },
        totalSheetsConsumed: { $sum: { $abs: '$quantityChange' } },
        orderCount: { $sum: 1 },
        lastConsumedAt: { $max: '$createdAt' },
      },
    },
  ]);

  const [currentRows, previousRows] = await Promise.all([
    aggregate(from, to),
    aggregate(prev.from, prev.to),
  ]);

  const prevByProduct = new Map(previousRows.map(r => [String(r.productId), r.totalSheetsConsumed]));
  const grandTotal = currentRows.reduce((acc, r) => acc + r.totalSheetsConsumed, 0);

  const data = currentRows
    .map(r => {
      const prevQty = prevByProduct.get(String(r.productId)) || 0;
      let pctChange = null;
      if (prevQty === 0) {
        pctChange = r.totalSheetsConsumed > 0 ? 100 : 0;
      } else {
        pctChange = ((r.totalSheetsConsumed - prevQty) / prevQty) * 100;
      }
      return {
        productId: r.productId,
        sku: r.sku,
        name: r.name,
        sizeDisplay: r.lengthFT && r.widthFT ? `${r.lengthFT}x${r.widthFT}` : null,
        thicknessMM: r.thicknessMM,
        grade: r.gradeLabel || r.gradeCode || null,
        totalSheetsConsumed: r.totalSheetsConsumed,
        totalValue: +((r.basePrice || 0) * (r.areaSqFt || 1) * r.totalSheetsConsumed).toFixed(2),
        orderCount: r.orderCount,
        pctOfTotal: grandTotal > 0 ? +((r.totalSheetsConsumed / grandTotal) * 100).toFixed(2) : 0,
        pctChange: pctChange != null ? +pctChange.toFixed(2) : null,
        trend: trendFromPct(pctChange),
        lastConsumedAt: r.lastConsumedAt,
      };
    })
    .sort((a, b) => b.totalSheetsConsumed - a.totalSheetsConsumed)
    .slice(0, limit);

  res.json({
    status: 'success',
    period: { from, to },
    grandTotal,
    data,
  });
});

/**
 * GET /api/inventory/analytics/by-size
 * Groups consumption by thicknessMM + sheet size (LxW).
 */
exports.bySize = asyncHandler(async (req, res) => {
  const { from, to } = resolveRange(req.query);

  const pipeline = [
    { $match: { movementType: 'DEDUCTION', createdAt: { $gte: from, $lte: to } } },
    { $lookup: { from: 'products', localField: 'product', foreignField: '_id', as: '_product' } },
    { $unwind: { path: '$_product', preserveNullAndEmptyArrays: true } },
    {
      $group: {
        _id: {
          thicknessMM: '$_product.thicknessMM',
          length: '$_product.lengthFT',
          width: '$_product.widthFT',
        },
        sheets: { $sum: { $abs: '$quantityChange' } },
        orderCount: { $sum: 1 },
        productIds: { $addToSet: '$product' },
        productNames: { $addToSet: '$_product.name' },
      },
    },
    { $sort: { sheets: -1 } },
    {
      $project: {
        _id: 0,
        thicknessMM: '$_id.thicknessMM',
        sizeDisplay: {
          $cond: [
            { $and: ['$_id.length', '$_id.width'] },
            { $concat: [{ $toString: '$_id.length' }, 'x', { $toString: '$_id.width' }] },
            null,
          ],
        },
        sheets: 1,
        orderCount: 1,
        productCount: { $size: '$productIds' },
        productNames: 1,
      },
    },
  ];

  const data = await StockMovement.aggregate(pipeline);

  res.json({
    status: 'success',
    period: { from, to },
    data,
  });
});

/**
 * GET /api/inventory/analytics/by-grade
 * Consumption per grade, enumerating ALL grades (zero-consumption included).
 */
exports.byGrade = asyncHandler(async (req, res) => {
  const { from, to } = resolveRange(req.query);

  // 1. All active grades
  const grades = await ProductGrade.find({ isActive: true })
    .select('_id code label displayOrder')
    .sort({ displayOrder: 1 })
    .lean();

  // 2. Consumption grouped by product → grade
  const consumed = await StockMovement.aggregate([
    { $match: { movementType: 'DEDUCTION', createdAt: { $gte: from, $lte: to } } },
    { $lookup: { from: 'products', localField: 'product', foreignField: '_id', as: '_product' } },
    { $unwind: { path: '$_product', preserveNullAndEmptyArrays: true } },
    { $addFields: { absQty: { $abs: '$quantityChange' } } },
    {
      $group: {
        _id: '$_product.grade',
        sheets: { $sum: '$absQty' },
        value: {
          $sum: {
            $multiply: [
              '$absQty',
              { $ifNull: ['$_product.basePrice', 0] },
              { $ifNull: ['$_product.areaSqFt', 1] },
            ],
          },
        },
      },
    },
  ]);

  const byGradeId = new Map(consumed.map(r => [String(r._id), r]));
  const grandTotal = consumed.reduce((acc, r) => acc + r.sheets, 0);

  const data = grades.map(g => {
    const c = byGradeId.get(String(g._id));
    const sheets = c?.sheets || 0;
    const value = c?.value || 0;
    return {
      gradeId: g._id,
      code: g.code,
      label: g.label,
      sheets,
      value: +value.toFixed(2),
      pctOfTotal: grandTotal > 0 ? +((sheets / grandTotal) * 100).toFixed(2) : 0,
    };
  });

  res.json({
    status: 'success',
    period: { from, to },
    grandTotal,
    data,
  });
});

/**
 * GET /api/inventory/analytics/bundles
 * Bundle consumption tracking for PRE_CUT_BUNDLE products.
 */
exports.bundles = asyncHandler(async (req, res) => {
  const thirtyDaysAgo = new Date(Date.now() - 30 * MS_DAY);

  // Get all bundle products with stock > 0
  const products = await Product.find({
    productType: 'PRE_CUT_BUNDLE',
    isDeleted: false,
    $expr: {
      $gt: [
        { $add: [{ $ifNull: ['$bundle.currentBundles', 0] }, { $ifNull: ['$bundle.currentLoosePieces', 0] }] },
        0,
      ],
    },
  }).select('_id sku name bundle').lean();

  // Aggregate bundle consumption in last 30 days from StockMovement
  // (assumes bundle deductions are recorded via bundleQuantityChange field)
  const productIds = products.map(p => p._id);
  const consumed = await StockMovement.aggregate([
    {
      $match: {
        product: { $in: productIds },
        movementType: 'DEDUCTION',
        createdAt: { $gte: thirtyDaysAgo },
      },
    },
    {
      $group: {
        _id: '$product',
        bundlesBroken: { $sum: { $abs: { $ifNull: ['$bundleQuantityChange', 0] } } },
        piecesConsumed: { $sum: { $abs: '$quantityChange' } },
      },
    },
  ]);

  const consumedById = new Map(consumed.map(r => [String(r._id), r]));

  const data = products.map(p => {
    const c = consumedById.get(String(p._id));
    const bundlesBrokenLast30Days = c?.bundlesBroken || 0;
    const avgBundlesPerMonth = bundlesBrokenLast30Days; // same window for now
    const currentBundles = p.bundle?.currentBundles || 0;
    const projectedDepletion = (avgBundlesPerMonth > 0 && currentBundles > 0)
      ? new Date(Date.now() + (currentBundles / avgBundlesPerMonth) * 30 * MS_DAY)
      : null;
    return {
      productId: p._id,
      sku: p.sku,
      name: p.name,
      currentBundles,
      currentLoosePieces: p.bundle?.currentLoosePieces || 0,
      bundlesBrokenLast30Days,
      avgBundlesPerMonth,
      projectedDepletion,
    };
  });

  res.json({
    status: 'success',
    data,
  });
});

/**
 * GET /api/inventory/analytics/dashboard
 * Composite endpoint for admin dashboard widget. Cached 5 minutes.
 */
exports.dashboard = asyncHandler(async (req, res) => {
  const { from, to } = resolveRange(req.query);
  const cacheKey = `dashboard:${from.toISOString()}:${to.toISOString()}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    return res.json({ ...cached, cached: true });
  }

  const rangeDays = Math.max(1, Math.round((to - from) / MS_DAY));

  // ─── Parallel aggregations ───
  const [summaryRow, topProducts, weeklyRows, monthlyRows] = await Promise.all([
    // Summary
    StockMovement.aggregate([
      { $match: { movementType: 'DEDUCTION', createdAt: { $gte: from, $lte: to } } },
      { $lookup: { from: 'products', localField: 'product', foreignField: '_id', as: '_product' } },
      { $unwind: { path: '$_product', preserveNullAndEmptyArrays: true } },
      { $addFields: { absQty: { $abs: '$quantityChange' } } },
      {
        $group: {
          _id: null,
          totalSheetsConsumed: { $sum: '$absQty' },
          totalValue: {
            $sum: {
              $multiply: [
                '$absQty',
                { $ifNull: ['$_product.basePrice', 0] },
                { $ifNull: ['$_product.areaSqFt', 1] },
              ],
            },
          },
          orderCount: { $sum: 1 },
          uniqueProducts: { $addToSet: '$product' },
        },
      },
    ]),
    // Top-5 products
    StockMovement.aggregate([
      { $match: { movementType: 'DEDUCTION', createdAt: { $gte: from, $lte: to } } },
      { $lookup: { from: 'products', localField: 'product', foreignField: '_id', as: '_product' } },
      { $unwind: { path: '$_product', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: '$product',
          sku: { $first: '$_product.sku' },
          name: { $first: '$_product.name' },
          sheets: { $sum: { $abs: '$quantityChange' } },
        },
      },
      { $sort: { sheets: -1 } },
      { $limit: 5 },
      { $project: { _id: 0, productId: '$_id', sku: 1, name: 1, sheets: 1 } },
    ]),
    // This week vs last week
    StockMovement.aggregate([
      {
        $match: {
          movementType: 'DEDUCTION',
          createdAt: { $gte: new Date(Date.now() - 14 * MS_DAY) },
        },
      },
      {
        $project: {
          absQty: { $abs: '$quantityChange' },
          bucket: {
            $cond: [
              { $gte: ['$createdAt', new Date(Date.now() - 7 * MS_DAY)] },
              'thisWeek',
              'lastWeek',
            ],
          },
        },
      },
      { $group: { _id: '$bucket', sheets: { $sum: '$absQty' } } },
    ]),
    // Monthly trend — last 12 months
    StockMovement.aggregate([
      {
        $match: {
          movementType: 'DEDUCTION',
          createdAt: { $gte: new Date(Date.now() - 365 * MS_DAY) },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
          sheets: { $sum: { $abs: '$quantityChange' } },
        },
      },
      { $sort: { _id: 1 } },
    ]),
  ]);

  const summary = summaryRow[0] || { totalSheetsConsumed: 0, totalValue: 0, orderCount: 0, uniqueProducts: [] };
  const weeklyMap = Object.fromEntries(weeklyRows.map(r => [r._id, r.sheets]));
  const thisWeek = weeklyMap.thisWeek || 0;
  const lastWeek = weeklyMap.lastWeek || 0;
  const recentPctChange = lastWeek > 0 ? +(((thisWeek - lastWeek) / lastWeek) * 100).toFixed(2) : (thisWeek > 0 ? 100 : 0);

  // Fill in zero months for the last 12 months so the chart always has 12 buckets
  const monthlyByKey = new Map(monthlyRows.map(r => [r._id, r.sheets]));
  const monthlyTrend = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    monthlyTrend.push({ period: key, sheets: monthlyByKey.get(key) || 0 });
  }

  const payload = {
    status: 'success',
    period: { from, to },
    summary: {
      totalSheetsConsumed: summary.totalSheetsConsumed,
      totalValue: +summary.totalValue.toFixed(2),
      orderCount: summary.orderCount,
      uniqueProductsConsumed: summary.uniqueProducts.length,
      avgDailyConsumption: +(summary.totalSheetsConsumed / rangeDays).toFixed(2),
    },
    top5Products: topProducts,
    recentTrend: {
      thisWeek,
      lastWeek,
      pctChange: recentPctChange,
      trend: trendFromPct(recentPctChange),
    },
    monthlyTrend,
    cached: false,
  };

  cacheSet(cacheKey, payload);
  res.json(payload);
});
