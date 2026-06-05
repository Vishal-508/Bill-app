const cron = require('node-cron');
const logger = require('../config/logger');
const { Product, StockMovement, SystemSetting } = require('../models');
const sockets = require('../sockets');

/**
 * Daily Analytics Cron (Prompt 8 Section F).
 *
 * Schedule: every day at 11 PM (one hour before forecast cron at 2 AM).
 * For each active product, computes denormalized consumption stats and
 * updates Product.forecastData.{last30Days, last90Days, last365Days,
 * avgMonthly, avgWeekly, peakMonths, lastComputedAt}.
 *
 * Does NOT touch Product.forecastData.lastForecast — that field is owned
 * by dailyForecast.cron.js.
 *
 * peakMonths heuristic: aggregate DEDUCTION over last 365 days by
 * calendar month-of-year (1..12), compute mean, list months where the
 * sum is > 1.5 × mean. Result is short labels like "Oct", "Nov".
 */

const SCHEDULE = '0 23 * * *'; // daily 11 PM
const MS_DAY = 24 * 60 * 60 * 1000;
const PEAK_THRESHOLD = 1.5; // 1.5× the average month

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function shouldSkipCron() {
  if (process.env.NODE_ENV === 'test') return true;
  if (String(process.env.DISABLE_CRONS).toLowerCase() === 'true') return true;
  return false;
}

async function computeForProduct(productId, now) {
  const day30 = new Date(now - 30 * MS_DAY);
  const day90 = new Date(now - 90 * MS_DAY);
  const day365 = new Date(now - 365 * MS_DAY);

  // Single aggregation: 4 facets in parallel via $facet
  const rows = await StockMovement.aggregate([
    {
      $match: {
        product: productId,
        movementType: 'DEDUCTION',
        createdAt: { $gte: day365 },
      },
    },
    {
      $facet: {
        windowSums: [
          {
            $group: {
              _id: null,
              last365Days: { $sum: { $abs: '$quantityChange' } },
              last90Days: {
                $sum: {
                  $cond: [{ $gte: ['$createdAt', day90] }, { $abs: '$quantityChange' }, 0],
                },
              },
              last30Days: {
                $sum: {
                  $cond: [{ $gte: ['$createdAt', day30] }, { $abs: '$quantityChange' }, 0],
                },
              },
            },
          },
        ],
        byMonthOfYear: [
          {
            $group: {
              _id: { $month: '$createdAt' },
              sheets: { $sum: { $abs: '$quantityChange' } },
            },
          },
        ],
      },
    },
  ]);

  const sums = rows[0]?.windowSums[0] || { last30Days: 0, last90Days: 0, last365Days: 0 };
  const byMonth = rows[0]?.byMonthOfYear || [];

  const avgMonthly = +(sums.last365Days / 12).toFixed(2);
  // Avg per week from yearly: ~52.18 weeks/year
  const avgWeekly = +(sums.last365Days / 52.18).toFixed(2);

  // peakMonths: months where consumption > 1.5 × (avg across months that had any consumption)
  const presentMonths = byMonth.filter(m => m.sheets > 0);
  let peakMonths = [];
  if (presentMonths.length > 0) {
    const mean = presentMonths.reduce((s, m) => s + m.sheets, 0) / presentMonths.length;
    const threshold = mean * PEAK_THRESHOLD;
    peakMonths = byMonth
      .filter(m => m.sheets > threshold)
      .sort((a, b) => a._id - b._id)
      .map(m => MONTH_LABELS[m._id - 1]); // _id is 1..12
  }

  await Product.updateOne(
    { _id: productId },
    {
      $set: {
        'forecastData.last30Days': sums.last30Days,
        'forecastData.last90Days': sums.last90Days,
        'forecastData.last365Days': sums.last365Days,
        'forecastData.avgMonthly': avgMonthly,
        'forecastData.avgWeekly': avgWeekly,
        'forecastData.peakMonths': peakMonths,
        'forecastData.lastComputedAt': new Date(),
      },
    }
  );

  return {
    productId,
    last30Days: sums.last30Days,
    last90Days: sums.last90Days,
    last365Days: sums.last365Days,
    avgMonthly,
    avgWeekly,
    peakMonths,
  };
}

exports.dailyAnalyticsJob = async () => {
  const startedAt = new Date();
  const autoCompute = await SystemSetting.getValue('ANALYTICS_AUTO_COMPUTE', true);
  if (!autoCompute) {
    logger.info('[cron:analytics] skipped — ANALYTICS_AUTO_COMPUTE=false');
    return { skipped: true, reason: 'ANALYTICS_AUTO_COMPUTE=false', startedAt };
  }

  const products = await Product.find({ isActive: true, isDeleted: false })
    .select('_id sku').lean();

  const summary = {
    total: products.length,
    succeeded: 0,
    failed: 0,
    results: [],
    errors: [],
    startedAt,
  };

  for (const p of products) {
    try {
      const r = await computeForProduct(p._id, Date.now());
      summary.results.push(r);
      summary.succeeded++;
    } catch (err) {
      logger.error(`[cron:analytics] product ${p.sku || p._id} failed: ${err.message}`);
      summary.errors.push({ productId: p._id, sku: p.sku, error: err.message });
      summary.failed++;
    }
  }

  // ─── Low-stock detection + real-time broadcast (Prompt 9 Section B) ───
  // After analytics completes, scan for products at/below their alert
  // threshold and emit a single batched event. This is the only writer of
  // the inventory:low-stock socket event — keeps the surface small.
  try {
    const lowStock = await Product.find({
      isActive: true,
      isDeleted: false,
      $expr: { $lte: ['$currentStock', '$minStockAlert'] },
      minStockAlert: { $gt: 0 }, // skip products that opted out (threshold=0)
    })
      .select('_id sku name currentStock minStockAlert')
      .limit(50)
      .lean();
    if (lowStock.length > 0) {
      sockets.emitLowStock(lowStock);
      summary.lowStockCount = lowStock.length;
      logger.info(`[cron:analytics] low-stock alert: ${lowStock.length} product(s)`);
    } else {
      summary.lowStockCount = 0;
    }
  } catch (err) {
    logger.error(`[cron:analytics] low-stock detection failed: ${err.message}`);
    summary.lowStockCount = 0;
  }

  summary.finishedAt = new Date();
  summary.elapsedMs = summary.finishedAt - summary.startedAt;
  logger.info(
    `[cron:analytics] total=${summary.total} succeeded=${summary.succeeded} ` +
    `failed=${summary.failed} elapsedMs=${summary.elapsedMs}`
  );
  return summary;
};

let _task = null;

function register() {
  if (shouldSkipCron()) {
    logger.info('[cron:analytics] registration skipped (test mode or DISABLE_CRONS)');
    return null;
  }
  if (_task) return _task;
  _task = cron.schedule(SCHEDULE, async () => {
    try {
      await exports.dailyAnalyticsJob();
    } catch (err) {
      logger.error('[cron:analytics] tick failed:', err.message);
    }
  }, { scheduled: true });
  logger.info('[cron:analytics] registered — daily at 11 PM');
  return _task;
}

function stop() {
  if (_task) {
    _task.stop();
    _task = null;
  }
}

register();

exports.register = register;
exports.stop = stop;
exports._SCHEDULE = SCHEDULE;
exports._computeForProduct = computeForProduct;
