const cron = require('node-cron');
const logger = require('../config/logger');
const forecastService = require('../services/forecast.service');
const { SystemSetting } = require('../models');

/**
 * Daily Forecast Cron (Prompt 8 Section F).
 *
 * Schedule: every day at 2 AM (server local time — production should
 * run in IST). Runs forecastAll() across all active products.
 *
 * Skip rules:
 *   - DISABLE_CRONS=true env (test/CI control)
 *   - NODE_ENV='test'
 *   - SystemSetting FORECAST_AUTO_RUN=false (admin runtime toggle)
 *
 * The cron callback is fully wrapped in try/catch — a failure here must
 * NEVER take down the backend.
 */

const SCHEDULE = '0 2 * * *'; // daily 2 AM

function shouldSkipCron() {
  if (process.env.NODE_ENV === 'test') return true;
  if (String(process.env.DISABLE_CRONS).toLowerCase() === 'true') return true;
  return false;
}

/**
 * Public: the actual cron work. Exported so tests + manual triggers can
 * invoke directly without going through the scheduler.
 */
exports.dailyForecastJob = async () => {
  const startedAt = new Date();
  const autoRun = await SystemSetting.getValue('FORECAST_AUTO_RUN', true);
  if (!autoRun) {
    logger.info('[cron:forecast] skipped — FORECAST_AUTO_RUN=false');
    return { skipped: true, reason: 'FORECAST_AUTO_RUN=false', startedAt };
  }

  const summary = await forecastService.forecastAll();
  const elapsedMs = Date.now() - startedAt.getTime();
  logger.info(
    `[cron:forecast] total=${summary.total} succeeded=${summary.succeeded} ` +
    `failed=${summary.failed} elapsedMs=${elapsedMs}`
  );
  if (summary.failed > 0) {
    for (const err of summary.errors) {
      logger.error(`[cron:forecast] product ${err.sku || err.productId}: ${err.error}`);
    }
  }
  return { ...summary, startedAt, elapsedMs };
};

// ─── Side-effect: register on import (unless skipped) ───
let _task = null;

function register() {
  if (shouldSkipCron()) {
    logger.info('[cron:forecast] registration skipped (test mode or DISABLE_CRONS)');
    return null;
  }
  if (_task) return _task;
  _task = cron.schedule(SCHEDULE, async () => {
    try {
      await exports.dailyForecastJob();
    } catch (err) {
      logger.error('[cron:forecast] tick failed:', err.message);
    }
  }, { scheduled: true });
  logger.info('[cron:forecast] registered — daily at 2 AM');
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
