const mongoose = require('mongoose');
const { getFinancialYear } = require('../utils/orderNumberGenerator');

// ═══ Sub-schemas ═══

const dimensionsSchema = new mongoose.Schema(
  {
    lengthInches: { type: Number, min: 0 },
    widthInches: { type: Number, min: 0 },
    diameterInches: { type: Number, min: 0 },
    lengthDisplay: String,
    widthDisplay: String,
    areaSqInches: Number,
    areaSqFt: Number,
  },
  { _id: false }
);

const orderItemSchema = new mongoose.Schema(
  {
    itemType: {
      type: String,
      enum: ['FULL_SHEET', 'BUNDLE', 'CUSTOM_CUT'],
      required: true,
    },

    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },

    productSnapshot: {
      sku: String,
      name: String,
      productType: String,
      thicknessMM: Number,
      grade: String,
      brand: String,
    },

    fromRawSheet: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
    },

    dimensions: dimensionsSchema,

    shape: { type: mongoose.Schema.Types.ObjectId, ref: 'ShapeCuttingRate' },
    shapeSnapshot: {
      code: String,
      label: String,
      multiplier: Number,
    },

    cuttingRule: { type: mongoose.Schema.Types.ObjectId, ref: 'CuttingChargeRule' },
    cuttingRuleSnapshot: {
      code: String,
      mode: String,
      rate: Number,
    },

    quantity: { type: Number, required: true, min: 1 },

    pricePerUnit: { type: Number, required: true, min: 0 },
    materialCost: { type: Number, default: 0, min: 0 },
    cuttingCharges: { type: Number, default: 0, min: 0 },
    wastageAreaSqFt: { type: Number, default: 0, min: 0 },
    wastageCost: { type: Number, default: 0, min: 0 },

    discountPct: { type: Number, default: 0, min: 0, max: 100 },
    discountAmount: { type: Number, default: 0, min: 0 },

    lineSubtotal: { type: Number, required: true, min: 0 },

    notes: { type: String, trim: true, maxlength: 500 },
  },
  { _id: true, timestamps: false }
);

const statusHistorySchema = new mongoose.Schema(
  {
    status: String,
    changedAt: { type: Date, default: Date.now },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    notes: { type: String, trim: true },
  },
  { _id: false }
);

const paymentSchema = new mongoose.Schema(
  {
    amount: {
      type: Number,
      required: true,
      // No min constraint — negative values allowed for refund entries.
      // User-facing API validates positive via addPaymentSchema.
      // Only paymentService.processRefund creates negative entries.
    },
    mode: {
      type: String,
      enum: ['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'CHEQUE', 'CREDIT'],
      required: true,
    },
    reference: { type: String, trim: true, maxlength: 100 },
    paidAt: { type: Date, default: Date.now },
    receivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    notes: { type: String, trim: true, maxlength: 500 },
  },
  { _id: true, timestamps: false }
);

// ═══ Main Order Schema ═══

const orderSchema = new mongoose.Schema(
  {
    orderNumber: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    orderDate: { type: Date, default: Date.now, index: true },
    financialYear: { type: String },  // index defined explicitly below

    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: true,
      index: true,
    },
    customerSnapshot: {
      customerName: String,
      phone: String,
      companyName: String,
      gstin: String,
      billingState: String,
    },

    items: {
      type: [orderItemSchema],
      validate: {
        validator: (arr) => arr.length > 0,
        message: 'Order must have at least one item',
      },
    },

    subtotal: { type: Number, required: true, min: 0 },
    additionalCharges: { type: Number, default: 0, min: 0 },
    discountAmount: { type: Number, default: 0, min: 0 },
    taxableAmount: { type: Number, required: true, min: 0 },

    isIntraState: { type: Boolean, default: true },
    gstRatePct: { type: Number, default: 18, min: 0, max: 100 },
    cgst: { type: Number, default: 0, min: 0 },
    sgst: { type: Number, default: 0, min: 0 },
    igst: { type: Number, default: 0, min: 0 },
    totalGst: { type: Number, default: 0, min: 0 },

    totalAmount: { type: Number, required: true, min: 0 },

    billFormat: {
      type: String,
      enum: ['detailed', 'simple', 'minimal'],
      default: 'detailed',
    },
    hasGstBill: { type: Boolean, default: true },

    status: {
      type: String,
      enum: ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED',
             'CUTTING', 'BUNDLING', 'READY', 'DELIVERED'],
      default: 'PENDING',
      index: true,
    },
    statusHistory: { type: [statusHistorySchema], default: [] },

    cancelledAt: Date,
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    cancellationReason: { type: String, trim: true, maxlength: 500 },

    paymentMode: {
      type: String,
      enum: ['FULL_UPFRONT', 'PARTIAL', 'CREDIT'],
      default: 'FULL_UPFRONT',
    },
    paymentStatus: {
      type: String,
      enum: ['UNPAID', 'PARTIAL', 'PAID', 'REFUNDED'],
      default: 'UNPAID',
      index: true,
    },
    amountPaid: { type: Number, default: 0, min: 0 },
    amountDue: { type: Number, default: 0, min: 0 },
    payments: { type: [paymentSchema], default: [] },
    creditDueDate: Date,

    deliveryMethod: {
      type: String,
      enum: ['PICKUP', 'DELIVERY'],
      default: 'PICKUP',
    },
    deliveryAddress: {
      addressLine1: String,
      addressLine2: String,
      city: String,
      state: String,
      pincode: String,
    },
    expectedDeliveryDate: Date,
    actualDeliveryDate: Date,
    deliveryNotes: { type: String, trim: true, maxlength: 500 },

    bundles: [{
      bundleCode: String,
      itemIds: [mongoose.Schema.Types.ObjectId],
      totalPieces: Number,
      status: { type: String, default: 'PENDING' },
    }],

    customerNotes: { type: String, trim: true, maxlength: 2000 },
    internalNotes: { type: String, trim: true, maxlength: 2000 },

    tags: { type: [String], default: [] },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: Date,
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// ═══ Indexes ═══
orderSchema.index({ orderDate: -1 });
orderSchema.index({ customer: 1, orderDate: -1 });
orderSchema.index({ status: 1, isDeleted: 1 });
orderSchema.index({ paymentStatus: 1, isDeleted: 1 });
orderSchema.index({ financialYear: 1 });

// ═══ Pre-save ═══
orderSchema.pre('save', function (next) {
  // Compute financial year on create
  if (this.isNew && !this.financialYear) {
    this.financialYear = getFinancialYear(this.orderDate);
  }

  // Track status changes
  if (this.isModified('status') && !this.isNew) {
    this.statusHistory.push({
      status: this.status,
      changedAt: new Date(),
      changedBy: this._statusChangedByUser,
      notes: this._statusChangeNotes,
    });
  }

  // First status history entry on create
  if (this.isNew) {
    this.statusHistory.push({
      status: this.status,
      changedAt: new Date(),
      changedBy: this.createdBy,
      notes: 'Order created',
    });
  }

  // Handle REFUNDED state (negative net payment after refunds)
  // This check must come BEFORE the regular UNPAID/PARTIAL/PAID logic
  if (this.payments.some(p => p.amount < 0)) {
    const netPaid = this.payments.reduce((sum, p) => sum + p.amount, 0);
    if (netPaid <= 0.01) {
      this.paymentStatus = 'REFUNDED';
      this.amountDue = +(this.totalAmount - this.amountPaid).toFixed(2);
      return next();
    }
  }

  // Auto-calculate amountDue
  this.amountDue = +(this.totalAmount - this.amountPaid).toFixed(2);

  // Auto-set paymentStatus based on amount paid
  if (this.amountPaid <= 0) {
    this.paymentStatus = 'UNPAID';
  } else if (this.amountPaid >= this.totalAmount) {
    this.paymentStatus = 'PAID';
    this.amountDue = 0;
  } else {
    this.paymentStatus = 'PARTIAL';
  }

  next();
});

// ═══ Capture original for change tracking ═══
orderSchema.post('init', function () {
  this._original = this.toObject();
});

orderSchema.post('save', function () {
  this._original = this.toObject();
});

// ═══ Instance methods ═══

orderSchema.methods.canEdit = async function () {
  const SystemSetting = mongoose.model('SystemSetting');
  const lockStatus = await SystemSetting.getValue('ORDER_EDIT_LOCK_STATUS', 'COMPLETED');

  const statusOrder = ['PENDING', 'IN_PROGRESS', 'CUTTING', 'BUNDLING', 'READY', 'COMPLETED', 'DELIVERED'];
  const currentIndex = statusOrder.indexOf(this.status);
  const lockIndex = statusOrder.indexOf(lockStatus);

  if (this.status === 'CANCELLED') return false;
  return currentIndex < lockIndex;
};

orderSchema.methods.softDelete = async function (userId, reason) {
  this.isDeleted = true;
  this.deletedAt = new Date();
  this.deletedBy = userId;
  return this.save();
};

// ═══ Statics ═══

orderSchema.statics.findActive = function (filter = {}) {
  return this.find({ ...filter, isDeleted: false });
};

module.exports = mongoose.model('Order', orderSchema);
