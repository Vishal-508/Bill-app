const mongoose = require('mongoose');
const { generatePurchaseNumber } = require('../utils/purchaseNumberGenerator');

/**
 * Purchase — Purchase Order issued to a Vendor for raw MDF sheets / bundles.
 *
 * Lifecycle:
 *   DRAFT → ORDERED → RECEIVED        (happy path)
 *           ORDERED → PARTIAL_RECEIVED → RECEIVED  (multi-shipment)
 *           any → CANCELLED
 *
 * On RECEIVED (or PARTIAL_RECEIVED): controller creates StockMovement
 * (type=RESTOCK) entries per line item and bumps Product.currentStock.
 *
 * Note: the existing StockMovement enum is reused (RESTOCK semantic
 * already covers PO receive). See codebase_stock_model_conventions memory.
 */

const purchaseItemSchema = new mongoose.Schema(
  {
    product: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    // Captured at create time so PO history survives product edits/deletes
    productSnapshot: {
      sku: String,
      name: String,
      productType: String,
      thicknessMM: Number,
      sizeDisplay: String,
    },

    quantity: { type: Number, required: true, min: 1 },
    ratePerSheet: { type: Number, required: true, min: 0 },
    totalAmount: { type: Number, required: true, min: 0 },

    // For partial receipts: how many of `quantity` have actually arrived
    receivedQuantity: { type: Number, default: 0, min: 0 },

    notes: { type: String, trim: true, maxlength: 500 },
  },
  { _id: true }
);

const purchaseSchema = new mongoose.Schema(
  {
    purchaseNo: {
      type: String,
      unique: true,
      index: true,
      // Auto-generated in pre-validate hook
    },
    fiscalYear: { type: String, index: true },

    vendor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vendor',
      required: true,
      index: true,
    },
    // Snapshot of vendor identity at PO creation time
    vendorSnapshot: {
      name: String,
      companyName: String,
      phone: String,
      gstin: String,
    },

    items: {
      type: [purchaseItemSchema],
      validate: {
        validator: (arr) => arr.length > 0,
        message: 'Purchase must have at least one line item',
      },
    },

    subTotal: { type: Number, default: 0, min: 0 },
    gstRatePct: { type: Number, default: 18, min: 0, max: 100 },
    gstAmount: { type: Number, default: 0, min: 0 },
    grandTotal: { type: Number, default: 0, min: 0 },

    status: {
      type: String,
      enum: ['DRAFT', 'ORDERED', 'PARTIAL_RECEIVED', 'RECEIVED', 'CANCELLED'],
      default: 'DRAFT',
      index: true,
    },

    orderedAt: Date,
    expectedAt: Date,
    receivedAt: Date,
    cancelledAt: Date,

    // Vendor's invoice number (when they send the goods)
    invoiceNo: { type: String, trim: true, maxlength: 100 },

    paymentStatus: {
      type: String,
      enum: ['UNPAID', 'PARTIAL', 'PAID'],
      default: 'UNPAID',
      index: true,
    },
    amountPaid: { type: Number, default: 0, min: 0 },

    notes: { type: String, trim: true, maxlength: 2000 },
    cancellationReason: { type: String, trim: true, maxlength: 500 },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    orderedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    receivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// Compound indexes for common queries
purchaseSchema.index({ vendor: 1, createdAt: -1 });
purchaseSchema.index({ status: 1, createdAt: -1 });
purchaseSchema.index({ paymentStatus: 1, status: 1 });

// Pre-validate: assign purchaseNo + fiscalYear before validation runs
// (using pre-validate so unique:true on purchaseNo can verify the value)
purchaseSchema.pre('validate', async function (next) {
  try {
    if (!this.purchaseNo) {
      this.purchaseNo = await generatePurchaseNumber();
    }
    if (!this.fiscalYear) {
      const { getFinancialYear } = require('../utils/orderNumberGenerator');
      this.fiscalYear = getFinancialYear();
    }
    next();
  } catch (err) {
    next(err);
  }
});

// Pre-save: recompute totals from items (defensive — controllers should
// also compute but this guards against direct .save() callers)
purchaseSchema.pre('save', function (next) {
  if (this.isModified('items') || this.isNew) {
    this.subTotal = this.items.reduce((acc, it) => acc + (it.totalAmount || 0), 0);
    this.gstAmount = +(this.subTotal * (this.gstRatePct / 100)).toFixed(2);
    this.grandTotal = +(this.subTotal + this.gstAmount).toFixed(2);
  }
  next();
});

module.exports = mongoose.model('Purchase', purchaseSchema);
