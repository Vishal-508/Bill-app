const { Payment, WebhookEvent, Bill } = require('../models');
const gatewayPaymentService = require('./gatewayPaymentService');
const notificationOrchestrator = require('../services/notificationOrchestrator.service');
const logger = require('../config/logger');

/**
 * Webhook Handler Service.
 * Routes Razorpay events to appropriate processors.
 */

exports.processWebhookEvent = async (event, rawPayload) => {
  const startTime = Date.now();
  const eventType = event.event;
  const eventId = event.id || `synthetic_${Date.now()}`;

  logger.info(`Processing webhook: ${eventType} (${eventId})`);

  let webhookRecord;
  try {
    webhookRecord = await WebhookEvent.create({
      razorpayEventId: eventId,
      eventType,
      eventTimestamp: event.created_at ? new Date(event.created_at * 1000) : null,
      status: 'RECEIVED',
      signatureValid: true,
      payload: event,
      razorpayPaymentId: event.payload?.payment?.entity?.id,
      razorpayOrderId: event.payload?.payment?.entity?.order_id,
      razorpayRefundId: event.payload?.refund?.entity?.id,
    });
  } catch (err) {
    if (err.code === 11000) {
      logger.warn(`Duplicate webhook event: ${eventId} — skipping`);
      const existing = await WebhookEvent.findOne({ razorpayEventId: eventId });
      if (existing && existing.status !== 'DUPLICATE') {
        existing.retryCount = (existing.retryCount || 0) + 1;
        existing.lastRetryAt = new Date();
        await existing.save();
      }
      return { status: 'DUPLICATE', eventId };
    }
    throw err;
  }

  try {
    let result;
    const actions = [];

    switch (eventType) {
      case 'payment.authorized':
        result = await handlePaymentAuthorized(event, actions);
        break;
      case 'payment.captured':
        result = await handlePaymentCaptured(event, actions);
        break;
      case 'payment.failed':
        result = await handlePaymentFailed(event, actions);
        break;
      case 'refund.created':
        result = await handleRefundCreated(event, actions);
        break;
      case 'refund.processed':
        result = await handleRefundProcessed(event, actions);
        break;
      default:
        logger.warn(`Unhandled webhook event type: ${eventType}`);
        actions.push('event_ignored_unknown_type');
        result = { handled: false };
    }

    webhookRecord.processingDurationMs = Date.now() - startTime;
    await webhookRecord.markProcessed(actions);

    return { status: 'PROCESSED', eventId, result, actions };
  } catch (err) {
    logger.error(`Webhook processing failed: ${eventId}`, err);
    webhookRecord.processingDurationMs = Date.now() - startTime;
    await webhookRecord.markFailed(err);
    throw err;
  }
};

async function handlePaymentAuthorized(event, actions) {
  const rzpPayment = event.payload?.payment?.entity;
  if (!rzpPayment) throw new Error('Missing payment entity in payload');

  const payment = await Payment.findOne({
    razorpayOrderId: rzpPayment.order_id,
  });

  if (!payment) {
    logger.warn(`No Payment record for Razorpay order: ${rzpPayment.order_id}`);
    actions.push('payment_not_found');
    return { handled: false };
  }

  if (['CREATED', 'ATTEMPTED'].includes(payment.status)) {
    payment.status = 'AUTHORIZED';
    payment.razorpayPaymentId = rzpPayment.id;
    payment.method = rzpPayment.method;
    payment.addEvent('AUTHORIZED', {
      source: 'webhook',
      razorpayEventId: event.id,
      payload: { method: rzpPayment.method },
    });
    await payment.save();
    actions.push('payment_marked_authorized');
  }

  return { paymentRef: payment.paymentReference, handled: true };
}

async function handlePaymentCaptured(event, actions) {
  const rzpPayment = event.payload?.payment?.entity;
  if (!rzpPayment) throw new Error('Missing payment entity in payload');

  const payment = await Payment.findOne({
    razorpayOrderId: rzpPayment.order_id,
  });

  if (!payment) {
    logger.warn(`No Payment record for Razorpay order: ${rzpPayment.order_id}`);
    actions.push('payment_not_found');
    return { handled: false };
  }

  if (payment.status === 'CAPTURED') {
    logger.info(`Payment ${payment.paymentReference} already CAPTURED`);
    actions.push('already_captured_idempotent');
    return { paymentRef: payment.paymentReference, handled: true };
  }

  await payment.markCaptured(rzpPayment.id, rzpPayment.signature || 'webhook_no_sig', {
    method: rzpPayment.method,
    methodDetails: {
      vpa: rzpPayment.vpa,
      cardNetwork: rzpPayment.card?.network,
      cardLast4: rzpPayment.card?.last4,
      bank: rzpPayment.bank,
      wallet: rzpPayment.wallet,
    },
    source: 'webhook',
    payload: { eventId: event.id },
  });
  actions.push('payment_marked_captured');

  await gatewayPaymentService.syncOrderPaymentStatus(payment.order);
  actions.push('order_synced');

  let relatedBill = null;
  if (payment.bill) {
    await gatewayPaymentService.syncBillPaymentStatus(payment.bill);
    actions.push('bill_synced');
    relatedBill = await Bill.findById(payment.bill).select('_id billNumber grandTotal').lean();
  }

  // Fire-and-forget notification (Prompt 7 Section D).
  // Never blocks the webhook 200 response; failures logged inside the orchestrator.
  notificationOrchestrator.onPaymentReceived(payment, relatedBill)
    .catch(notificationOrchestrator.noop);
  actions.push('notification_dispatched');

  return { paymentRef: payment.paymentReference, handled: true };
}

async function handlePaymentFailed(event, actions) {
  const rzpPayment = event.payload?.payment?.entity;
  if (!rzpPayment) throw new Error('Missing payment entity in payload');

  const payment = await Payment.findOne({
    razorpayOrderId: rzpPayment.order_id,
  });

  if (!payment) {
    actions.push('payment_not_found');
    return { handled: false };
  }

  if (payment.status === 'FAILED') {
    actions.push('already_failed_idempotent');
    return { handled: true };
  }

  await payment.markFailed(
    rzpPayment.error_code || 'UNKNOWN',
    rzpPayment.error_description || 'Payment failed',
    {
      source: rzpPayment.error_source,
      eventSource: 'webhook',
      payload: { eventId: event.id },
    }
  );
  actions.push('payment_marked_failed');

  return { paymentRef: payment.paymentReference, handled: true };
}

async function handleRefundCreated(event, actions) {
  const refund = event.payload?.refund?.entity;
  if (!refund) throw new Error('Missing refund entity');

  const payment = await Payment.findOne({
    razorpayPaymentId: refund.payment_id,
  });

  if (!payment) {
    actions.push('payment_not_found');
    return { handled: false };
  }

  payment.razorpayRefundId = refund.id;
  payment.amountRefunded = refund.amount;
  payment.addEvent('REFUND_INITIATED', {
    source: 'webhook',
    razorpayEventId: event.id,
    payload: { refundId: refund.id, amount: refund.amount },
  });
  await payment.save();
  actions.push('refund_initiated');

  return { paymentRef: payment.paymentReference, handled: true };
}

async function handleRefundProcessed(event, actions) {
  const refund = event.payload?.refund?.entity;
  if (!refund) throw new Error('Missing refund entity');

  const payment = await Payment.findOne({
    razorpayRefundId: refund.id,
  });

  if (!payment) {
    actions.push('payment_not_found');
    return { handled: false };
  }

  payment.amountRefunded = refund.amount;
  if (payment.amountRefunded >= payment.amount) {
    payment.status = 'REFUNDED';
  }
  payment.addEvent('REFUNDED', {
    source: 'webhook',
    razorpayEventId: event.id,
  });
  await payment.save();
  actions.push('refund_completed');

  await gatewayPaymentService.syncOrderPaymentStatus(payment.order);
  if (payment.bill) {
    await gatewayPaymentService.syncBillPaymentStatus(payment.bill);
  }
  actions.push('amounts_synced_after_refund');

  return { paymentRef: payment.paymentReference, handled: true };
}
