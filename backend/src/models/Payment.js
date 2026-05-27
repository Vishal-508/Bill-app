const mongoose = require('mongoose');

/**
 * Payment Model — tracks gateway-based online payments (Razorpay).
 *
 * SCOPE:
 *   - Online payments only (UPI, Card, NetBanking, Wallet)
 *   - SEPARATE from Order.payments (which is manual cash/cheque tracking)
 *   - Webhook-driven status updates
 *   - Idempotent (payment can be retried, each attempt logged)
 *
 * LIFECYCLE:
 *   CREATED → ATTEMPTED → AUTHORIZED → CAPTURED [→ REFUNDED]
 *                                    ↓
 *                                  FAILED
 *
 * RELATIONSHIPS:
 *   - Required: order, customer
 *   - Optional: bill (set when payment receipt issued)
 */

const paymentEventSchema = new mongoose.Schema(
  {
    eventType: {
      type: String,
      enum: [
        'CREATED', 'ATTEMPTED', 'AUTHORIZED', 'CAPTURED', 'FAILED',
        'REFUND_INITIATED', 'REFUNDED', 'WEBHOOK_RECEIVED',
        'CANCELLED', 'NOTES_ADDED',
      ],
      required: true,
    },
    eventAt: { type: Date, default: Date.now },
    source: {
      type: String,
      enum: ['api', 'webhook', 'manual', 'system'],
      default: 'api',
    },
    razorpayEventId: String,
    payload: mongoose.Schema.Types.Mixed,
    notes: String,
  },
  { _id: true }
);

const paymentSchema = new mongoose.Schema(
  {
    paymentReference: {
      type: String,
      unique: true,
      required: true,
      index: true,
    },

    gateway: {
      type: String,
      enum: ['razorpay', 'manual', 'mock'],
      default: 'razorpay',
      index: true,
    },

    razorpayOrderId: { type: String, index: true, sparse: true },
    razorpayPaymentId: { type: String, index: true, sparse: true },
    razorpayRefundId: { type: String, sparse: true },
    razorpaySignature: String,

    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
      index: true,
    },
    orderNumber: { type: String, index: true },

    bill: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Bill',
      sparse: true,
      index: true,
    },
    billNumber: String,

    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: true,
      index: true,
    },
    customerSnapshot: {
      customerName: String,
      phone: String,
      email: String,
    },

    // Amounts stored in PAISE (Razorpay's smallest currency unit).
    // razorpayService.toPaise / toRupees handle conversion at the boundary.
    amount: { type: Number, required: true, min: 0 },
    amountRefunded: { type: Number, default: 0, min: 0 },
    currency: { type: String, default: 'INR' },

    status: {
      type: String,
      enum: ['CREATED', 'ATTEMPTED', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'REFUNDED', 'CANCELLED'],
      default: 'CREATED',
      index: true,
    },

    method: {
      type: String,
      enum: ['upi', 'card', 'netbanking', 'wallet', 'emi', 'other'],
    },
    methodDetails: {
      vpa: String,
      cardNetwork: String,
      cardLast4: String,
      bank: String,
      wallet: String,
    },

    attemptedAt: Date,
    authorizedAt: Date,
    capturedAt: Date,
    failedAt: Date,
    refundedAt: Date,

    failureCode: String,
    failureReason: String,
    failureSource: String,

    events: [paymentEventSchema],

    notes: String,
    internalNotes: String,
    metadata: mongoose.Schema.Types.Mixed,

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: Date,
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// ─── Indexes ───
paymentSchema.index({ order: 1, status: 1 });
paymentSchema.index({ customer: 1, createdAt: -1 });
paymentSchema.index({ status: 1, createdAt: -1 });

// ─── Virtuals ───
paymentSchema.virtual('isSuccessful').get(function () {
  return this.status === 'CAPTURED';
});

paymentSchema.virtual('isFinalized').get(function () {
  return ['CAPTURED', 'FAILED', 'REFUNDED', 'CANCELLED'].includes(this.status);
});

paymentSchema.virtual('netAmount').get(function () {
  return Math.max(0, this.amount - (this.amountRefunded || 0));
});

paymentSchema.set('toJSON', { virtuals: true });
paymentSchema.set('toObject', { virtuals: true });

// ─── Pre-save hooks ───
paymentSchema.pre('save', function (next) {
  if (this.isNew && (!this.events || this.events.length === 0)) {
    this.events = this.events || [];
    this.events.push({
      eventType: 'CREATED',
      eventAt: new Date(),
      source: 'api',
      notes: 'Payment record created',
    });
  }

  if (this.isModified('status')) {
    const now = new Date();
    if (this.status === 'ATTEMPTED' && !this.attemptedAt) this.attemptedAt = now;
    if (this.status === 'AUTHORIZED' && !this.authorizedAt) this.authorizedAt = now;
    if (this.status === 'CAPTURED' && !this.capturedAt) this.capturedAt = now;
    if (this.status === 'FAILED' && !this.failedAt) this.failedAt = now;
    if (this.status === 'REFUNDED' && !this.refundedAt) this.refundedAt = now;
  }

  next();
});

// ─── Instance methods ───
paymentSchema.methods.addEvent = function (eventType, options = {}) {
  this.events.push({
    eventType,
    eventAt: new Date(),
    source: options.source || 'api',
    razorpayEventId: options.razorpayEventId,
    payload: options.payload,
    notes: options.notes,
  });
};

paymentSchema.methods.markCaptured = async function (razorpayPaymentId, signature, options = {}) {
  this.razorpayPaymentId = razorpayPaymentId;
  this.razorpaySignature = signature;
  this.status = 'CAPTURED';
  if (options.method) this.method = options.method;
  if (options.methodDetails) this.methodDetails = options.methodDetails;
  this.addEvent('CAPTURED', {
    source: options.source || 'api',
    payload: options.payload,
    notes: options.notes,
  });
  return this.save();
};

paymentSchema.methods.markFailed = async function (code, reason, options = {}) {
  this.status = 'FAILED';
  this.failureCode = code;
  this.failureReason = reason;
  this.failureSource = options.source;
  this.addEvent('FAILED', {
    source: options.eventSource || 'api',
    notes: `${code}: ${reason}`,
    payload: options.payload,
  });
  return this.save();
};

module.exports = mongoose.model('Payment', paymentSchema);
