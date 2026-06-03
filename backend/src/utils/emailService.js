const nodemailer = require('nodemailer');
const { SystemSetting, EmailLog } = require('../models');
const logger = require('../config/logger');

/**
 * Email Service — real Nodemailer SMTP transport (Prompt 7 Section E).
 *
 * Mock-mode detection (same pattern as razorpayService / whatsappService):
 *   - If EMAIL_HOST is undefined / empty / contains "PLACEHOLDER" → MOCK
 *   - Mock returns { success: true, isMock: true, messageId: 'mock_...' }
 *   - No SMTP connection attempted in mock mode
 *
 * Function signatures use object-arg destructuring so callers pass exactly
 * what the email needs (decouples emailService from Bill/Order/Customer
 * model shapes).
 */

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

let transport = null;
let initialized = false;
let mockMode = false;

function getTransport() {
  if (initialized) return transport;

  const host = process.env.EMAIL_HOST?.trim();
  const port = parseInt(process.env.EMAIL_PORT?.trim() || '587', 10);
  const user = process.env.EMAIL_USER?.trim();
  const pass = process.env.EMAIL_PASS?.trim();

  if (!host || host.includes('PLACEHOLDER') || (user && user.includes('PLACEHOLDER'))) {
    mockMode = true;
    initialized = true;
    logger.warn('emailService running in MOCK mode (PLACEHOLDER credentials)');
    return null;
  }

  try {
    transport = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
      pool: true,
      maxConnections: 5,
      connectionTimeout: 30 * 1000,
      socketTimeout: 30 * 1000,
    });
    initialized = true;
    mockMode = false;
    logger.info(`emailService initialized (LIVE) ${user}@${host}:${port}`);
    return transport;
  } catch (err) {
    logger.error('emailService transport init failed:', err.message);
    mockMode = true;
    initialized = true;
    return null;
  }
}

exports.isMockMode = () => {
  getTransport();
  return mockMode;
};

/**
 * For tests — reset cached state so a new env can take effect mid-process.
 */
exports._resetForTesting = () => {
  transport = null;
  initialized = false;
  mockMode = false;
};

/**
 * Live-mode health check — verifies SMTP connection + auth.
 * In mock mode the caller should short-circuit before invoking this.
 */
exports.healthCheck = async () => {
  if (exports.isMockMode()) {
    return { mock: true };
  }
  const t = getTransport();
  if (!t) throw new Error('Transport not initialized');
  await t.verify();
  return {
    host: process.env.EMAIL_HOST?.trim(),
    port: parseInt(process.env.EMAIL_PORT?.trim() || '587', 10),
    verified: true,
  };
};

async function isEmailEnabled() {
  // Default true if setting absent (graceful for fresh DBs).
  return await SystemSetting.getValue('EMAIL_ENABLED', true);
}

async function getFromAddress() {
  const fromEmail = await SystemSetting.getValue('EMAIL_FROM_ADDRESS', null)
    || process.env.EMAIL_FROM?.trim()
    || 'noreply@shreegopalmdf.example';
  const fromName = await SystemSetting.getValue('EMAIL_FROM_NAME', 'Shree Gopal MDF');
  return `"${fromName}" <${fromEmail}>`;
}

function validateRecipient(to) {
  if (!to || typeof to !== 'string') return { ok: false, error: 'INVALID_TO' };
  if (!EMAIL_REGEX.test(to.trim())) return { ok: false, error: 'INVALID_EMAIL_FORMAT' };
  return { ok: true };
}

/**
 * Mock send — returns success shape without hitting SMTP.
 */
function mockSend(label, to) {
  const messageId = `mock_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  logger.info(`[MOCK EMAIL] ${label} → ${to} (messageId: ${messageId})`);
  return { success: true, isMock: true, messageId };
}

/**
 * Best-effort EmailLog creation — never throws even if Mongo is down.
 */
async function createEmailLog(fields) {
  try {
    return await EmailLog.create(fields);
  } catch (err) {
    logger.error('emailService: EmailLog.create failed:', err.message);
    return null;
  }
}

/**
 * Core: send a mail using the configured transport.
 * Always creates an EmailLog entry (mock or live, success or fail).
 *
 * @param {Object} opts
 * @param {string} opts.to
 * @param {string} opts.subject
 * @param {string} opts.html
 * @param {string} opts.text
 * @param {Array}  opts.attachments
 * @param {string} opts.label - human-readable label like "sendBillEmail"
 * @param {string} opts.logType - EmailLog.type value
 * @param {Object} opts.logContext - { customer, relatedBill, relatedOrder } ObjectIds (all optional)
 * @param {Object} opts.payload - additional context for the EmailLog payload field
 */
async function sendMail({ to, subject, html, text, attachments, label, logType, logContext = {}, payload, retryContext }) {
  const validation = validateRecipient(to);
  if (!validation.ok) {
    return { success: false, error: validation.error, isMock: mockMode };
  }

  const enabled = await isEmailEnabled();
  if (!enabled) {
    return { success: false, error: 'EMAIL_DISABLED', isMock: mockMode };
  }

  const t = getTransport();

  // MOCK path
  if (!t || mockMode) {
    const mock = mockSend(label, to);
    const log = await createEmailLog({
      to: to.toLowerCase(),
      customer: logContext.customer,
      type: logType,
      subject,
      emailMessageId: mock.messageId,
      status: 'SENT',
      relatedBill: logContext.relatedBill,
      relatedOrder: logContext.relatedOrder,
      payload: payload || { subject, label, mock: true },
      retryContext,
      isMock: true,
    });
    return { ...mock, logId: log?._id };
  }

  // LIVE path
  const from = await getFromAddress();
  try {
    const info = await t.sendMail({
      from,
      to,
      subject,
      html,
      text,
      ...(attachments?.length ? { attachments } : {}),
    });
    logger.info(`Email sent: ${label} → ${to} (messageId: ${info.messageId})`);
    const log = await createEmailLog({
      to: to.toLowerCase(),
      customer: logContext.customer,
      type: logType,
      subject,
      emailMessageId: info.messageId,
      status: 'SENT',
      relatedBill: logContext.relatedBill,
      relatedOrder: logContext.relatedOrder,
      payload: payload || { subject, label, response: info.response },
      retryContext,
      isMock: false,
    });
    return { success: true, isMock: false, messageId: info.messageId, logId: log?._id };
  } catch (err) {
    logger.error(`Email send failed (${label} → ${to}):`, err.message);
    const log = await createEmailLog({
      to: to.toLowerCase(),
      customer: logContext.customer,
      type: logType,
      subject,
      status: 'FAILED',
      errorCode: err.code != null ? String(err.code) : 'SEND_FAILED',
      errorMessage: err.message,
      relatedBill: logContext.relatedBill,
      relatedOrder: logContext.relatedOrder,
      payload: payload || { subject, label, error: err.message },
      retryContext,
      isMock: false,
    });
    return { success: false, error: err.message, isMock: false, logId: log?._id };
  }
}

// ─────────────────────────────────────────────────────────
// HTML template helpers
// ─────────────────────────────────────────────────────────

const BRAND_ORANGE = '#e67e22';
const BRAND_DARK = '#d35400';

function shell({ heading, bodyHtml, ctaText, ctaUrl, footerExtra }) {
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${heading}</title></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif;color:#2c3e50;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" align="center" width="100%" style="max-width:600px;margin:24px auto;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
  <tr><td style="background:${BRAND_ORANGE};padding:16px 20px;color:#fff;">
    <div style="font-size:20px;font-weight:bold;letter-spacing:0.5px;">Shree Gopal MDF</div>
    <div style="font-size:12px;opacity:0.9;">Quality MDF Boards &amp; Custom Cutting</div>
  </td></tr>
  <tr><td style="padding:24px 20px;font-size:14px;line-height:1.55;">
    <h2 style="margin:0 0 12px 0;color:${BRAND_DARK};font-size:18px;">${heading}</h2>
    ${bodyHtml}
    ${ctaText && ctaUrl ? `
    <p style="text-align:center;margin:24px 0;">
      <a href="${ctaUrl}" style="background:${BRAND_ORANGE};color:#fff;text-decoration:none;padding:12px 24px;border-radius:4px;font-weight:bold;display:inline-block;">${ctaText}</a>
    </p>` : ''}
  </td></tr>
  <tr><td style="background:#f8f9fa;padding:16px 20px;font-size:11px;color:#7f8c8d;border-top:1px solid #ecf0f1;">
    ${footerExtra ? `<div style="margin-bottom:8px;">${footerExtra}</div>` : ''}
    Shree Gopal MDF · Indore, MP · For queries reply to this email.
  </td></tr>
</table></body></html>`;
}

function plainTextFallback({ heading, lines, ctaText, ctaUrl }) {
  const parts = [
    `Shree Gopal MDF`,
    ``,
    heading,
    ``,
    ...lines,
  ];
  if (ctaText && ctaUrl) {
    parts.push('', `${ctaText}: ${ctaUrl}`);
  }
  parts.push('', '---', 'Shree Gopal MDF, Indore, MP');
  return parts.join('\n');
}

function formatCurrency(amount) {
  if (amount === null || amount === undefined) return '';
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

// ─────────────────────────────────────────────────────────
// Public send functions
// ─────────────────────────────────────────────────────────

/**
 * Send bill email with PDF attachment (path-based, streamed by Nodemailer).
 */
exports.sendBillEmail = async ({ to, customerName, invoiceNo, amount, orderNo, pdfUrl, paymentLinkUrl, customer, relatedBill, relatedOrder }) => {
  const retryContext = {
    sendFn: 'sendBillEmail',
    args: { to, customerName, invoiceNo, amount, orderNo, pdfUrl, paymentLinkUrl, customer, relatedBill, relatedOrder },
  };
  const subject = `Invoice ${invoiceNo} from Shree Gopal MDF`;
  const heading = 'Your Invoice is Ready';
  const bodyHtml = `
    <p>Hi <strong>${customerName || 'Customer'}</strong>,</p>
    <p>Please find your invoice attached. A summary is below:</p>
    <table cellspacing="0" cellpadding="6" style="border-collapse:collapse;width:100%;background:#fafafa;border-radius:4px;margin:12px 0;">
      <tr><td style="font-weight:bold;width:140px;">Invoice No.</td><td>${invoiceNo || '-'}</td></tr>
      ${orderNo ? `<tr><td style="font-weight:bold;">Order No.</td><td>${orderNo}</td></tr>` : ''}
      <tr><td style="font-weight:bold;">Amount</td><td>&#8377; ${formatCurrency(amount)}</td></tr>
    </table>
    ${paymentLinkUrl ? '<p>Click below to pay securely:</p>' : '<p>The bill PDF is attached.</p>'}
  `;
  const text = plainTextFallback({
    heading,
    lines: [
      `Hi ${customerName || 'Customer'},`,
      `Invoice: ${invoiceNo}`,
      orderNo ? `Order: ${orderNo}` : '',
      `Amount: ₹${formatCurrency(amount)}`,
    ].filter(Boolean),
    ctaText: paymentLinkUrl ? 'Pay Now' : null,
    ctaUrl: paymentLinkUrl,
  });

  const attachments = [];
  if (pdfUrl && typeof pdfUrl === 'string') {
    attachments.push({
      filename: `${invoiceNo || 'invoice'}.pdf`,
      path: pdfUrl, // Nodemailer streams from URL or local path
    });
  }

  return sendMail({
    to,
    subject,
    html: shell({
      heading, bodyHtml,
      ctaText: paymentLinkUrl ? 'Pay Now' : null,
      ctaUrl: paymentLinkUrl,
    }),
    text,
    attachments,
    label: 'sendBillEmail',
    logType: 'BILL',
    logContext: { customer, relatedBill, relatedOrder },
    payload: { invoiceNo, amount, orderNo, hasPdf: !!pdfUrl, hasPaymentLink: !!paymentLinkUrl },
    retryContext,
  });
};

exports.sendPaymentLinkEmail = async ({ to, customerName, amount, invoiceNo, paymentLinkUrl, customer, relatedBill, relatedOrder }) => {
  const retryContext = {
    sendFn: 'sendPaymentLinkEmail',
    args: { to, customerName, amount, invoiceNo, paymentLinkUrl, customer, relatedBill, relatedOrder },
  };
  const subject = `Payment due — Invoice ${invoiceNo}`;
  const heading = 'Payment Pending';
  const bodyHtml = `
    <p>Hi <strong>${customerName || 'Customer'}</strong>,</p>
    <p>This is a friendly reminder that the following invoice is awaiting payment:</p>
    <table cellspacing="0" cellpadding="6" style="border-collapse:collapse;width:100%;background:#fef5e6;border-radius:4px;margin:12px 0;border-left:4px solid ${BRAND_ORANGE};">
      <tr><td style="font-weight:bold;width:140px;">Invoice No.</td><td>${invoiceNo || '-'}</td></tr>
      <tr><td style="font-weight:bold;">Amount Due</td><td><strong style="color:${BRAND_DARK};font-size:16px;">&#8377; ${formatCurrency(amount)}</strong></td></tr>
    </table>
    <p>Click the button below to pay securely online. Takes less than a minute.</p>
  `;
  const text = plainTextFallback({
    heading,
    lines: [
      `Hi ${customerName || 'Customer'},`,
      `Invoice ${invoiceNo} has an outstanding balance of ₹${formatCurrency(amount)}.`,
    ],
    ctaText: 'Pay Now',
    ctaUrl: paymentLinkUrl,
  });

  return sendMail({
    to,
    subject,
    html: shell({ heading, bodyHtml, ctaText: 'Pay Now', ctaUrl: paymentLinkUrl }),
    text,
    label: 'sendPaymentLinkEmail',
    logType: 'PAYMENT_LINK',
    logContext: { customer, relatedBill, relatedOrder },
    payload: { invoiceNo, amount, paymentLinkUrl },
    retryContext,
  });
};

exports.sendOrderReadyEmail = async ({ to, customerName, orderNo, total, customer, relatedOrder }) => {
  const retryContext = {
    sendFn: 'sendOrderReadyEmail',
    args: { to, customerName, orderNo, total, customer, relatedOrder },
  };
  const subject = `Order ${orderNo} ready`;
  const heading = 'Your Order is Ready';
  const bodyHtml = `
    <p>Hi <strong>${customerName || 'Customer'}</strong>,</p>
    <p>Good news — your order is ready for pickup or delivery.</p>
    <table cellspacing="0" cellpadding="6" style="border-collapse:collapse;width:100%;background:#fafafa;border-radius:4px;margin:12px 0;">
      <tr><td style="font-weight:bold;width:140px;">Order No.</td><td>${orderNo || '-'}</td></tr>
      ${total != null ? `<tr><td style="font-weight:bold;">Total</td><td>&#8377; ${formatCurrency(total)}</td></tr>` : ''}
    </table>
    <p>Please contact us to arrange pickup/delivery.</p>
  `;
  const text = plainTextFallback({
    heading,
    lines: [
      `Hi ${customerName || 'Customer'},`,
      `Your order ${orderNo} is ready.`,
      total != null ? `Total: ₹${formatCurrency(total)}` : '',
    ].filter(Boolean),
  });
  return sendMail({
    to, subject, html: shell({ heading, bodyHtml }), text,
    label: 'sendOrderReadyEmail',
    logType: 'ORDER_READY',
    logContext: { customer, relatedOrder },
    payload: { orderNo, total },
    retryContext,
  });
};

exports.sendOrderConfirmationEmail = async ({ to, customerName, orderNo, itemsSummary, estimatedReady, customer, relatedOrder }) => {
  const retryContext = {
    sendFn: 'sendOrderConfirmationEmail',
    args: { to, customerName, orderNo, itemsSummary, estimatedReady, customer, relatedOrder },
  };
  const subject = `Order ${orderNo} confirmed`;
  const heading = 'Order Confirmed';
  const bodyHtml = `
    <p>Hi <strong>${customerName || 'Customer'}</strong>,</p>
    <p>We've received your order. Here are the details:</p>
    <table cellspacing="0" cellpadding="6" style="border-collapse:collapse;width:100%;background:#fafafa;border-radius:4px;margin:12px 0;">
      <tr><td style="font-weight:bold;width:140px;">Order No.</td><td>${orderNo || '-'}</td></tr>
      ${itemsSummary ? `<tr><td style="font-weight:bold;">Items</td><td>${itemsSummary}</td></tr>` : ''}
      ${estimatedReady ? `<tr><td style="font-weight:bold;">Estimated Ready</td><td>${estimatedReady}</td></tr>` : ''}
    </table>
    <p>We'll notify you when your order is ready.</p>
  `;
  const text = plainTextFallback({
    heading,
    lines: [
      `Hi ${customerName || 'Customer'},`,
      `Order ${orderNo} confirmed.`,
      itemsSummary ? `Items: ${itemsSummary}` : '',
      estimatedReady ? `Estimated ready: ${estimatedReady}` : '',
    ].filter(Boolean),
  });
  return sendMail({
    to, subject, html: shell({ heading, bodyHtml }), text,
    label: 'sendOrderConfirmationEmail',
    logType: 'ORDER_CONFIRMATION',
    logContext: { customer, relatedOrder },
    payload: { orderNo, itemsSummary, estimatedReady },
    retryContext,
  });
};

exports.sendPaymentReceiptEmail = async ({ to, customerName, amount, invoiceNo, paymentMode, paymentDate, customer, relatedBill, relatedOrder }) => {
  const retryContext = {
    sendFn: 'sendPaymentReceiptEmail',
    args: { to, customerName, amount, invoiceNo, paymentMode, paymentDate, customer, relatedBill, relatedOrder },
  };
  const subject = `Payment received — ${invoiceNo || 'thank you'}`;
  const heading = 'Payment Received';
  const dateStr = paymentDate
    ? new Date(paymentDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : '';
  const bodyHtml = `
    <p>Hi <strong>${customerName || 'Customer'}</strong>,</p>
    <p>Thank you — we've received your payment.</p>
    <table cellspacing="0" cellpadding="6" style="border-collapse:collapse;width:100%;background:#d5f4e6;border-radius:4px;margin:12px 0;border-left:4px solid #27ae60;">
      <tr><td style="font-weight:bold;width:140px;">Amount</td><td><strong style="color:#27ae60;font-size:16px;">&#8377; ${formatCurrency(amount)}</strong></td></tr>
      ${invoiceNo ? `<tr><td style="font-weight:bold;">Invoice</td><td>${invoiceNo}</td></tr>` : ''}
      ${paymentMode ? `<tr><td style="font-weight:bold;">Method</td><td>${paymentMode}</td></tr>` : ''}
      ${dateStr ? `<tr><td style="font-weight:bold;">Date</td><td>${dateStr}</td></tr>` : ''}
    </table>
  `;
  const text = plainTextFallback({
    heading,
    lines: [
      `Hi ${customerName || 'Customer'},`,
      `Payment received: ₹${formatCurrency(amount)}`,
      invoiceNo ? `Invoice: ${invoiceNo}` : '',
      paymentMode ? `Method: ${paymentMode}` : '',
      dateStr ? `Date: ${dateStr}` : '',
    ].filter(Boolean),
  });
  return sendMail({
    to, subject, html: shell({ heading, bodyHtml }), text,
    label: 'sendPaymentReceiptEmail',
    logType: 'PAYMENT_RECEIPT',
    logContext: { customer, relatedBill, relatedOrder },
    payload: { invoiceNo, amount, paymentMode, paymentDate },
    retryContext,
  });
};
