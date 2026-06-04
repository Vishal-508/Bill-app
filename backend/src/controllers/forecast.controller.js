const mongoose = require('mongoose');
const { Product, SystemSetting } = require('../models');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const forecastService = require('../services/forecast.service');

/**
 * Forecast HTTP layer (Prompt 8 Section D).
 *
 * Routes:
 *   POST /api/forecast/run/:productId   (ADMIN)   trigger single
 *   POST /api/forecast/run-all          (ADMIN)   batch all, rate-limited
 *   GET  /api/forecast/health           (ADMIN)   service health widget
 *   GET  /api/forecast/:productId       (staff)   read cached + live history
 *   GET  /api/forecast                  (staff)   summary list with pagination
 *
 * Route order matters — literals must be registered before `/:productId`.
 * See routes/forecast.routes.js for the order guarantee.
 */

const STALE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const HISTORY_MONTHS_FOR_DETAIL = 12;
const RUN_ALL_RATE_LIMIT_MS = 5 * 60 * 1000; // 1 call / 5 min / user

// ─── In-memory rate-limit state ───
// Single-process, clears on restart. Acceptable for MVP (cron drives the
// actual batch work; this endpoint is admin-debug). For multi-instance,
// move to Redis later.
const _rateLimit = new Map();

function checkRateLimit(userId, key, windowMs) {
  const mapKey = `${userId}:${key}`;
  const last = _rateLimit.get(mapKey);
  const now = Date.now();
  if (last && now - last < windowMs) {
    const retryAfter = Math.ceil((windowMs - (now - last)) / 1000);
    return { allowed: false, retryAfter };
  }
  _rateLimit.set(mapKey, now);
  return { allowed: true };
}

exports._clearRateLimits = () => _rateLimit.clear(); // for tests

// ─── Shared helpers ───

function isStale(computedAt) {
  if (!computedAt) return true;
  return Date.now() - new Date(computedAt).getTime() > STALE_THRESHOLD_MS;
}

function asBool(v) {
  if (v === true || v === 'true') return true;
  if (v === false || v === 'false') return false;
  return undefined;
}

// ─── POST /api/forecast/run/:productId ───

exports.runOne = asyncHandler(async (req, res) => {
  const { productId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(productId)) {
    throw ApiError.badRequest('Invalid product ID');
  }
  const product = await Product.findById(productId)
    .select('_id sku name isActive isDeleted').lean();
  if (!product) throw ApiError.notFound('Product not found');
  if (product.isDeleted) {
    throw ApiError.badRequest('Cannot forecast a deleted product');
  }
  if (!product.isActive) {
    throw ApiError.badRequest('Cannot forecast an inactive product');
  }

  const result = await forecastService.forecastProduct(productId);
  res.json({ status: 'success', data: result });
});

// ─── POST /api/forecast/run-all ───

exports.runAll = asyncHandler(async (req, res) => {
  const rate = checkRateLimit(req.user._id, 'run-all', RUN_ALL_RATE_LIMIT_MS);
  if (!rate.allowed) {
    res.set('Retry-After', String(rate.retryAfter));
    return res.status(429).json({
      status: 'error',
      message: 'Rate limit: only 1 batch forecast per 5 minutes per user',
      retryAfter: rate.retryAfter,
    });
  }

  const summary = await forecastService.forecastAll();
  res.status(202).json({ status: 'success', data: summary });
});

// ─── GET /api/forecast/health ───

exports.health = asyncHandler(async (req, res) => {
  let nostradamusInstalled = false;
  try {
    const lib = require('nostradamus');
    nostradamusInstalled = typeof lib === 'function';
  } catch {
    nostradamusInstalled = false;
  }

  // Tally totals + last run + avg MAPE
  const [counts, settings] = await Promise.all([
    Product.aggregate([
      { $match: { isActive: true, isDeleted: false } },
      {
        $group: {
          _id: null,
          totalProducts: { $sum: 1 },
          withForecast: {
            $sum: { $cond: ['$forecastData.lastForecast.computedAt', 1, 0] },
          },
          lastRunAt: { $max: '$forecastData.lastForecast.computedAt' },
          stale: {
            $sum: {
              $cond: [
                {
                  $and: [
                    '$forecastData.lastForecast.computedAt',
                    { $lt: ['$forecastData.lastForecast.computedAt', new Date(Date.now() - STALE_THRESHOLD_MS)] },
                  ],
                },
                1, 0,
              ],
            },
          },
          mapeSum: {
            $sum: { $ifNull: ['$forecastData.lastForecast.mape', 0] },
          },
          mapeCount: {
            $sum: {
              $cond: [{ $ne: ['$forecastData.lastForecast.mape', null] }, 1, 0],
            },
          },
        },
      },
    ]),
    forecastService._getSettings(),
  ]);

  const c = counts[0] || { totalProducts: 0, withForecast: 0, stale: 0, mapeSum: 0, mapeCount: 0, lastRunAt: null };
  const avgMape = c.mapeCount > 0 ? +(c.mapeSum / c.mapeCount).toFixed(2) : null;

  let status;
  if (c.withForecast === 0) status = 'no-data';
  else if (c.totalProducts > 0 && c.stale / c.totalProducts > 0.5) status = 'degraded';
  else status = 'ok';

  res.json({
    status: 'success',
    data: {
      status,
      nostradamusInstalled,
      totalProducts: c.totalProducts,
      withForecast: c.withForecast,
      neverForecasted: c.totalProducts - c.withForecast,
      staleCount: c.stale,
      lastRunAt: c.lastRunAt,
      avgMapeAcrossActive: avgMape,
      settings: {
        autoRunEnabled: settings.autoRun,
        horizonMonths: settings.horizonMonths,
        hwAlpha: settings.alpha,
        hwBeta: settings.beta,
        hwGamma: settings.gamma,
      },
    },
  });
});

// ─── GET /api/forecast/:productId ───

exports.getOne = asyncHandler(async (req, res) => {
  const { productId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(productId)) {
    throw ApiError.badRequest('Invalid product ID');
  }
  const product = await Product.findById(productId)
    .select('_id sku name forecastData isActive isDeleted').lean();
  if (!product) throw ApiError.notFound('Product not found');

  const lastForecast = product.forecastData?.lastForecast || null;
  // Live-computed history series for the detail view (last 12 months)
  const historicalSeries = await forecastService.getMonthlyDemand(productId, HISTORY_MONTHS_FOR_DETAIL);

  res.json({
    status: 'success',
    data: {
      productId: product._id,
      sku: product.sku,
      name: product.name,
      lastForecast: lastForecast && lastForecast.computedAt ? lastForecast : null,
      isStale: isStale(lastForecast?.computedAt),
      historicalSeries,
    },
  });
});

// ─── GET /api/forecast (summary list) ───

exports.list = asyncHandler(async (req, res) => {
  const q = req.query;
  const page = parseInt(q.page) || 1;
  const limit = Math.min(parseInt(q.limit) || 20, 200);
  const skip = (page - 1) * limit;
  const sortBy = q.sortBy || 'next30days';
  const sortOrder = q.sortOrder === 'asc' ? 1 : -1;
  const methodFilter = q.method;
  const isStaleFilter = asBool(q.isStale);
  const includeNoForecast = asBool(q.includeNoForecast) || false;

  const baseMatch = { isActive: true, isDeleted: false };

  // Build filter for the page slice
  const filter = { ...baseMatch };
  if (!includeNoForecast) {
    filter['forecastData.lastForecast.computedAt'] = { $exists: true, $ne: null };
  }
  if (methodFilter) {
    filter['forecastData.lastForecast.method'] = methodFilter;
  }
  if (isStaleFilter === true) {
    filter['forecastData.lastForecast.computedAt'] = {
      ...(filter['forecastData.lastForecast.computedAt'] || {}),
      $lt: new Date(Date.now() - STALE_THRESHOLD_MS),
    };
  } else if (isStaleFilter === false) {
    filter['forecastData.lastForecast.computedAt'] = {
      ...(filter['forecastData.lastForecast.computedAt'] || {}),
      $gte: new Date(Date.now() - STALE_THRESHOLD_MS),
    };
  }

  // Sort key path
  const sortPath = {
    next30days: 'forecastData.lastForecast.next30days',
    mape: 'forecastData.lastForecast.mape',
    computedAt: 'forecastData.lastForecast.computedAt',
    name: 'name',
  }[sortBy] || 'forecastData.lastForecast.next30days';

  const [pageDocs, total, summaryRows] = await Promise.all([
    Product.find(filter)
      .select('_id sku name forecastData')
      .sort({ [sortPath]: sortOrder })
      .skip(skip).limit(limit)
      .lean(),
    Product.countDocuments(filter),
    // Summary is over the full active product set, ignoring page filter
    Product.aggregate([
      { $match: baseMatch },
      {
        $group: {
          _id: null,
          totalProducts: { $sum: 1 },
          withForecast: { $sum: { $cond: ['$forecastData.lastForecast.computedAt', 1, 0] } },
          stale: {
            $sum: {
              $cond: [
                {
                  $and: [
                    '$forecastData.lastForecast.computedAt',
                    { $lt: ['$forecastData.lastForecast.computedAt', new Date(Date.now() - STALE_THRESHOLD_MS)] },
                  ],
                },
                1, 0,
              ],
            },
          },
          mapeSum: { $sum: { $ifNull: ['$forecastData.lastForecast.mape', 0] } },
          mapeCount: {
            $sum: { $cond: [{ $ne: ['$forecastData.lastForecast.mape', null] }, 1, 0] },
          },
          methods: { $push: '$forecastData.lastForecast.method' },
        },
      },
    ]),
  ]);

  const data = pageDocs.map(p => ({
    productId: p._id,
    sku: p.sku,
    name: p.name,
    lastForecast: p.forecastData?.lastForecast?.computedAt ? p.forecastData.lastForecast : null,
    isStale: isStale(p.forecastData?.lastForecast?.computedAt),
  }));

  const sRow = summaryRows[0] || { totalProducts: 0, withForecast: 0, stale: 0, mapeSum: 0, mapeCount: 0, methods: [] };
  const byMethod = {};
  for (const m of sRow.methods) {
    if (!m) continue;
    byMethod[m] = (byMethod[m] || 0) + 1;
  }
  const avgMape = sRow.mapeCount > 0 ? +(sRow.mapeSum / sRow.mapeCount).toFixed(2) : null;

  res.json({
    status: 'success',
    data,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
    summary: {
      totalProducts: sRow.totalProducts,
      withForecast: sRow.withForecast,
      neverForecasted: sRow.totalProducts - sRow.withForecast,
      staleCount: sRow.stale,
      byMethod,
      avgMape,
    },
  });
});
