const axios = require('axios');
const crypto = require('crypto');
const logger = require('../config/logger');

/**
 * WhatsApp Cloud API service (Meta Graph API v23.0).
 *
 * Design:
 *   1. Mock-mode aware (WA_TOKEN contains "PLACEHOLDER" → no HTTP calls)
 *   2. Singleton axios client with token in Authorization header
 *   3. Template-first (all bill/payment/order messages use approved templates)
 *   4. Free-text only during 24h customer-service window (caller's responsibility)
 *   5. Signature verification via crypto.timingSafeEqual (anti-timing-attack)
 *   6. Phone normalization to 91XXXXXXXXXX (India, no '+')
 */

const GRAPH_API_BASE = 'https://graph.facebook.com/v23.0';

let httpClient = null;
let initialized = false;
let mockMode = false;

function getClient() {
  if (initialized) return httpClient;

  // .trim() guards against trailing whitespace / CR from .env edits on Windows.
  const token = process.env.WA_TOKEN?.trim();
  const phoneId = process.env.WA_PHONE_ID?.trim();

  if (!token || !phoneId || token.includes('PLACEHOLDER') || phoneId.includes('PLACEHOLDER')) {
    mockMode = true;
    initialized = true;
    logger.warn('WhatsApp service in MOCK mode (PLACEHOLDER credentials)');
    return null;
  }

  httpClient = axios.create({
    baseURL: `${GRAPH_API_BASE}/${phoneId}`,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    timeout: 15000,
  });
  initialized = true;
  mockMode = false;
  logger.info('WhatsApp service initialized (LIVE Graph API v23.0)');
  return httpClient;
}

exports.isMockMode = () => {
  getClient();
  return mockMode;
};

/**
 * Normalize phone to Meta's expected format: 91XXXXXXXXXX (no '+').
 * Accepts:
 *   - 9876543210
 *   - 09876543210
 *   - +91 98765 43210
 *   - 91-9876543210
 *   - "98765 43210"
 */
exports.formatPhone = (raw) => {
  if (!raw) throw new Error('Phone is required');
  const digits = String(raw).replace(/\D/g, '');

  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) return `91${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  if (digits.length === 13 && digits.startsWith('091')) return digits.slice(1);

  throw new Error(`Invalid phone format: ${raw} (digits: ${digits.length})`);
};

function mockSendResponse() {
  return {
    messaging_product: 'whatsapp',
    contacts: [{ wa_id: 'mock_contact' }],
    messages: [{ id: `wamid.mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` }],
    _mock: true,
  };
}

/**
 * Core: send a templated message.
 * @param {string} to - Already-normalized phone (use formatPhone first)
 * @param {string} templateName - Approved template name
 * @param {Array} components - Body/header/button components per Meta spec
 * @param {string} languageCode - Default 'en'
 */
exports.sendTemplate = async (to, templateName, components = [], languageCode = 'en') => {
  const client = getClient();

  if (!client || mockMode) {
    logger.info(`[MOCK WA] template=${templateName} to=${to}`);
    return mockSendResponse();
  }

  try {
    const { data } = await client.post('/messages', {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: languageCode },
        ...(components.length > 0 ? { components } : {}),
      },
    });
    logger.info(`WA template sent: ${templateName} to ${to} (wamid: ${data.messages?.[0]?.id})`);
    return data;
  } catch (err) {
    const meta = err.response?.data?.error;
    const msg = meta?.message || err.message;
    logger.error(`WA send failed (${templateName} → ${to}):`, msg);
    const wrapped = new Error(`WhatsApp send failed: ${msg}`);
    wrapped.code = meta?.code;
    wrapped.subcode = meta?.error_subcode;
    wrapped.metaError = meta;
    throw wrapped;
  }
};

/**
 * Send bill PDF as a templated message with DOCUMENT header.
 * Template must be pre-approved with body params matching:
 *   {{1}} = customerName, {{2}} = billNumber, {{3}} = amount
 *
 * @param {Object} args
 * @param {string} args.to - Phone (raw, will be normalized)
 * @param {string} args.templateName - Approved template (e.g., 'bill_pdf_v1')
 * @param {string} args.pdfUrl - Publicly accessible PDF URL
 * @param {string} args.customerName - For {{1}}
 * @param {string} args.billNumber - For {{2}}
 * @param {number|string} args.amount - For {{3}}
 * @param {string} args.filename - Display filename (e.g., "Invoice-INV-2026-042.pdf")
 */
exports.sendBillTemplate = async ({ to, templateName, pdfUrl, customerName, billNumber, amount, filename }) => {
  const phone = exports.formatPhone(to);
  const components = [
    {
      type: 'header',
      parameters: [
        {
          type: 'document',
          document: {
            link: pdfUrl,
            filename: filename || `${billNumber}.pdf`,
          },
        },
      ],
    },
    {
      type: 'body',
      parameters: [
        { type: 'text', text: String(customerName) },
        { type: 'text', text: String(billNumber) },
        { type: 'text', text: String(amount) },
      ],
    },
  ];
  return exports.sendTemplate(phone, templateName, components);
};

/**
 * Send a payment link template.
 * Template body params: {{1}}=customerName, {{2}}=amount, {{3}}=billNumber
 * Button: dynamic URL component carrying paymentLinkUrl.
 */
exports.sendPaymentLinkTemplate = async ({ to, templateName, paymentLinkUrl, customerName, amount, billNumber }) => {
  const phone = exports.formatPhone(to);
  const components = [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: String(customerName) },
        { type: 'text', text: String(amount) },
        { type: 'text', text: String(billNumber) },
      ],
    },
    {
      type: 'button',
      sub_type: 'url',
      index: '0',
      parameters: [{ type: 'text', text: paymentLinkUrl }],
    },
  ];
  return exports.sendTemplate(phone, templateName, components);
};

/**
 * Send order confirmation.
 * Template body params: {{1}}=customerName, {{2}}=orderNumber, {{3}}=totalAmount
 */
exports.sendOrderConfirmationTemplate = async ({ to, templateName, customerName, orderNumber, totalAmount }) => {
  const phone = exports.formatPhone(to);
  const components = [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: String(customerName) },
        { type: 'text', text: String(orderNumber) },
        { type: 'text', text: String(totalAmount) },
      ],
    },
  ];
  return exports.sendTemplate(phone, templateName, components);
};

/**
 * Send order ready notification.
 * Template body params: {{1}}=customerName, {{2}}=orderNumber
 */
exports.sendOrderReadyTemplate = async ({ to, templateName, customerName, orderNumber }) => {
  const phone = exports.formatPhone(to);
  const components = [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: String(customerName) },
        { type: 'text', text: String(orderNumber) },
      ],
    },
  ];
  return exports.sendTemplate(phone, templateName, components);
};

/**
 * Send a free-text message.
 * IMPORTANT: only valid within the 24-hour customer service window after
 * the customer last messaged you. Outside that window Meta rejects with
 * error code 131047. Caller is responsible for enforcing the window.
 */
exports.sendTextMessage = async (to, text) => {
  const phone = exports.formatPhone(to);
  const client = getClient();

  if (!client || mockMode) {
    logger.info(`[MOCK WA] text → ${phone}: "${text.slice(0, 40)}..."`);
    return mockSendResponse();
  }

  try {
    const { data } = await client.post('/messages', {
      messaging_product: 'whatsapp',
      to: phone,
      type: 'text',
      text: { body: text },
    });
    logger.info(`WA text sent to ${phone} (wamid: ${data.messages?.[0]?.id})`);
    return data;
  } catch (err) {
    const meta = err.response?.data?.error;
    const msg = meta?.message || err.message;
    logger.error(`WA text send failed (${phone}):`, msg);
    const wrapped = new Error(`WhatsApp text send failed: ${msg}`);
    wrapped.code = meta?.code;
    wrapped.subcode = meta?.error_subcode;
    wrapped.metaError = meta;
    throw wrapped;
  }
};

/**
 * Verify Meta webhook signature.
 * Meta sends 'x-hub-signature-256' as 'sha256=<hex>'.
 * HMAC body with WA_APP_SECRET, compare timing-safe.
 *
 * @param {Buffer|string} rawBody - Raw request bytes (NOT parsed JSON)
 * @param {string} signatureHeader - Value of 'x-hub-signature-256'
 */
exports.verifyWebhookSignature = (rawBody, signatureHeader) => {
  if (mockMode || exports.isMockMode()) {
    logger.warn('[MOCK WA] webhook signature bypassed');
    return true;
  }

  if (!signatureHeader || typeof signatureHeader !== 'string') return false;
  if (!signatureHeader.startsWith('sha256=')) return false;

  // .trim() — see getClient() comment about Windows .env CRLF.
  const appSecret = process.env.WA_APP_SECRET?.trim();
  if (!appSecret || appSecret.includes('PLACEHOLDER')) {
    logger.error('WA_APP_SECRET missing or placeholder — refusing live webhook');
    return false;
  }

  const provided = signatureHeader.slice('sha256='.length);
  const bodyBuf = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), 'utf8');
  const expected = crypto.createHmac('sha256', appSecret).update(bodyBuf).digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(provided, 'hex'),
      Buffer.from(expected, 'hex')
    );
  } catch {
    return false;
  }
};

/**
 * Verify GET /webhook handshake (Meta sends hub.verify_token + hub.challenge).
 * @returns {string|null} challenge if valid, null otherwise
 */
exports.verifyWebhookChallenge = (mode, verifyToken, challenge) => {
  // .trim() both sides — see getClient() comment about Windows .env CRLF.
  const expected = process.env.WA_VERIFY_TOKEN?.trim();
  const provided = verifyToken?.trim();
  if (mode === 'subscribe' && provided && expected && provided === expected) {
    return challenge;
  }
  return null;
};

/**
 * Generate a mock message ID (for tests).
 */
exports.generateMockMessageId = () => {
  return `wamid.mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
};

/**
 * Live-mode health check: hit Graph API /me to validate the token.
 * In mock mode the caller should short-circuit before invoking this.
 */
exports.healthCheck = async () => {
  if (exports.isMockMode()) {
    return { tokenValid: null, mock: true };
  }
  const phoneId = process.env.WA_PHONE_ID?.trim();
  const businessAccountId = process.env.WA_BUSINESS_ACCOUNT_ID?.trim();
  try {
    const client = axios.create({
      baseURL: GRAPH_API_BASE,
      headers: { Authorization: `Bearer ${process.env.WA_TOKEN?.trim()}` },
      timeout: 10000,
    });
    const { data } = await client.get('/me');
    return {
      tokenValid: true,
      phoneNumberId: phoneId,
      businessAccountId,
      identity: { id: data.id, name: data.name },
    };
  } catch (err) {
    const meta = err.response?.data?.error;
    const msg = meta?.message || err.message;
    const wrapped = new Error(msg);
    wrapped.code = meta?.code;
    throw wrapped;
  }
};
