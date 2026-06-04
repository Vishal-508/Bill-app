const mongoose = require('mongoose');

/**
 * Vendor — supplier for raw MDF sheets / bundles.
 *
 * Scope:
 *   - Captures vendor identity for Purchase Orders + analytics
 *   - Tracks which products this vendor typically supplies
 *   - Soft-delete pattern (consistent with Customer/Product)
 *   - GSTIN validated to Indian 15-char format (same regex as Customer)
 */

const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[0-9A-Z]{1}Z[0-9A-Z]{1}$/;
const PINCODE_REGEX = /^[1-9][0-9]{5}$/;
const PHONE_REGEX = /^[6-9]\d{9}$/;

const vendorAddressSchema = new mongoose.Schema(
  {
    line1: { type: String, trim: true, maxlength: 200 },
    line2: { type: String, trim: true, maxlength: 200 },
    city: { type: String, trim: true, maxlength: 100 },
    state: { type: String, trim: true, maxlength: 100 },
    stateCode: { type: String, trim: true, maxlength: 5 },
    pincode: {
      type: String,
      trim: true,
      validate: {
        validator: (v) => !v || PINCODE_REGEX.test(v),
        message: 'Invalid pincode (must be 6 digits starting 1-9)',
      },
    },
  },
  { _id: false }
);

const vendorSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Vendor name is required'],
      trim: true,
      minlength: 2,
      maxlength: 200,
      index: true,
    },
    companyName: { type: String, trim: true, maxlength: 200 },

    phone: {
      type: String,
      trim: true,
      validate: {
        validator: (v) => !v || PHONE_REGEX.test(v),
        message: 'Phone must be a valid 10-digit Indian mobile number',
      },
    },
    email: {
      type: String,
      lowercase: true,
      trim: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Invalid email format'],
    },
    gstin: {
      type: String,
      uppercase: true,
      trim: true,
      validate: {
        validator: (v) => !v || GSTIN_REGEX.test(v),
        message: 'Invalid GSTIN format (must be 15 chars)',
      },
    },

    address: { type: vendorAddressSchema, default: () => ({}) },

    // Products this vendor typically supplies — informational, helps PO wizard
    products: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
    }],

    avgLeadTimeDays: { type: Number, min: 0, max: 365, default: 7 },
    paymentTerms: { type: String, trim: true, maxlength: 100, default: 'Net 30' },

    notes: { type: String, trim: true, maxlength: 2000 },

    isActive: { type: Boolean, default: true, index: true },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: Date,
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// Sparse unique on GSTIN (consistent with Customer pattern)
vendorSchema.index({ gstin: 1 }, { unique: true, sparse: true });
vendorSchema.index({ name: 'text', companyName: 'text' });
vendorSchema.index({ isActive: 1, isDeleted: 1 });

vendorSchema.methods.softDelete = async function (userId) {
  this.isDeleted = true;
  this.deletedAt = new Date();
  this.deletedBy = userId;
  this.isActive = false;
  return this.save();
};

vendorSchema.methods.restore = async function () {
  this.isDeleted = false;
  this.deletedAt = null;
  this.deletedBy = null;
  this.isActive = true;
  return this.save();
};

module.exports = mongoose.model('Vendor', vendorSchema);
