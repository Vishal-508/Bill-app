const mongoose = require('mongoose');

/**
 * EmailLog — audit trail for all transactional emails (Prompt 7 Section F).
 *
 * Mirrors WhatsAppLog patterns for consistency:
 *   - Same status enum (SENT/FAILED/BOUNCED, with PERMANENTLY_FAILED for retry cron in G)
 *   - Same retry tracking
 *   - Same isMock flag
 *   - Same relatedBill / relatedOrder sparse refs
 *
 * Created by emailService on every send (regardless of success).
 */

const emailLogSchema = new mongoose.Schema(
  {
    to: { type: String, required: true, lowercase: true, trim: true, index: true },

    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      sparse: true,
      index: true,
    },

    type: {
      type: String,
      enum: ['BILL', 'PAYMENT_LINK', 'ORDER_CONFIRMATION', 'ORDER_READY', 'PAYMENT_RECEIPT', 'TEXT'],
      required: true,
      index: true,
    },

    subject: { type: String, trim: true, maxlength: 500 },

    // Nodemailer's returned message ID (real) or mock_<timestamp> (mock mode)
    emailMessageId: { type: String, index: true, sparse: true },

    status: {
      type: String,
      enum: ['SENT', 'FAILED', 'BOUNCED', 'PERMANENTLY_FAILED'],
      default: 'SENT',
      index: true,
    },

    errorCode: String,
    errorMessage: String,

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

    retryCount: { type: Number, default: 0 },
    lastRetryAt: Date,
    nextRetryAt: { type: Date, index: true },
    permanentlyFailedAt: Date,
    alertSent: { type: Boolean, default: false },
    // Stores { sendFn, args } so the retry cron can re-invoke the original
    // emailService call. Populated by sendMail() at send time.
    retryContext: { type: mongoose.Schema.Types.Mixed },

    sentAt: { type: Date, default: Date.now },
    deliveredAt: Date,

    // Full request body for audit/debug
    payload: { type: mongoose.Schema.Types.Mixed },

    isMock: { type: Boolean, default: false, index: true },
  },
  { timestamps: true }
);

// Compound indexes
emailLogSchema.index({ customer: 1, createdAt: -1 });
emailLogSchema.index({ status: 1, type: 1, createdAt: -1 });
emailLogSchema.index({ relatedBill: 1, type: 1 });
// Retry-cron query
emailLogSchema.index({ status: 1, nextRetryAt: 1 });

emailLogSchema.methods.applyStatusUpdate = function (newStatus, errorCode, errorMessage) {
  this.status = newStatus;
  if (errorCode) this.errorCode = errorCode;
  if (errorMessage) this.errorMessage = errorMessage;
  if (newStatus === 'BOUNCED') this.deliveredAt = undefined;
  return this.save();
};

module.exports = mongoose.model('EmailLog', emailLogSchema);
