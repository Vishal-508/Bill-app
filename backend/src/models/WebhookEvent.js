const mongoose = require('mongoose');

/**
 * WebhookEvent — audit trail for all incoming webhooks.
 *
 * PURPOSE:
 *   1. Idempotency: prevent duplicate processing of same event
 *   2. Audit: log every webhook for compliance/debugging
 *   3. Replay: re-process failed events manually
 *   4. Investigation: troubleshoot payment issues
 */

const webhookEventSchema = new mongoose.Schema(
  {
    razorpayEventId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    eventType: {
      type: String,
      required: true,
      index: true,
    },

    receivedAt: { type: Date, default: Date.now, index: true },
    processedAt: Date,
    eventTimestamp: Date,

    status: {
      type: String,
      enum: ['RECEIVED', 'PROCESSED', 'FAILED', 'DUPLICATE', 'INVALID_SIGNATURE'],
      default: 'RECEIVED',
      index: true,
    },

    signatureValid: Boolean,
    signatureProvided: String,

    payment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Payment',
      sparse: true,
    },
    paymentReference: String,
    razorpayPaymentId: { type: String, sparse: true, index: true },
    razorpayOrderId: { type: String, sparse: true },
    razorpayRefundId: { type: String, sparse: true },

    payload: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },

    processingError: String,
    processingDurationMs: Number,
    actionsTaken: [String],

    retryCount: { type: Number, default: 0 },
    lastRetryAt: Date,

    sourceIp: String,
    userAgent: String,
  },
  { timestamps: true }
);

webhookEventSchema.index({ eventType: 1, receivedAt: -1 });
webhookEventSchema.index({ status: 1, receivedAt: -1 });

webhookEventSchema.methods.markProcessed = function (actions = []) {
  this.status = 'PROCESSED';
  this.processedAt = new Date();
  this.actionsTaken = actions;
  return this.save();
};

webhookEventSchema.methods.markFailed = function (error) {
  this.status = 'FAILED';
  this.processedAt = new Date();
  this.processingError = error?.message || String(error);
  return this.save();
};

module.exports = mongoose.model('WebhookEvent', webhookEventSchema);
