const mongoose = require('mongoose');
const razorpayService = require('../utils/razorpayService');
const webhookHandler = require('../utils/webhookHandler');
const { WebhookEvent } = require('../models');
const logger = require('../config/logger');

/**
 * POST /api/webhooks/razorpay
 *
 * SECURITY:
 *   - No authentication (webhook IS auth via signature)
 *   - Verifies HMAC SHA256 with webhook secret
 *   - Returns 200 OK to Razorpay even on processing errors
 *     (prevents Razorpay from retrying indefinitely)
 */
exports.handleRazorpay = async (req, res) => {
  const startTime = Date.now();
  const signature = req.headers['x-razorpay-signature'];
  const sourceIp = req.ip || req.connection?.remoteAddress;

  // Raw body preserved by route-level express.raw() in server.js (before express.json).
  // When express.raw runs, req.body is a Buffer (not parsed JSON).
  let rawBody;
  let parsedEvent;

  if (Buffer.isBuffer(req.body)) {
    rawBody = req.body.toString('utf8');
    try {
      parsedEvent = JSON.parse(rawBody);
    } catch (err) {
      logger.error('Invalid JSON in webhook body:', err.message);
      return res.status(400).json({ status: 'error', message: 'Invalid JSON' });
    }
  } else {
    // Fallback if middleware order ever drifts (or a test bypasses raw middleware).
    rawBody = JSON.stringify(req.body);
    parsedEvent = req.body;
    logger.warn('Webhook received without raw body — middleware order issue?');
  }

  const signatureValid = razorpayService.verifyWebhookSignature(rawBody, signature);

  if (!signatureValid) {
    logger.error(`Invalid webhook signature from IP: ${sourceIp}`);

    try {
      await WebhookEvent.create({
        razorpayEventId: `invalid_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        eventType: parsedEvent?.event || 'unknown',
        status: 'INVALID_SIGNATURE',
        signatureValid: false,
        signatureProvided: signature?.slice(0, 20) + '...',
        payload: parsedEvent || {},
        sourceIp,
        userAgent: req.headers['user-agent'],
      });
    } catch (err) {
      logger.error('Failed to log invalid signature attempt:', err);
    }

    return res.status(400).json({ status: 'error', message: 'Invalid signature' });
  }

  try {
    const result = await webhookHandler.processWebhookEvent(parsedEvent, rawBody);

    logger.info(`Webhook processed: ${parsedEvent.event} in ${Date.now() - startTime}ms`);

    return res.status(200).json({
      status: 'success',
      eventId: result.eventId,
      processingStatus: result.status,
    });
  } catch (err) {
    logger.error('Webhook processing error:', err);

    return res.status(200).json({
      status: 'success',
      message: 'Event received (processing logged)',
    });
  }
};

/**
 * GET /api/webhooks/events
 */
exports.listEvents = async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  const status = req.query.status;
  const eventType = req.query.eventType;

  const filter = {};
  if (status) filter.status = status;
  if (eventType) filter.eventType = eventType;

  const events = await WebhookEvent.find(filter)
    .sort({ receivedAt: -1 })
    .limit(limit)
    .select('-payload -signatureProvided')
    .lean();

  res.json({ status: 'success', count: events.length, data: events });
};

/**
 * GET /api/webhooks/events/:id
 */
exports.getEvent = async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ status: 'error', message: 'Invalid event ID' });
  }

  const event = await WebhookEvent.findById(req.params.id);
  if (!event) {
    return res.status(404).json({ status: 'error', message: 'Event not found' });
  }

  res.json({ status: 'success', data: event });
};
