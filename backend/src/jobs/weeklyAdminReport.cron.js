const cron = require('node-cron');
const logger = require('../config/logger');
const { Product, StockMovement, Purchase, Order, SystemSetting } = require('../models');
const emailService = require('../utils/emailService');

/**
 * Weekly Admin Report Cron (Prompt 8 Section F).
 *
 * Schedule: every Monday 8 AM. Compiles a consumption + business
 * summary and emails the admin recipient.
 *
 * Sections in the report:
 *   - This week's consumption (top 5 products by sheets)
 *   - Active PO count + total pending value
 *   - Forecast accuracy (avg MAPE across products that have a forecast)
 *   - Low-stock alerts (Product.currentStock <= minStockAlert)
 *   - Total revenue (sum of Order.totalAmount, this week)
 *
 * Skip rules:
 *   - DISABLE_CRONS / NODE_ENV=test
 *   - SystemSetting WEEKLY_REPORT_ENABLED=false
 *   - No recipient configured (logs warning, returns skipped)
 *
 * Mock mode: emailService handles this — if SMTP creds are PLACEHOLDER,
 * email is "sent" via the mock log entry. The cron doesn't care.
 */

const SCHEDULE = '0 8 * * 1'; // Monday 8 AM
const MS_DAY = 24 * 60 * 60 * 1000;
const ACTIVE_PO_STATUSES = ['DRAFT', 'ORDERED', 'PARTIAL_RECEIVED'];

function shouldSkipCron() {
  if (process.env.NODE_ENV === 'test') return true;
  if (String(process.env.DISABLE_CRONS).toLowerCase() === 'true') return true;
  return false;
}

async function resolveRecipient() {
  const explicit = await SystemSetting.getValue('WEEKLY_REPORT_RECIPIENT', '');
  if (explicit && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(explicit)) return explicit;
  const fallback = await SystemSetting.getValue('NOTIFICATION_ADMIN_ALERT_EMAIL', '');
  if (fallback && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fallback)) return fallback;
  // Last-ditch: process env EMAIL_FROM may have name <email> format; extract email
  const envFrom = (process.env.EMAIL_FROM || '').trim();
  const match = envFrom.match(/<([^>]+)>/) || envFrom.match(/([^\s@]+@[^\s@]+\.[^\s@]+)/);
  return match ? match[1] : null;
}

async function compileSummary() {
  const now = Date.now();
  const weekStart = new Date(now - 7 * MS_DAY);

  const [topProducts, poActive, mapeRow, lowStock, weekRevenue] = await Promise.all([
    // Top 5 products by sheets consumed this week
    StockMovement.aggregate([
      { $match: { movementType: 'DEDUCTION', createdAt: { $gte: weekStart } } },
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
    ]),
    // Active POs + value
    Purchase.aggregate([
      { $match: { status: { $in: ACTIVE_PO_STATUSES } } },
      {
        $group: {
          _id: null,
          count: { $sum: 1 },
          totalValue: { $sum: '$grandTotal' },
        },
      },
    ]),
    // Avg MAPE across products with a forecast
    Product.aggregate([
      { $match: { isActive: true, isDeleted: false, 'forecastData.lastForecast.mape': { $ne: null } } },
      {
        $group: {
          _id: null,
          avgMape: { $avg: '$forecastData.lastForecast.mape' },
          n: { $sum: 1 },
        },
      },
    ]),
    // Low-stock products
    Product.find({
      isActive: true,
      isDeleted: false,
      $expr: { $lte: ['$currentStock', '$minStockAlert'] },
    }).select('_id sku name currentStock minStockAlert').limit(20).lean(),
    // Revenue this week
    Order.aggregate([
      { $match: { createdAt: { $gte: weekStart }, isDeleted: { $ne: true } } },
      { $group: { _id: null, count: { $sum: 1 }, total: { $sum: '$totalAmount' } } },
    ]),
  ]);

  return {
    periodStart: weekStart,
    periodEnd: new Date(now),
    topProducts: topProducts.map(p => ({
      productId: p._id, sku: p.sku, name: p.name, sheets: p.sheets,
    })),
    activePOs: {
      count: poActive[0]?.count || 0,
      totalValue: +(poActive[0]?.totalValue || 0).toFixed(2),
    },
    forecastAccuracy: {
      avgMape: mapeRow[0]?.avgMape != null ? +mapeRow[0].avgMape.toFixed(2) : null,
      productCount: mapeRow[0]?.n || 0,
    },
    lowStockAlerts: lowStock.map(p => ({
      productId: p._id, sku: p.sku, name: p.name,
      currentStock: p.currentStock || 0, minStockAlert: p.minStockAlert || 0,
    })),
    revenueThisWeek: {
      orderCount: weekRevenue[0]?.count || 0,
      total: +(weekRevenue[0]?.total || 0).toFixed(2),
    },
  };
}

function formatReportAsText(s) {
  const fmtCurrency = (n) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
  const lines = [
    `Shree Gopal MDF — Weekly Admin Report`,
    `Period: ${s.periodStart.toDateString()} → ${s.periodEnd.toDateString()}`,
    ``,
    `═══ Top 5 Products (This Week) ═══`,
    ...(s.topProducts.length > 0
      ? s.topProducts.map((p, i) => `  ${i + 1}. ${p.sku} — ${p.name}: ${p.sheets} sheets`)
      : ['  (no consumption this week)']),
    ``,
    `═══ Active Purchase Orders ═══`,
    `  Count: ${s.activePOs.count}`,
    `  Pending value: ${fmtCurrency(s.activePOs.totalValue)}`,
    ``,
    `═══ Forecast Accuracy ═══`,
    s.forecastAccuracy.avgMape != null
      ? `  Avg MAPE: ${s.forecastAccuracy.avgMape}% across ${s.forecastAccuracy.productCount} product(s)`
      : `  No forecasts with measurable MAPE yet`,
    ``,
    `═══ Low Stock Alerts ═══`,
    ...(s.lowStockAlerts.length > 0
      ? s.lowStockAlerts.map(p => `  • ${p.sku} (${p.name}): ${p.currentStock} / threshold ${p.minStockAlert}`)
      : ['  (no products below threshold)']),
    ``,
    `═══ Revenue This Week ═══`,
    `  Orders: ${s.revenueThisWeek.orderCount}`,
    `  Total: ${fmtCurrency(s.revenueThisWeek.total)}`,
    ``,
    `--`,
    `Generated by automated weekly cron`,
  ];
  return lines.join('\n');
}

exports.weeklyAdminReportJob = async () => {
  const startedAt = new Date();
  const enabled = await SystemSetting.getValue('WEEKLY_REPORT_ENABLED', true);
  if (!enabled) {
    logger.info('[cron:weekly-report] skipped — WEEKLY_REPORT_ENABLED=false');
    return { skipped: true, reason: 'WEEKLY_REPORT_ENABLED=false', startedAt };
  }

  const recipient = await resolveRecipient();
  const summary = await compileSummary();
  const bodyText = formatReportAsText(summary);

  let emailResult = null;
  if (recipient) {
    try {
      emailResult = await emailService.sendAdminReportEmail({
        to: recipient,
        subject: `Weekly Admin Report — ${summary.periodEnd.toDateString()}`,
        bodyText,
      });
    } catch (err) {
      logger.error(`[cron:weekly-report] email send failed: ${err.message}`);
      emailResult = { success: false, error: err.message };
    }
  } else {
    logger.warn('[cron:weekly-report] no recipient configured — summary logged only');
  }

  const elapsedMs = Date.now() - startedAt.getTime();
  logger.info(`[cron:weekly-report] compiled + dispatched (recipient=${recipient || 'none'}) elapsedMs=${elapsedMs}`);

  return {
    startedAt,
    elapsedMs,
    recipient,
    summary,
    emailResult,
  };
};

let _task = null;

function register() {
  if (shouldSkipCron()) {
    logger.info('[cron:weekly-report] registration skipped (test mode or DISABLE_CRONS)');
    return null;
  }
  if (_task) return _task;
  _task = cron.schedule(SCHEDULE, async () => {
    try {
      await exports.weeklyAdminReportJob();
    } catch (err) {
      logger.error('[cron:weekly-report] tick failed:', err.message);
    }
  }, { scheduled: true });
  logger.info('[cron:weekly-report] registered — Monday 8 AM');
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
exports._compileSummary = compileSummary;
exports._formatReportAsText = formatReportAsText;
