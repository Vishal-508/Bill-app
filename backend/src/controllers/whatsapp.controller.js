const mongoose = require('mongoose');
const { WhatsAppLog, Bill, Order, Customer, SystemSetting } = require('../models');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const whatsappService = require('../utils/whatsappService');
const logger = require('../config/logger');

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────

const IDEMPOTENCY_WINDOW_MS = 60 * 1000; // 60s
const TWENTYFOUR_HOURS_MS = 24 * 60 * 60 * 1000;

/**
 * Throw 403 if WHATSAPP_ENABLED is off in SystemSettings.
 */
async function assertWhatsAppEnabled() {
  const enabled = await SystemSetting.getValue('WHATSAPP_ENABLED', true);
  if (!enabled) {
    throw ApiError.forbidden('WhatsApp notifications are disabled in system settings');
  }
}

/**
 * Throw 409 if a successful log of the same (type, relatedX, customer)
 * was created within the idempotency window.
 */
async function assertNotRecentlySent({ type, relatedBill, relatedOrder, customer }) {
  const since = new Date(Date.now() - IDEMPOTENCY_WINDOW_MS);
  const filter = {
    type,
    customer,
    createdAt: { $gte: since },
    status: { $nin: ['FAILED', 'PERMANENTLY_FAILED'] },
  };
  if (relatedBill) filter.relatedBill = relatedBill;
  if (relatedOrder) filter.relatedOrder = relatedOrder;

  const recent = await WhatsAppLog.findOne(filter).select('_id waMessageId createdAt').lean();
  if (recent) {
    throw ApiError.conflict(
      `Already sent within last 60s (logId: ${recent._id}, waMessageId: ${recent.waMessageId})`
    );
  }
}

/**
 * Wrap a service call: send, log success or failure, return uniform shape.
 */
async function sendAndLog({ type, sendFn, sendFnName, sendArgs, customer, relatedBill, relatedOrder, templateName, sentBy }) {
  let response = null;
  let waMessageId = null;
  let status = 'SENT';
  let errorCode;
  let errorMessage;

  try {
    response = await sendFn(sendArgs);
    waMessageId = response?.messages?.[0]?.id;
  } catch (err) {
    status = 'FAILED';
    errorCode = err.code != null ? String(err.code) : 'SEND_FAILED';
    errorMessage = err.message;
    logger.error(`WA send (${type}) failed:`, err.message);
  }

  const log = await WhatsAppLog.create({
    to: whatsappService.formatPhone(customer.phone),
    customer: customer._id,
    type,
    templateName,
    waMessageId,
    payload: response,
    status,
    errorCode,
    errorMessage,
    relatedBill,
    relatedOrder,
    isMock: whatsappService.isMockMode(),
    sentBy,
    retryContext: sendFnName ? { sendFn: sendFnName, args: sendArgs } : undefined,
  });

  return { log, status, response };
}

// ─────────────────────────────────────────────────────────
// Endpoints
// ─────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────
// Log + health endpoints (Section F)
// ─────────────────────────────────────────────────────────

/**
 * Shared helper: build a MongoDB filter from log-query params.
 * Caller is responsible for which type/status enum is enforced
 * (validator already does that).
 */
function buildLogFilter(q) {
  const filter = {};
  if (q.type && q.type !== 'all') filter.type = q.type;
  if (q.status && q.status !== 'all') filter.status = q.status;
  if (q.customer) filter.customer = q.customer;
  if (q.relatedBill) filter.relatedBill = q.relatedBill;
  if (q.relatedOrder) filter.relatedOrder = q.relatedOrder;

  if (q.dateFrom || q.dateTo) {
    filter.createdAt = {};
    if (q.dateFrom) filter.createdAt.$gte = new Date(q.dateFrom);
    if (q.dateTo) filter.createdAt.$lte = new Date(q.dateTo);
  }

  if (q.search && q.search.length > 0) {
    const safe = q.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [
      { to: { $regex: safe, $options: 'i' } },
      { 'payload.text.body': { $regex: safe, $options: 'i' } },
    ];
  }
  return filter;
}

/**
 * GET /api/whatsapp/logs
 */
exports.listLogs = asyncHandler(async (req, res) => {
  const q = req.query;
  const page = parseInt(q.page) || 1;
  const limit = Math.min(parseInt(q.limit) || 20, 100);
  const skip = (page - 1) * limit;

  const filter = buildLogFilter(q);

  const [data, total] = await Promise.all([
    WhatsAppLog.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('customer', 'customerName phone companyName')
      .lean(),
    WhatsAppLog.countDocuments(filter),
  ]);

  res.json({
    status: 'success',
    data,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  });
});

/**
 * GET /api/whatsapp/logs/stats
 * Returns aggregate counts. Registered BEFORE /logs/:id so 'stats' isn't
 * caught as an ObjectId param.
 */
exports.statsLogs = asyncHandler(async (req, res) => {
  const now = new Date();
  const dayAgo = new Date(now - 24 * 60 * 60 * 1000);
  const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);

  const [byType, byStatus, last24h, last7d, total] = await Promise.all([
    WhatsAppLog.aggregate([{ $group: { _id: '$type', count: { $sum: 1 } } }]),
    WhatsAppLog.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    WhatsAppLog.countDocuments({ createdAt: { $gte: dayAgo } }),
    WhatsAppLog.countDocuments({ createdAt: { $gte: weekAgo } }),
    WhatsAppLog.countDocuments({}),
  ]);

  const toRecord = (arr) => arr.reduce((acc, r) => { acc[r._id || 'UNKNOWN'] = r.count; return acc; }, {});
  res.json({
    status: 'success',
    data: {
      byType: toRecord(byType),
      byStatus: toRecord(byStatus),
      last24h,
      last7d,
      total,
    },
  });
});

/**
 * GET /api/whatsapp/logs/:id
 */
exports.getLog = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw ApiError.badRequest('Invalid log ID');
  }
  const log = await WhatsAppLog.findById(req.params.id)
    .populate('customer', 'customerName phone companyName email')
    .populate('relatedBill', 'billNumber grandTotal')
    .populate('relatedOrder', 'orderNumber status totalAmount')
    .lean();
  if (!log) throw ApiError.notFound('Log not found');
  res.json({ status: 'success', data: log });
});

/**
 * GET /api/whatsapp/health
 * Mock mode: returns { status: 'mock', message }.
 * Live mode: calls Meta Graph API /me to validate token.
 */
exports.health = asyncHandler(async (req, res) => {
  if (whatsappService.isMockMode()) {
    return res.json({
      status: 'mock',
      message: 'WA service in mock mode (placeholder credentials)',
      phoneNumberId: process.env.WA_PHONE_ID?.trim() || null,
    });
  }

  try {
    const result = await whatsappService.healthCheck();
    return res.json({ status: 'ok', ...result });
  } catch (err) {
    return res.status(503).json({
      status: 'error',
      tokenValid: false,
      error: err.message,
    });
  }
});

// ─────────────────────────────────────────────────────────
// Webhook handlers (Section C)
// ─────────────────────────────────────────────────────────

const STATUS_MAP = {
  sent: 'SENT',
  delivered: 'DELIVERED',
  read: 'READ',
  failed: 'FAILED',
};

/**
 * Apply a single status update from Meta to an existing WhatsAppLog.
 * @returns {Object} { applied: boolean, reason?: string }
 */
async function handleStatusUpdate(status) {
  const newStatus = STATUS_MAP[status?.status?.toLowerCase?.()];
  if (!newStatus) {
    return { applied: false, reason: `unknown_status:${status?.status}` };
  }

  const waMessageId = status.id;
  if (!waMessageId) {
    return { applied: false, reason: 'missing_message_id' };
  }

  const log = await WhatsAppLog.findOne({ waMessageId });
  if (!log) {
    logger.warn(`Webhook status update for unknown waMessageId: ${waMessageId}`);
    return { applied: false, reason: 'unknown_message_id' };
  }

  // Idempotency: skip if same status already applied
  if (log.status === newStatus) {
    return { applied: false, reason: 'duplicate_status' };
  }

  let errorCode, errorMessage;
  if (newStatus === 'FAILED' && Array.isArray(status.errors) && status.errors[0]) {
    const e = status.errors[0];
    errorCode = e.code != null ? String(e.code) : 'UNKNOWN';
    errorMessage = e.title || e.message || 'Failed';
  }

  await log.applyStatusUpdate(newStatus, errorCode, errorMessage);
  return { applied: true, status: newStatus };
}

/**
 * Create an INBOUND log from a Meta message entry.
 * Matches sender to a Customer by phone (normalized).
 * @returns {Object} { created: boolean, logId?, customerMatched?, reason? }
 */
async function handleInboundMessage(msg, metadata) {
  if (!msg?.from) {
    return { created: false, reason: 'missing_from' };
  }

  // Idempotency by waMessageId
  if (msg.id) {
    const existing = await WhatsAppLog.findOne({ waMessageId: msg.id, type: 'INBOUND' })
      .select('_id').lean();
    if (existing) {
      return { created: false, reason: 'duplicate_inbound', logId: existing._id };
    }
  }

  let normalizedPhone;
  try {
    normalizedPhone = whatsappService.formatPhone(msg.from);
  } catch {
    // Unparseable phone — still log, just don't normalize
    normalizedPhone = String(msg.from);
  }

  // Try to find matching customer
  const customer = await Customer.findOne({
    isDeleted: false,
    $or: [
      { phone: msg.from },
      { phone: normalizedPhone },
      { phone: normalizedPhone.slice(2) }, // strip 91 prefix
    ],
  }).select('_id customerName phone').lean();

  const log = await WhatsAppLog.create({
    to: metadata?.phone_number_id || 'business_inbound',
    customer: customer?._id,
    type: 'INBOUND',
    waMessageId: msg.id,
    payload: msg,
    isMock: false,
  });

  logger.info(
    `Inbound WA message from ${msg.from} → customer: ${customer?._id || 'UNKNOWN'} ` +
    `(body: "${(msg.text?.body || '').slice(0, 40)}")`
  );

  return {
    created: true,
    logId: log._id,
    customerMatched: !!customer,
  };
}

/**
 * Log a structured error from Meta's errors[] array.
 * @returns {Object} { logged: true, code, title }
 */
function handleError(error) {
  logger.error(
    `WA webhook error: code=${error?.code} title="${error?.title}" details="${error?.message || ''}"`
  );
  return { logged: true, code: error?.code, title: error?.title };
}

/**
 * Iterate the Meta webhook payload and dispatch each change.
 * Meta's payload shape:
 *   { object, entry: [{ id, changes: [{ value: { messages?, statuses?, errors?, metadata } }] }] }
 */
async function processWebhookPayload(event) {
  const actions = [];
  const entries = Array.isArray(event?.entry) ? event.entry : [];

  for (const entry of entries) {
    const changes = Array.isArray(entry.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value || {};
      const metadata = value.metadata;

      // Statuses
      if (Array.isArray(value.statuses)) {
        for (const status of value.statuses) {
          const result = await handleStatusUpdate(status);
          actions.push({ kind: 'status', ...result });
        }
      }

      // Inbound messages
      if (Array.isArray(value.messages)) {
        for (const msg of value.messages) {
          const result = await handleInboundMessage(msg, metadata);
          actions.push({ kind: 'inbound', ...result });
        }
      }

      // Errors
      if (Array.isArray(value.errors)) {
        for (const error of value.errors) {
          const result = handleError(error);
          actions.push({ kind: 'error', ...result });
        }
      }
    }
  }

  return actions;
}

/**
 * GET /api/whatsapp/webhook
 * Meta verification handshake. Returns the challenge as PLAIN TEXT if valid.
 * (Meta requires plain text, not JSON.)
 */
exports.webhookVerify = (req, res) => {
  // Meta sends params as 'hub.mode' / 'hub.verify_token' / 'hub.challenge'.
  // Our express-mongo-sanitize middleware (server.js) rewrites '.' → '_' on
  // keys to prevent NoSQL injection. Accept both the original dotted form
  // (in case the sanitizer is reconfigured) AND the underscore-rewritten form.
  const mode = req.query['hub.mode'] ?? req.query.hub_mode ?? req.query?.hub?.mode;
  const token = req.query['hub.verify_token'] ?? req.query.hub_verify_token ?? req.query?.hub?.verify_token;
  const challenge = req.query['hub.challenge'] ?? req.query.hub_challenge ?? req.query?.hub?.challenge;

  const verified = whatsappService.verifyWebhookChallenge(mode, token, challenge);
  if (verified) {
    logger.info('WA webhook verification handshake passed');
    return res.status(200).type('text/plain').send(String(verified));
  }

  logger.warn(`WA webhook verification FAILED (mode=${mode})`);
  return res.status(403).json({ status: 'error', message: 'Verification failed' });
};

/**
 * POST /api/whatsapp/webhook
 * Meta event delivery. Public route (signature verifies).
 *
 * Always responds 200 once signature is valid (even if internal processing
 * errors) so Meta does not retry indefinitely. Signature failures still get
 * 401 — that's a misconfiguration, not a transient problem.
 */
exports.webhookEvent = async (req, res) => {
  const signature = req.headers['x-hub-signature-256'];

  // Body handling — express.raw() registered in server.js gives us a Buffer
  let rawBody, parsedEvent;
  if (Buffer.isBuffer(req.body)) {
    rawBody = req.body.toString('utf8');
    try {
      parsedEvent = rawBody ? JSON.parse(rawBody) : {};
    } catch (err) {
      logger.error('WA webhook: invalid JSON in body');
      return res.status(400).json({ status: 'error', message: 'Invalid JSON' });
    }
  } else {
    // Fallback (shouldn't happen with correct middleware ordering)
    rawBody = JSON.stringify(req.body || {});
    parsedEvent = req.body || {};
    logger.warn('WA webhook received without raw body — middleware order issue?');
  }

  // Signature verification (bypassed in mock mode)
  const sigValid = whatsappService.verifyWebhookSignature(rawBody, signature);
  if (!sigValid) {
    logger.error(`WA webhook signature INVALID from IP: ${req.ip}`);
    return res.status(401).json({ status: 'error', message: 'Invalid signature' });
  }

  // Process — wrap in try/catch so processing errors don't propagate
  let actions = [];
  try {
    actions = await processWebhookPayload(parsedEvent);
  } catch (err) {
    logger.error('WA webhook processing error:', err);
    // Still return 200 — processing errors are logged, not surfaced
  }

  return res.status(200).json({ status: 'success', actions: actions.length });
};

/**
 * POST /api/whatsapp/send-bill/:billId
 */
exports.sendBill = asyncHandler(async (req, res) => {
  await assertWhatsAppEnabled();

  if (!mongoose.Types.ObjectId.isValid(req.params.billId)) {
    throw ApiError.badRequest('Invalid bill ID');
  }

  const bill = await Bill.findById(req.params.billId).populate('customer');
  if (!bill || bill.isDeleted) throw ApiError.notFound('Bill not found');

  const customer = bill.customer;
  if (!customer || customer.isDeleted) throw ApiError.badRequest('Bill has no valid customer');
  if (!customer.phone) throw ApiError.badRequest('Customer has no phone number');

  await assertNotRecentlySent({
    type: 'BILL',
    relatedBill: bill._id,
    customer: customer._id,
  });

  const templateName = req.body?.templateName || 'bill_pdf_v1';
  const pdfUrl = req.body?.pdfUrl
    || `${process.env.PUBLIC_API_BASE || 'https://placeholder.example.com'}/api/bills/${bill._id}/pdf`;

  const { log, status } = await sendAndLog({
    type: 'BILL',
    sendFn: whatsappService.sendBillTemplate,
    sendFnName: 'sendBillTemplate',
    sendArgs: {
      to: customer.phone,
      templateName,
      pdfUrl,
      customerName: customer.customerName,
      billNumber: bill.billNumber,
      amount: bill.grandTotal,
      filename: `${bill.billNumber}.pdf`,
    },
    customer,
    relatedBill: bill._id,
    templateName,
    sentBy: req.user._id,
  });

  if (status === 'FAILED') {
    return res.status(502).json({
      status: 'error',
      message: log.errorMessage,
      data: { logId: log._id, errorCode: log.errorCode },
    });
  }

  res.status(201).json({
    status: 'success',
    data: {
      logId: log._id,
      waMessageId: log.waMessageId,
      to: log.to,
      templateName,
      billNumber: bill.billNumber,
      isMock: log.isMock,
    },
  });
});

/**
 * POST /api/whatsapp/send-payment-link
 */
exports.sendPaymentLink = asyncHandler(async (req, res) => {
  await assertWhatsAppEnabled();

  const { billId, paymentLinkUrl, templateName: tplOverride } = req.body;

  const bill = await Bill.findById(billId).populate('customer');
  if (!bill || bill.isDeleted) throw ApiError.notFound('Bill not found');

  const customer = bill.customer;
  if (!customer || customer.isDeleted) throw ApiError.badRequest('Bill has no valid customer');
  if (!customer.phone) throw ApiError.badRequest('Customer has no phone number');

  await assertNotRecentlySent({
    type: 'PAYMENT_LINK',
    relatedBill: bill._id,
    customer: customer._id,
  });

  const templateName = tplOverride || 'payment_link_v1';

  const { log, status } = await sendAndLog({
    type: 'PAYMENT_LINK',
    sendFn: whatsappService.sendPaymentLinkTemplate,
    sendFnName: 'sendPaymentLinkTemplate',
    sendArgs: {
      to: customer.phone,
      templateName,
      paymentLinkUrl,
      customerName: customer.customerName,
      amount: bill.grandTotal,
      billNumber: bill.billNumber,
    },
    customer,
    relatedBill: bill._id,
    templateName,
    sentBy: req.user._id,
  });

  if (status === 'FAILED') {
    return res.status(502).json({
      status: 'error',
      message: log.errorMessage,
      data: { logId: log._id, errorCode: log.errorCode },
    });
  }

  res.status(201).json({
    status: 'success',
    data: {
      logId: log._id,
      waMessageId: log.waMessageId,
      to: log.to,
      templateName,
      billNumber: bill.billNumber,
      paymentLinkUrl,
      isMock: log.isMock,
    },
  });
});

/**
 * POST /api/whatsapp/send-order-confirmation/:orderId
 */
exports.sendOrderConfirmation = asyncHandler(async (req, res) => {
  await assertWhatsAppEnabled();

  if (!mongoose.Types.ObjectId.isValid(req.params.orderId)) {
    throw ApiError.badRequest('Invalid order ID');
  }

  const order = await Order.findById(req.params.orderId).populate('customer');
  if (!order || order.isDeleted) throw ApiError.notFound('Order not found');

  const customer = order.customer;
  if (!customer || customer.isDeleted) throw ApiError.badRequest('Order has no valid customer');
  if (!customer.phone) throw ApiError.badRequest('Customer has no phone number');

  await assertNotRecentlySent({
    type: 'ORDER_CONFIRMATION',
    relatedOrder: order._id,
    customer: customer._id,
  });

  const templateName = req.body?.templateName || 'order_confirmation_v1';

  const { log, status } = await sendAndLog({
    type: 'ORDER_CONFIRMATION',
    sendFn: whatsappService.sendOrderConfirmationTemplate,
    sendFnName: 'sendOrderConfirmationTemplate',
    sendArgs: {
      to: customer.phone,
      templateName,
      customerName: customer.customerName,
      orderNumber: order.orderNumber,
      totalAmount: order.totalAmount,
    },
    customer,
    relatedOrder: order._id,
    templateName,
    sentBy: req.user._id,
  });

  if (status === 'FAILED') {
    return res.status(502).json({
      status: 'error',
      message: log.errorMessage,
      data: { logId: log._id, errorCode: log.errorCode },
    });
  }

  res.status(201).json({
    status: 'success',
    data: {
      logId: log._id,
      waMessageId: log.waMessageId,
      to: log.to,
      templateName,
      orderNumber: order.orderNumber,
      isMock: log.isMock,
    },
  });
});

/**
 * POST /api/whatsapp/send-order-ready/:orderId
 */
exports.sendOrderReady = asyncHandler(async (req, res) => {
  await assertWhatsAppEnabled();

  if (!mongoose.Types.ObjectId.isValid(req.params.orderId)) {
    throw ApiError.badRequest('Invalid order ID');
  }

  const order = await Order.findById(req.params.orderId).populate('customer');
  if (!order || order.isDeleted) throw ApiError.notFound('Order not found');

  const customer = order.customer;
  if (!customer || customer.isDeleted) throw ApiError.badRequest('Order has no valid customer');
  if (!customer.phone) throw ApiError.badRequest('Customer has no phone number');

  await assertNotRecentlySent({
    type: 'ORDER_READY',
    relatedOrder: order._id,
    customer: customer._id,
  });

  const templateName = req.body?.templateName || 'order_ready_v1';

  const { log, status } = await sendAndLog({
    type: 'ORDER_READY',
    sendFn: whatsappService.sendOrderReadyTemplate,
    sendFnName: 'sendOrderReadyTemplate',
    sendArgs: {
      to: customer.phone,
      templateName,
      customerName: customer.customerName,
      orderNumber: order.orderNumber,
    },
    customer,
    relatedOrder: order._id,
    templateName,
    sentBy: req.user._id,
  });

  if (status === 'FAILED') {
    return res.status(502).json({
      status: 'error',
      message: log.errorMessage,
      data: { logId: log._id, errorCode: log.errorCode },
    });
  }

  res.status(201).json({
    status: 'success',
    data: {
      logId: log._id,
      waMessageId: log.waMessageId,
      to: log.to,
      templateName,
      orderNumber: order.orderNumber,
      isMock: log.isMock,
    },
  });
});

/**
 * POST /api/whatsapp/send-text
 * Free-text message — 24h customer service window enforced.
 * Body: { customerId? | to?, text }
 */
exports.sendText = asyncHandler(async (req, res) => {
  await assertWhatsAppEnabled();

  const { customerId, to: rawPhone, text } = req.body;

  let customer = null;
  if (customerId) {
    customer = await Customer.findById(customerId);
    if (!customer || customer.isDeleted) throw ApiError.badRequest('Customer not found');
  }

  // Resolve target phone
  let targetPhone = rawPhone || customer?.phone;
  if (!targetPhone) {
    throw ApiError.badRequest('No phone available (customer has no phone, and no `to` provided)');
  }

  // If targeting by raw phone, try to find the customer for 24h window lookup
  if (!customer && rawPhone) {
    const normalized = whatsappService.formatPhone(rawPhone);
    customer = await Customer.findOne({
      $or: [{ phone: rawPhone }, { phone: normalized }, { phone: normalized.slice(2) }],
      isDeleted: false,
    });
  }

  // 24h window check
  if (customer) {
    const lastInbound = await WhatsAppLog.findOne({
      customer: customer._id,
      type: 'INBOUND',
    }).sort({ createdAt: -1 }).select('createdAt').lean();

    if (!lastInbound) {
      throw ApiError.forbidden(
        'Cannot send free-text: no inbound message from this customer (24h service window required)'
      );
    }
    const hoursSince = (Date.now() - new Date(lastInbound.createdAt).getTime()) / (1000 * 60 * 60);
    if (hoursSince > 24) {
      throw ApiError.forbidden(
        `Cannot send free-text: last inbound was ${hoursSince.toFixed(1)}h ago (>24h window)`
      );
    }
  } else {
    // No customer record at all — refuse rather than guess
    throw ApiError.forbidden(
      'Cannot send free-text to unknown number (no matching customer for 24h window check)'
    );
  }

  // Send
  let response = null;
  let waMessageId = null;
  let status = 'SENT';
  let errorCode, errorMessage;
  try {
    response = await whatsappService.sendTextMessage(targetPhone, text);
    waMessageId = response?.messages?.[0]?.id;
  } catch (err) {
    status = 'FAILED';
    errorCode = err.code != null ? String(err.code) : 'SEND_FAILED';
    errorMessage = err.message;
    logger.error('WA text send failed:', err.message);
  }

  const log = await WhatsAppLog.create({
    to: whatsappService.formatPhone(targetPhone),
    customer: customer._id,
    type: 'TEXT',
    waMessageId,
    payload: response ? { text: { body: text }, response } : { text: { body: text } },
    status,
    errorCode,
    errorMessage,
    isMock: whatsappService.isMockMode(),
    sentBy: req.user._id,
    retryContext: { sendFn: 'sendTextMessage', args: { to: targetPhone, text } },
  });

  if (status === 'FAILED') {
    return res.status(502).json({
      status: 'error',
      message: errorMessage,
      data: { logId: log._id, errorCode },
    });
  }

  res.status(201).json({
    status: 'success',
    data: {
      logId: log._id,
      waMessageId,
      to: log.to,
      type: 'TEXT',
      isMock: log.isMock,
    },
  });
});
