const mongoose = require('mongoose');

/**
 * WhatsAppLog — audit trail for all WhatsApp Cloud API messages.
 *
 * Scope:
 *   - Outbound: bill, payment link, order confirmation, order ready, free-text
 *   - Inbound: customer replies (during 24h service window)
 *
 * Lifecycle (outbound):
 *   SENT → DELIVERED → READ
 *   SENT → FAILED  (terminal until retry)
 *
 * Status transitions driven by Meta webhook events
 * (messages.statuses[] in webhook payload).
 */

const whatsAppLogSchema = new mongoose.Schema(
  {
    // Phone number (always normalized to 91XXXXXXXXXX form)
    to: { type: String, required: true, index: true },

    // Customer link (sparse — inbound from unknown numbers won't have it)
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      sparse: true,
      index: true,
    },

    // Message classification
    type: {
      type: String,
      enum: ['BILL', 'PAYMENT_LINK', 'ORDER_CONFIRMATION', 'ORDER_READY', 'TEXT', 'INBOUND'],
      required: true,
      index: true,
    },

    // Approved template name (for outbound templated messages)
    templateName: { type: String },

    // Meta's message ID — "wamid.XXXXX" (real) or "wamid.mock_XXXX" (mock mode)
    waMessageId: { type: String, index: true, sparse: true },

    // Full request/response/inbound body for debugging
    payload: { type: mongoose.Schema.Types.Mixed },

    // Delivery state
    status: {
      type: String,
      enum: ['SENT', 'DELIVERED', 'READ', 'FAILED', 'PERMANENTLY_FAILED'],
      default: 'SENT',
      index: true,
    },
    statusUpdatedAt: { type: Date, default: Date.now },

    // Error info (when status=FAILED)
    errorCode: String,
    errorMessage: String,

    // Related business entities (sparse)
    relatedBill: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Bill',
      sparse: true,
      index: true,
    },
    relatedOrder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      sparse: true,
      index: true,
    },

    // Retry tracking (Section G cron)
    retryCount: { type: Number, default: 0 },
    lastRetryAt: Date,
    nextRetryAt: { type: Date, index: true },
    permanentlyFailedAt: Date,
    alertSent: { type: Boolean, default: false },
    // Stores { sendFn, args } so the retry cron can re-invoke the original
    // service call. Populated by callers at send time.
    retryContext: { type: mongoose.Schema.Types.Mixed },

    // Mock mode flag (so audit trail distinguishes test data)
    isMock: { type: Boolean, default: false, index: true },

    // Audit
    sentBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// Compound indexes for common queries
whatsAppLogSchema.index({ customer: 1, createdAt: -1 });
whatsAppLogSchema.index({ status: 1, type: 1, createdAt: -1 });
whatsAppLogSchema.index({ relatedBill: 1, type: 1 });
// Retry-cron query: pick up FAILED + ready-to-retry rows quickly
whatsAppLogSchema.index({ status: 1, nextRetryAt: 1 });

// Instance helper: mark status from webhook
whatsAppLogSchema.methods.applyStatusUpdate = function (newStatus, errorCode, errorMessage) {
  this.status = newStatus;
  this.statusUpdatedAt = new Date();
  if (errorCode) this.errorCode = errorCode;
  if (errorMessage) this.errorMessage = errorMessage;
  return this.save();
};

module.exports = mongoose.model('WhatsAppLog', whatsAppLogSchema);
