const mongoose = require('mongoose');
const nostradamus = require('nostradamus');
const { StockMovement, Product, SystemSetting } = require('../models');
const logger = require('../config/logger');

/**
 * Forecasting Service (Prompt 8 Section C).
 *
 * Computes demand forecasts from historical StockMovement DEDUCTION data
 * with method auto-selection by available history depth:
 *
 *   activity months >= 24 → Holt-Winters (nostradamus)  + MAPE backtest
 *   activity months >= 6  → Moving Average (last 3 months)
 *   activity months >= 1  → Naive (average of available)
 *   activity months == 0  → Fallback (predictions all zero)
 *
 * Holt-Winters may throw on degenerate inputs (all-zero series, NaN).
 * We catch and fall through to moving-average — see comments inline.
 *
 * Negative predictions are clamped to 0 (Holt-Winters can extrapolate
 * negative values for declining trends).
 *
 * MAPE = Mean Absolute Percentage Error. Computed via in-sample backtest:
 * train on data[:-6], predict next 6, compare to actual data[-6:].
 * Returns null when MAPE is not computable (all actuals zero).
 *
 * Updates Product.forecastData.lastForecast as a denormalized read-cache;
 * doesn't return raw nostradamus output for callers — that's the service's
 * internal detail. See [[prompt8_inventory_analytics_only]] memory.
 */

const MONTHS_HOLT_WINTERS = 24;
const MONTHS_MOVING_AVERAGE = 6;
const SEASONAL_PERIOD = 12;             // monthly data → annual seasonality
const MA_WINDOW = 3;                    // moving average uses last 3 months

// ─── SystemSettings accessor ───
// Read at call time (not import) so admins can tune without restarting.

async function getSettings() {
  const [autoRun, horizonMonths, alpha, beta, gamma] = await Promise.all([
    SystemSetting.getValue('FORECAST_AUTO_RUN', true),
    SystemSetting.getValue('FORECAST_HORIZON_MONTHS', 6),
    SystemSetting.getValue('FORECAST_HW_ALPHA', 0.5),
    SystemSetting.getValue('FORECAST_HW_BETA', 0.4),
    SystemSetting.getValue('FORECAST_HW_GAMMA', 0.6),
  ]);
  return {
    autoRun,
    horizonMonths: parseInt(horizonMonths, 10) || 6,
    alpha: parseFloat(alpha) || 0.5,
    beta: parseFloat(beta) || 0.4,
    gamma: parseFloat(gamma) || 0.6,
  };
}

// ─── Public: getMonthlyDemand ───

/**
 * Aggregate DEDUCTION movements grouped by year-month, with a continuous
 * filled series (no gaps — Holt-Winters needs contiguous samples).
 *
 * @param {string|ObjectId} productId
 * @param {number} months - Number of months back from "now" (default 24)
 * @returns {Promise<Array<{ year, month, sheets, period }>>}
 */
exports.getMonthlyDemand = async (productId, months = 24) => {
  const now = new Date();
  // Start of (now - months + 1) month — inclusive lower bound
  const startMonth = new Date(now.getFullYear(), now.getMonth() - months + 1, 1, 0, 0, 0, 0);

  const rows = await StockMovement.aggregate([
    {
      $match: {
        product: new mongoose.Types.ObjectId(productId),
        movementType: 'DEDUCTION',
        createdAt: { $gte: startMonth },
      },
    },
    {
      $group: {
        _id: {
          year: { $year: '$createdAt' },
          month: { $month: '$createdAt' },
        },
        sheets: { $sum: { $abs: '$quantityChange' } },
      },
    },
  ]);

  const byKey = new Map();
  for (const r of rows) {
    const key = `${r._id.year}-${String(r._id.month).padStart(2, '0')}`;
    byKey.set(key, r.sheets);
  }

  const series = [];
  for (let i = 0; i < months; i++) {
    const d = new Date(startMonth.getFullYear(), startMonth.getMonth() + i, 1);
    const year = d.getFullYear();
    const month = d.getMonth() + 1;
    const key = `${year}-${String(month).padStart(2, '0')}`;
    series.push({
      year,
      month,
      period: key,
      sheets: byKey.get(key) || 0,
    });
  }
  return series;
};

// ─── Helpers: forecast methods ───

/**
 * Average of the last `MA_WINDOW` months (or fewer if data is shorter).
 * Same value repeated for the horizon.
 */
exports.movingAverageForecast = (data, horizon) => {
  if (data.length === 0) return Array(horizon).fill(0);
  const window = data.slice(-Math.min(MA_WINDOW, data.length));
  const avg = window.reduce((s, n) => s + n, 0) / window.length;
  return Array(horizon).fill(Math.max(0, Math.round(avg)));
};

/**
 * Average of all data; same value for the horizon.
 * Used when data depth is too small for a moving window (1-5 months).
 */
exports.naiveForecast = (data, horizon) => {
  if (data.length === 0) return Array(horizon).fill(0);
  const avg = data.reduce((s, n) => s + n, 0) / data.length;
  return Array(horizon).fill(Math.max(0, Math.round(avg)));
};

/**
 * Mean Absolute Percentage Error.
 * For each (actual, predicted) pair: |actual - predicted| / actual × 100.
 * Skip pairs where actual=0 to avoid divide-by-zero. Returns null if
 * every actual is zero (no signal to measure error against).
 */
exports.calculateMAPE = (actual, predicted) => {
  if (!Array.isArray(actual) || !Array.isArray(predicted)) return null;
  const len = Math.min(actual.length, predicted.length);
  if (len === 0) return null;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < len; i++) {
    const a = actual[i];
    if (a === 0 || a == null) continue; // skip zero actuals
    const p = predicted[i] ?? 0;
    sum += Math.abs(a - p) / Math.abs(a);
    count++;
  }
  if (count === 0) return null;
  return +((sum / count) * 100).toFixed(2);
};

// ─── Internal: count months since first DEDUCTION for a product ───

async function getActivityMonths(productId) {
  const earliest = await StockMovement.findOne({
    product: productId,
    movementType: 'DEDUCTION',
  })
    .sort({ createdAt: 1 })
    .select('createdAt')
    .lean();
  if (!earliest) return 0;
  // Use CALENDAR-MONTH arithmetic (not 30-day approximation) so a movement
  // 60 days ago in May correctly counts April + May + June = 3 buckets.
  // The 30-day approximation would have undercounted to 2.
  const earliestDate = new Date(earliest.createdAt);
  const now = new Date();
  const monthDiff = (now.getFullYear() - earliestDate.getFullYear()) * 12 +
                    (now.getMonth() - earliestDate.getMonth()) + 1;
  return Math.max(1, monthDiff);
}

// ─── Internal: Holt-Winters wrapper ───

/**
 * Runs nostradamus on the series. On any error (degenerate input, NaN,
 * etc.), returns null so the caller can fall through to moving-average.
 *
 * IMPORTANT: nostradamus internally does Array(data.length / period) for
 * the seasonal-indices array. If data.length is not a multiple of period,
 * that Array(float) call throws RangeError("Invalid array length"). We
 * trim from the LEFT (drop oldest entries) so the predicted horizon still
 * aligns with the most-recent data — same for backtest alignment.
 */
function tryHoltWinters(data, alpha, beta, gamma, horizon) {
  const trimmedLen = Math.floor(data.length / SEASONAL_PERIOD) * SEASONAL_PERIOD;
  if (trimmedLen < SEASONAL_PERIOD * 2) return null; // need >= 2 seasons
  const trimmed = trimmedLen === data.length ? data : data.slice(-trimmedLen);
  try {
    const fitted = nostradamus(trimmed, alpha, beta, gamma, SEASONAL_PERIOD, horizon);
    if (!Array.isArray(fitted) || fitted.length < horizon) return null;
    const preds = fitted.slice(-horizon);
    if (preds.some(v => !Number.isFinite(v))) return null;
    return preds.map(p => Math.max(0, Math.round(p)));
  } catch (err) {
    logger.debug(`Holt-Winters threw, will fall back: ${err.message}`);
    return null;
  }
}

/**
 * In-sample backtest MAPE: train on data[:-horizon], forecast horizon
 * steps, compare to actual last `horizon` months. Returns null if either
 * the training set is too short or the MAPE is undefined.
 */
function backtestMape(data, alpha, beta, gamma, horizon) {
  if (data.length < SEASONAL_PERIOD * 2 + horizon) return null; // need enough train
  const train = data.slice(0, -horizon);
  const actual = data.slice(-horizon);
  const predicted = tryHoltWinters(train, alpha, beta, gamma, horizon);
  if (!predicted) return null;
  return exports.calculateMAPE(actual, predicted);
}

// ─── Public: forecastProduct ───

/**
 * @param {string|ObjectId} productId
 * @param {number} [horizonMonths] - override settings.horizonMonths
 * @returns {Promise<Object>} forecast result
 */
exports.forecastProduct = async (productId, horizonMonths = null) => {
  const settings = await getSettings();
  const horizon = horizonMonths || settings.horizonMonths;

  const activityMonths = await getActivityMonths(productId);

  // Fetch enough historical samples for the chosen method.
  // - Holt-Winters: TRUNCATE down to a multiple of SEASONAL_PERIOD from the
  //   most-recent end. Padding with leading zeros (which is what max(36,X)
  //   would do when activityMonths<36) pollutes seasonal indices and
  //   collapses the forecast. Better to use the last N*12 months of real
  //   data and let nostradamus see a clean signal.
  // - MA + Naive: fetch exactly activityMonths so no padding zeros enter
  //   the average. Padded zeros would drag the result toward 0.
  let monthsToFetch;
  if (activityMonths >= MONTHS_HOLT_WINTERS) {
    monthsToFetch = Math.max(SEASONAL_PERIOD * 2,
      Math.floor(activityMonths / SEASONAL_PERIOD) * SEASONAL_PERIOD);
  } else if (activityMonths >= MONTHS_MOVING_AVERAGE) {
    monthsToFetch = activityMonths;
  } else {
    monthsToFetch = activityMonths || 1;
  }

  const series = await exports.getMonthlyDemand(productId, monthsToFetch);
  const data = series.map(d => d.sheets);

  let method;
  let predictions;
  let mape = null;

  if (activityMonths === 0) {
    method = 'fallback';
    predictions = Array(horizon).fill(0);
  } else if (activityMonths >= MONTHS_HOLT_WINTERS) {
    const hw = tryHoltWinters(data, settings.alpha, settings.beta, settings.gamma, horizon);
    if (hw) {
      method = 'holt-winters';
      predictions = hw;
      mape = backtestMape(data, settings.alpha, settings.beta, settings.gamma, horizon);
    } else {
      // Holt-Winters degenerate; fall through to MA
      method = 'moving-average';
      predictions = exports.movingAverageForecast(data, horizon);
    }
  } else if (activityMonths >= MONTHS_MOVING_AVERAGE) {
    method = 'moving-average';
    predictions = exports.movingAverageForecast(data, horizon);
  } else {
    method = 'naive';
    predictions = exports.naiveForecast(data, horizon);
  }

  // ─── Update Product.forecastData.lastForecast (denormalized cache) ───
  const next30 = predictions[0] || 0;
  const next90 = (predictions[0] || 0) + (predictions[1] || 0) + (predictions[2] || 0);
  const next180 = predictions.reduce((s, n) => s + (n || 0), 0);

  const computedAt = new Date();
  try {
    await Product.updateOne(
      { _id: productId },
      {
        $set: {
          'forecastData.lastForecast': {
            next30days: Math.round(next30),
            next90days: Math.round(next90),
            next180days: Math.round(next180),
            method,
            mape,
            computedAt,
          },
          'forecastData.lastComputedAt': computedAt,
        },
      }
    );
  } catch (err) {
    logger.error(`forecast: Product.updateOne failed for ${productId}: ${err.message}`);
  }

  const product = await Product.findById(productId).select('sku name').lean();

  return {
    productId,
    sku: product?.sku,
    name: product?.name,
    method,
    predictions,
    mape,
    historicalSeries: series,
    horizonMonths: horizon,
    computedAt,
  };
};

// ─── Public: forecastAll ───

/**
 * Run forecast for every active, non-deleted product sequentially.
 * Per-product errors are captured into `errors[]` so one bad product
 * doesn't kill the batch.
 */
exports.forecastAll = async () => {
  const products = await Product.find({
    isActive: true,
    isDeleted: false,
  })
    .select('_id sku')
    .lean();

  const summary = {
    total: products.length,
    succeeded: 0,
    failed: 0,
    results: [],
    errors: [],
    startedAt: new Date(),
  };

  for (const p of products) {
    try {
      const r = await exports.forecastProduct(p._id);
      summary.results.push({
        productId: r.productId,
        sku: r.sku,
        method: r.method,
        next30days: r.predictions[0] || 0,
        next90days: (r.predictions[0] || 0) + (r.predictions[1] || 0) + (r.predictions[2] || 0),
        mape: r.mape,
      });
      summary.succeeded++;
    } catch (err) {
      logger.error(`forecastAll: ${p.sku || p._id} failed: ${err.message}`);
      summary.errors.push({ productId: p._id, sku: p.sku, error: err.message });
      summary.failed++;
    }
  }

  summary.finishedAt = new Date();
  summary.elapsedMs = summary.finishedAt - summary.startedAt;
  return summary;
};

// ─── For tests + manual control ───
exports._constants = {
  MONTHS_HOLT_WINTERS,
  MONTHS_MOVING_AVERAGE,
  SEASONAL_PERIOD,
  MA_WINDOW,
};
exports._getSettings = getSettings;
exports._getActivityMonths = getActivityMonths;
exports._tryHoltWinters = tryHoltWinters;
exports._backtestMape = backtestMape;
