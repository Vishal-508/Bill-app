const cron = require('node-cron');
const logger = require('../config/logger');
const retryService = require('../services/notificationRetry.service');

/**
 * Notification Retry Cron (Prompt 7 Section G).
 *
 * Schedule: every 30 minutes.
 *
 * Wrapping rules:
 *   1. ALL work happens inside try/catch — a cron tick must NEVER crash the
 *      backend.
 *   2. Skipped automatically if NODE_ENV=test OR DISABLE_CRONS=true so smoke
 *      tests stay deterministic.
 *   3. Honors SystemSetting NOTIFICATION_RETRY_ENABLED — checked inside the
 *      service (so the toggle is hot-reloadable without restart).
 */

let task = null;

function shouldRegister() {
  if (process.env.NODE_ENV === 'test') return false;
  if (String(process.env.DISABLE_CRONS).toLowerCase() === 'true') return false;
  return true;
}

async function tick() {
  try {
    const summary = await retryService.runOnce();
    logger.info(
      `[cron:retry] WA(${summary.whatsapp?.processed || 0}) ` +
      `email(${summary.email?.processed || 0}) ` +
      `alerts(${(summary.alerts?.whatsappCount || 0) + (summary.alerts?.emailCount || 0)}) ` +
      `${summary.elapsedMs}ms`
    );
  } catch (err) {
    logger.error('[cron:retry] tick failed:', err.message);
  }
}

function register() {
  if (!shouldRegister()) {
    logger.info('[cron:retry] registration skipped (test mode or DISABLE_CRONS)');
    return null;
  }
  if (task) {
    logger.warn('[cron:retry] already registered — skipping');
    return task;
  }
  // node-cron uses standard 5-field crontab — */30 means every 30 minutes.
  task = cron.schedule('*/30 * * * *', tick, { scheduled: true });
  logger.info('[cron:retry] registered — runs every 30 minutes');
  return task;
}

function stop() {
  if (task) {
    task.stop();
    task = null;
  }
}

// Side-effect registration on import. The boot import in server.js triggers
// this; tests that import the file directly can call stop() if needed.
register();

module.exports = { register, stop, tick };
