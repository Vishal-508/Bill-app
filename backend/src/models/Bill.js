const mongoose = require('mongoose');

/**
 * Bill (Invoice) — Customer-facing legal document for an Order.
 *
 * Design principles:
 *   1. Snapshot pattern — captures Order/Customer/Business state at issue time
 *   2. Immutable once FINALIZED — corrections via revisions, not edits
 *   3. Separate numbering from Orders (legal document)
 *   4. Multiple formats supported (detailed, simple, minimal)
 *   5. Multi-language ready (English, Hindi)
 */

// ─── Customer snapshot (legal record) ───
const customerInfoSchema = new mongoose.Schema(
  {
    customerName: { type: String, required: true },
    companyName: String,
    phone: String,
    email: String,
    gstin: String,
    billingAddress: {
      addressLine1: String,
      addressLine2: String,
      city: String,
      state: String,
      pincode: String,
    },
    shippingAddress: {
      addressLine1: String,
      addressLine2: String,
      city: String,
      state: String,
      pincode: String,
    },
  },
  { _id: false }
);

// ─── Business snapshot (issuer info) ───
const businessInfoSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    address: String,
    phone: String,
    email: String,
    gstin: String,
    state: String,
    bankDetails: String,
  },
  { _id: false }
);

// ─── Line item snapshot ───
const billLineItemSchema = new mongoose.Schema(
  {
    serialNo: Number,
    description: String,
    hsnCode: String,
    itemType: String,

    productSku: String,
    productName: String,

    dimensions: {
      lengthInches: Number,
      widthInches: Number,
      display: String,
    },

    quantity: Number,
    unit: String,
    pricePerUnit: Number,

    materialCost: { type: Number, default: 0 },
    cuttingCharges: { type: Number, default: 0 },

    discountPct: { type: Number, default: 0 },
    discountAmount: { type: Number, default: 0 },

    taxableAmount: Number,
    gstRatePct: Number,
    cgst: { type: Number, default: 0 },
    sgst: { type: Number, default: 0 },
    igst: { type: Number, default: 0 },

    lineTotal: Number,

    notes: String,
  },
  { _id: false }
);

// ─── Bill event (audit trail) ───
const billEventSchema = new mongoose.Schema(
  {
    eventType: {
      type: String,
      enum: [
        'CREATED', 'FINALIZED', 'SENT', 'PRINTED', 'EMAILED', 'WHATSAPPED',
        'REVISED', 'CANCELLED',
        'CUSTOMER_SIGNED', 'ISSUER_SIGNED', 'SIGNATURE_CLEARED',
      ],
      required: true,
    },
    eventAt: { type: Date, default: Date.now },
    performedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    metadata: mongoose.Schema.Types.Mixed,
    notes: String,
  },
  { _id: true }
);

// ─── Main Bill schema ───
const billSchema = new mongoose.Schema(
  {
    billNumber: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    fiscalYear: { type: String, index: true },

    order: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order',
      required: true,
      index: true,
    },
    orderNumber: { type: String, index: true },

    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: true,
      index: true,
    },

    parentBill: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Bill',
      default: null,
    },
    revisionNumber: { type: Number, default: 0 },
    isLatestRevision: { type: Boolean, default: true, index: true },

    issueDate: { type: Date, default: Date.now, index: true },
    dueDate: Date,

    status: {
      type: String,
      enum: ['DRAFT', 'FINALIZED', 'SENT', 'PAID', 'CANCELLED'],
      default: 'DRAFT',
      index: true,
    },

    format: {
      type: String,
      enum: ['detailed', 'simple', 'minimal'],
      default: 'detailed',
    },
    language: { type: String, enum: ['en', 'hi'], default: 'en' },
    hasGst: { type: Boolean, default: true },

    customerInfo: { type: customerInfoSchema, required: true },
    businessInfo: { type: businessInfoSchema, required: true },

    items: [billLineItemSchema],

    subtotal: { type: Number, required: true, default: 0 },
    totalDiscount: { type: Number, default: 0 },
    additionalCharges: { type: Number, default: 0 },
    taxableAmount: { type: Number, default: 0 },

    isIntraState: { type: Boolean, default: true },
    totalCgst: { type: Number, default: 0 },
    totalSgst: { type: Number, default: 0 },
    totalIgst: { type: Number, default: 0 },
    totalGst: { type: Number, default: 0 },

    roundOff: { type: Number, default: 0 },
    grandTotal: { type: Number, required: true, default: 0 },
    amountInWords: String,

    amountPaid: { type: Number, default: 0 },
    amountDue: { type: Number, default: 0 },
    paymentStatus: {
      type: String,
      enum: ['UNPAID', 'PARTIAL', 'PAID', 'REFUNDED'],
      default: 'UNPAID',
    },

    deliveryMethod: String,
    transportDetails: String,
    vehicleNumber: String,
    placeOfSupply: String,

    notesToCustomer: String,
    internalNotes: String,
    termsAndConditions: String,

    pdfPath: String,
    pdfGeneratedAt: Date,
    pdfSizeBytes: Number,

    customerSignature: {
      signatureImage: String,
      signedAt: Date,
      signedByName: String,
    },
    issuerSignature: {
      signatureImage: String,
      signedByUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    },

    events: { type: [billEventSchema], default: [] },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    finalizedAt: Date,
    finalizedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    cancelledAt: Date,
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    cancellationReason: String,

    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: Date,
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// ─── Indexes ───
billSchema.index({ order: 1, isLatestRevision: 1 });
billSchema.index({ customer: 1, issueDate: -1 });
billSchema.index({ status: 1, issueDate: -1 });
billSchema.index({ paymentStatus: 1 });
billSchema.index({ isDeleted: 1, status: 1 });

// ─── Virtuals ───
billSchema.virtual('isEditable').get(function () {
  return this.status === 'DRAFT' && !this.isDeleted;
});

billSchema.virtual('totalItems').get(function () {
  return this.items?.length || 0;
});

billSchema.set('toJSON', { virtuals: true });
billSchema.set('toObject', { virtuals: true });

// ─── Pre-save ───
billSchema.pre('save', function (next) {
  this.amountDue = +(this.grandTotal - this.amountPaid).toFixed(2);

  if (this.amountPaid <= 0) {
    this.paymentStatus = 'UNPAID';
  } else if (this.amountPaid >= this.grandTotal - 0.01) {
    this.paymentStatus = 'PAID';
  } else {
    this.paymentStatus = 'PARTIAL';
  }

  if (this.isNew && this.events.length === 0) {
    this.events.push({
      eventType: 'CREATED',
      eventAt: new Date(),
      performedBy: this.createdBy,
      notes: 'Bill draft created',
    });
  }

  next();
});

// ─── Instance methods ───
billSchema.methods.finalize = async function (userId, notes) {
  if (this.status !== 'DRAFT') {
    throw new Error(`Cannot finalize bill in status '${this.status}'`);
  }

  this.status = 'FINALIZED';
  this.finalizedAt = new Date();
  this.finalizedBy = userId;

  this.events.push({
    eventType: 'FINALIZED',
    eventAt: new Date(),
    performedBy: userId,
    notes: notes || 'Bill finalized',
  });

  return await this.save();
};

billSchema.methods.markSent = async function (userId, channel, notes) {
  if (!['FINALIZED', 'SENT'].includes(this.status)) {
    throw new Error('Bill must be FINALIZED before sending');
  }

  this.status = 'SENT';

  const eventTypeMap = { email: 'EMAILED', whatsapp: 'WHATSAPPED' };
  const eventType = eventTypeMap[channel] || 'PRINTED';

  this.events.push({
    eventType,
    eventAt: new Date(),
    performedBy: userId,
    metadata: { channel },
    notes: notes || `Bill sent via ${channel}`,
  });

  return await this.save();
};

billSchema.methods.cancel = async function (userId, reason) {
  if (this.status === 'CANCELLED') {
    throw new Error('Bill already cancelled');
  }

  this.status = 'CANCELLED';
  this.cancelledAt = new Date();
  this.cancelledBy = userId;
  this.cancellationReason = reason;

  this.events.push({
    eventType: 'CANCELLED',
    eventAt: new Date(),
    performedBy: userId,
    notes: `Cancelled: ${reason}`,
  });

  return await this.save();
};

billSchema.methods.softDelete = async function (userId, reason) {
  this.isDeleted = true;
  this.deletedAt = new Date();
  this.deletedBy = userId;
  if (reason) this.internalNotes = `${this.internalNotes || ''}\nDeleted: ${reason}`;

  return await this.save();
};

module.exports = mongoose.model('Bill', billSchema);
