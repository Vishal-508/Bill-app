const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');

const forecastCron = require('../jobs/dailyForecast.cron');
const analyticsCron = require('../jobs/dailyAnalytics.cron');
const weeklyReportCron = require('../jobs/weeklyAdminReport.cron');

/**
 * Manual cron triggers (Prompt 8 Section F).
 *
 * RBAC: SUPER_ADMIN only — admin debug surface, can do meaningful work
 * (full forecast/analytics passes). Rate-limited to 1 call per minute
 * per user per endpoint.
 */

const RATE_LIMIT_MS = 60 * 1000;
const _rateLimit = new Map();

function checkRateLimit(userId, key) {
  const mapKey = `${userId}:${key}`;
  const last = _rateLimit.get(mapKey);
  const now = Date.now();
  if (last && now - last < RATE_LIMIT_MS) {
    const retryAfter = Math.ceil((RATE_LIMIT_MS - (now - last)) / 1000);
    return { allowed: false, retryAfter };
  }
  _rateLimit.set(mapKey, now);
  return { allowed: true };
}

exports._clearRateLimits = () => _rateLimit.clear();

function buildHandler(key, fn) {
  return asyncHandler(async (req, res) => {
    const rate = checkRateLimit(req.user._id, key);
    if (!rate.allowed) {
      res.set('Retry-After', String(rate.retryAfter));
      return res.status(429).json({
        status: 'error',
        message: `Rate limit: max 1 call per minute for ${key}`,
        retryAfter: rate.retryAfter,
      });
    }
    const result = await fn();
    res.json({ status: 'success', data: result });
  });
}

exports.runForecast = buildHandler('forecast', forecastCron.dailyForecastJob);
exports.runAnalytics = buildHandler('analytics', analyticsCron.dailyAnalyticsJob);
exports.runWeeklyReport = buildHandler('weekly-report', weeklyReportCron.weeklyAdminReportJob);
