const asyncHandler = require('../utils/asyncHandler');
const whatsappService = require('../utils/whatsappService');
const emailService = require('../utils/emailService');
const retryService = require('../services/notificationRetry.service');

/**
 * GET /api/notifications/health
 * Combined health summary for WhatsApp + email channels.
 *
 * Status semantics:
 *   - ok       : both channels reachable (or mock — dev convenience)
 *   - degraded : exactly one channel is in error state
 *   - down     : both channels in error state
 */
exports.health = asyncHandler(async (req, res) => {
  const channels = { whatsapp: null, email: null };

  // WhatsApp
  if (whatsappService.isMockMode()) {
    channels.whatsapp = { status: 'mock', message: 'placeholder credentials' };
  } else {
    try {
      const r = await whatsappService.healthCheck();
      channels.whatsapp = { status: 'ok', ...r };
    } catch (err) {
      channels.whatsapp = { status: 'error', error: err.message };
    }
  }

  // Email
  if (emailService.isMockMode()) {
    channels.email = { status: 'mock', message: 'placeholder credentials' };
  } else {
    try {
      const r = await emailService.healthCheck();
      channels.email = { status: 'ok', ...r };
    } catch (err) {
      channels.email = { status: 'error', error: err.message };
    }
  }

  const errors = Object.values(channels).filter(c => c.status === 'error').length;
  let overall;
  if (errors === 0) overall = 'ok';
  else if (errors === 1) overall = 'degraded';
  else overall = 'down';

  res.status(overall === 'down' ? 503 : 200).json({
    status: 'success',
    overall,
    whatsapp: channels.whatsapp,
    email: channels.email,
  });
});

/**
 * POST /api/notifications/retry-now
 * Manual trigger for the retry cron — useful for admin debugging and for
 * smoke testing the retry logic without waiting 30 minutes.
 *
 * RBAC: ADMIN / SUPER_ADMIN (enforced in route).
 */
exports.retryNow = asyncHandler(async (req, res) => {
  const summary = await retryService.runOnce();
  res.json({ status: 'success', data: summary });
});
