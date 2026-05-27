const Razorpay = require('razorpay');
const crypto = require('crypto');
const logger = require('../config/logger');

/**
 * Razorpay Service — wrapper around Razorpay SDK.
 *
 * DESIGN:
 *   1. Singleton client (one instance reused)
 *   2. Mock-friendly (degrades when credentials are placeholders)
 *   3. Signature verification with timing-attack protection
 *   4. Consistent error wrapping
 *   5. Amount conversion handled at boundary (rupees ↔ paise)
 */

let razorpayInstance = null;
let isMockMode = false;
let initialized = false;

function getClient() {
  if (initialized) return razorpayInstance;

  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret ||
      keyId.includes('PLACEHOLDER') ||
      keySecret.includes('placeholder')) {
    isMockMode = true;
    initialized = true;
    logger.warn('Razorpay running in MOCK mode (placeholder/missing credentials)');
    return null;
  }

  try {
    razorpayInstance = new Razorpay({
      key_id: keyId,
      key_secret: keySecret,
    });
    initialized = true;
    isMockMode = false;
    logger.info('Razorpay client initialized (live SDK mode)');
    return razorpayInstance;
  } catch (err) {
    logger.error('Failed to initialize Razorpay:', err.message);
    isMockMode = true;
    initialized = true;
    return null;
  }
}

exports.isMockMode = () => {
  getClient();
  return isMockMode;
};

exports.getKeyId = () => {
  return process.env.RAZORPAY_KEY_ID || 'rzp_test_PLACEHOLDER';
};

exports.createOrder = async (options) => {
  const client = getClient();

  if (!client || isMockMode) {
    const mockOrderId = `order_mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    logger.info(`[MOCK] Created order: ${mockOrderId} for ₹${options.amount / 100}`);
    return {
      id: mockOrderId,
      entity: 'order',
      amount: options.amount,
      amount_paid: 0,
      amount_due: options.amount,
      currency: options.currency || 'INR',
      receipt: options.receipt,
      status: 'created',
      attempts: 0,
      notes: options.notes || {},
      created_at: Math.floor(Date.now() / 1000),
      _mock: true,
    };
  }

  try {
    const order = await client.orders.create({
      amount: options.amount,
      currency: options.currency || 'INR',
      receipt: options.receipt,
      notes: options.notes || {},
      partial_payment: options.partial_payment || false,
    });
    logger.info(`Razorpay order created: ${order.id} for ₹${options.amount / 100}`);
    return order;
  } catch (err) {
    const msg = err.error?.description || err.message;
    logger.error('Razorpay createOrder failed:', msg);
    throw new Error(`Razorpay error: ${msg}`);
  }
};

exports.fetchOrder = async (orderId) => {
  const client = getClient();

  if (!client || isMockMode) {
    return { id: orderId, status: 'created', _mock: true };
  }

  try {
    return await client.orders.fetch(orderId);
  } catch (err) {
    throw new Error(`Razorpay fetchOrder error: ${err.error?.description || err.message}`);
  }
};

exports.fetchPayment = async (paymentId) => {
  const client = getClient();

  if (!client || isMockMode) {
    return {
      id: paymentId,
      status: 'captured',
      method: 'upi',
      amount: 100000,
      _mock: true,
    };
  }

  try {
    return await client.payments.fetch(paymentId);
  } catch (err) {
    throw new Error(`Razorpay fetchPayment error: ${err.error?.description || err.message}`);
  }
};

exports.capturePayment = async (paymentId, amount, currency = 'INR') => {
  const client = getClient();

  if (!client || isMockMode) {
    logger.info(`[MOCK] Captured payment: ${paymentId} for ₹${amount / 100}`);
    return { id: paymentId, status: 'captured', amount, currency, _mock: true };
  }

  try {
    return await client.payments.capture(paymentId, amount, currency);
  } catch (err) {
    throw new Error(`Razorpay capture error: ${err.error?.description || err.message}`);
  }
};

exports.refund = async (paymentId, amount, options = {}) => {
  const client = getClient();

  if (!client || isMockMode) {
    const mockRefundId = `rfnd_mock_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    logger.info(`[MOCK] Refund: ${mockRefundId} for ₹${amount / 100}`);
    return {
      id: mockRefundId,
      payment_id: paymentId,
      amount,
      currency: 'INR',
      status: 'processed',
      _mock: true,
    };
  }

  try {
    return await client.payments.refund(paymentId, {
      amount,
      notes: options.notes || {},
      receipt: options.receipt,
    });
  } catch (err) {
    throw new Error(`Razorpay refund error: ${err.error?.description || err.message}`);
  }
};

/**
 * Verify Razorpay payment signature.
 * CRITICAL for security — never skip for real payments.
 * Uses timing-safe comparison.
 */
exports.verifyPaymentSignature = (orderId, paymentId, signature) => {
  if (isMockMode) {
    logger.warn('[MOCK] Payment signature verification bypassed');
    return signature === 'mock_signature' || (typeof signature === 'string' && signature.startsWith('mock_'));
  }

  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  const payload = `${orderId}|${paymentId}`;
  const expectedSignature = crypto
    .createHmac('sha256', keySecret)
    .update(payload)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );
  } catch (err) {
    return false;
  }
};

/**
 * Verify webhook signature.
 * Different secret than payment signature.
 */
exports.verifyWebhookSignature = (body, signature) => {
  if (isMockMode) {
    logger.warn('[MOCK] Webhook signature verification bypassed');
    return true;
  }

  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!webhookSecret) {
    logger.error('RAZORPAY_WEBHOOK_SECRET not configured — refusing webhook');
    return false;
  }

  const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);
  const expectedSignature = crypto
    .createHmac('sha256', webhookSecret)
    .update(bodyStr)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );
  } catch (err) {
    return false;
  }
};

/**
 * Generate unique payment reference.
 * Format: PAY-YYYY-XXXXXXXX (year + 8 alphanumeric chars)
 */
exports.generatePaymentReference = () => {
  const year = new Date().getFullYear();
  const random = Math.random().toString(36).slice(2, 10).toUpperCase().padEnd(8, '0').slice(0, 8);
  return `PAY-${year}-${random}`;
};

exports.toPaise = (rupees) => Math.round(rupees * 100);
exports.toRupees = (paise) => paise / 100;
