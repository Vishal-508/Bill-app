const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// Indian GSTIN format: 22AAAAA0000A1Z5
const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[0-9A-Z]{1}Z[0-9A-Z]{1}$/;
const PINCODE_REGEX = /^[1-9][0-9]{5}$/;
const PHONE_REGEX = /^[6-9]\d{9}$/;

// State codes for GST (2-digit Indian state codes)
const STATE_CODES = {
  'Andhra Pradesh': '28', 'Arunachal Pradesh': '12', 'Assam': '18',
  'Bihar': '10', 'Chhattisgarh': '22', 'Goa': '30', 'Gujarat': '24',
  'Haryana': '06', 'Himachal Pradesh': '02', 'Jharkhand': '20',
  'Karnataka': '29', 'Kerala': '32', 'Madhya Pradesh': '23',
  'Maharashtra': '27', 'Manipur': '14', 'Meghalaya': '17',
  'Mizoram': '15', 'Nagaland': '13', 'Odisha': '21', 'Punjab': '03',
  'Rajasthan': '08', 'Sikkim': '11', 'Tamil Nadu': '33',
  'Telangana': '36', 'Tripura': '16', 'Uttar Pradesh': '09',
  'Uttarakhand': '05', 'West Bengal': '19',
  'Andaman and Nicobar Islands': '35', 'Chandigarh': '04',
  'Dadra and Nagar Haveli and Daman and Diu': '26', 'Delhi': '07',
  'Jammu and Kashmir': '01', 'Ladakh': '38', 'Lakshadweep': '31',
  'Puducherry': '34',
};

const addressSubSchema = new mongoose.Schema(
  {
    line1: { type: String, trim: true, maxlength: 200 },
    line2: { type: String, trim: true, maxlength: 200 },
    landmark: { type: String, trim: true, maxlength: 100 },
    city: { type: String, trim: true, maxlength: 100 },
    state: { type: String, trim: true, maxlength: 100 },
    stateCode: { type: String, trim: true, maxlength: 2 },
    pincode: {
      type: String,
      trim: true,
      validate: {
        validator: (v) => !v || PINCODE_REGEX.test(v),
        message: 'Invalid Indian pincode',
      },
    },
    country: { type: String, default: 'India', trim: true },
  },
  { _id: false }
);

const customerSchema = new mongoose.Schema(
  {
    // ═══ Identity ═══
    companyName: {
      type: String,
      trim: true,
      maxlength: 200,
      index: true,
    },
    customerName: {
      type: String,
      required: [true, 'Customer name is required'],
      trim: true,
      minlength: 2,
      maxlength: 100,
      index: true,
    },
    phone: {
      type: String,
      required: [true, 'Phone is required'],
      unique: true,
      trim: true,
      match: [PHONE_REGEX, 'Phone must be a valid 10-digit Indian mobile'],
      index: true,
    },
    altPhone: {
      type: String,
      trim: true,
      validate: {
        validator: (v) => !v || PHONE_REGEX.test(v),
        message: 'Alt phone must be a valid 10-digit Indian mobile',
      },
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      validate: {
        validator: (v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
        message: 'Invalid email format',
      },
    },

    // ═══ Business Info (Editable Segments!) ═══
    businessSegment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BusinessSegment',
      index: true,
    },
    businessSubSegment: {
      type: String,
      trim: true,
      maxlength: 200,
    },
    businessSize: {
      type: String,
      enum: ['INDIVIDUAL', 'SMALL', 'MEDIUM', 'LARGE'],
      default: 'INDIVIDUAL',
      index: true,
    },
    gstin: {
      type: String,
      uppercase: true,
      trim: true,
      validate: {
        validator: (v) => !v || GSTIN_REGEX.test(v),
        message: 'Invalid GSTIN format (must be 15 chars: 22AAAAA0000A1Z5)',
      },
    },

    // ═══ Acquisition Tracking ═══
    acquisitionSource: {
      type: String,
      enum: [
        'WALK_IN', 'REFERRAL', 'GOOGLE', 'JUSTDIAL', 'INDIAMART',
        'WHATSAPP', 'SOCIAL_MEDIA', 'EXHIBITION', 'EXISTING_CUSTOMER',
        'PHONE_INQUIRY', 'OTHER',
      ],
      default: 'WALK_IN',
      index: true,
    },
    referredBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
    },

    // ═══ Addresses ═══
    billingAddress: addressSubSchema,
    shippingAddress: addressSubSchema,
    shippingSameAsBilling: { type: Boolean, default: true },

    // ═══ Tags (Multi-Label) ═══
    tags: {
      type: [String],
      default: [],
      validate: {
        validator: (arr) => arr.length <= 10,
        message: 'Maximum 10 tags allowed per customer',
      },
    },

    // ═══ Pricing & Credit ═══
    preferredUnit: {
      type: String,
      enum: ['sqft', 'sqinch', 'sheet'],
      default: 'sqft',
    },
    specialDiscountPct: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    creditLimit: {
      type: Number,
      default: 0,
      min: 0,
    },
    currentDues: {
      type: Number,
      default: 0,
      min: 0,
    },

    // ═══ Auto-Computed Purchase Insights ═══
    purchaseInsights: {
      totalOrders: { type: Number, default: 0 },
      totalRevenue: { type: Number, default: 0 },
      lifetimeValue: { type: Number, default: 0 },
      avgOrderValue: { type: Number, default: 0 },
      firstOrderDate: Date,
      lastOrderDate: Date,
      avgDaysBetweenOrders: Number,
      mostBoughtProduct: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
      },
      mostBoughtThicknessMM: Number,
      mostBoughtQty: Number,
      suggestedBundles: { type: [Number], default: [] },
      lastComputedAt: Date,
    },

    // ═══ Communication Preferences ═══
    communicationPrefs: {
      whatsappEnabled: { type: Boolean, default: true },
      emailEnabled: { type: Boolean, default: true },
      smsEnabled: { type: Boolean, default: false },
      callPreferredTime: { type: String, trim: true, maxlength: 50 },
    },

    // ═══ Customer Self-Service (for future Prompt 14) ═══
    passwordHash: {
      type: String,
      select: false,
    },

    // ═══ System Fields ═══
    isActive: { type: Boolean, default: true, index: true },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: Date,
    deletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    deletionReason: { type: String, trim: true, maxlength: 500 },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    notes: { type: String, trim: true, maxlength: 2000 },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (doc, ret) => {
        delete ret.passwordHash;
        delete ret.__v;
        return ret;
      },
    },
  }
);

// ═══ Indexes (for fast queries) ═══
customerSchema.index({ customerName: 'text', companyName: 'text' });
customerSchema.index({ phone: 1, isDeleted: 1 });
customerSchema.index({ businessSegment: 1, isActive: 1, isDeleted: 1 });
customerSchema.index({ createdAt: -1 });
customerSchema.index({ 'purchaseInsights.lifetimeValue': -1 });
customerSchema.index({ tags: 1 });

// Sparse unique on email (allows multiple null but unique when present)
customerSchema.index({ email: 1 }, { unique: true, sparse: true });

// Sparse unique on GSTIN
customerSchema.index({ gstin: 1 }, { unique: true, sparse: true });

// ═══ Pre-save: Hash password if modified ═══
customerSchema.pre('save', async function (next) {
  if (!this.isModified('passwordHash')) return next();
  try {
    if (this.passwordHash.startsWith('$2a$') || this.passwordHash.startsWith('$2b$')) {
      return next();
    }
    const salt = await bcrypt.genSalt(12);
    this.passwordHash = await bcrypt.hash(this.passwordHash, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// ═══ Pre-save: Auto-fill stateCode if state provided ═══
customerSchema.pre('save', function (next) {
  if (this.billingAddress?.state && !this.billingAddress?.stateCode) {
    this.billingAddress.stateCode = STATE_CODES[this.billingAddress.state] || '';
  }
  if (this.shippingAddress?.state && !this.shippingAddress?.stateCode) {
    this.shippingAddress.stateCode = STATE_CODES[this.shippingAddress.state] || '';
  }
  next();
});

// ═══ Pre-save: Copy billing to shipping if same flag ═══
customerSchema.pre('save', function (next) {
  if (this.shippingSameAsBilling && this.billingAddress) {
    this.shippingAddress = this.billingAddress;
  }
  next();
});

// ═══ Virtual: 'password' setter ═══
customerSchema.virtual('password').set(function (plain) {
  this.passwordHash = plain;
});

// ═══ Instance Method: Compare password ═══
customerSchema.methods.comparePassword = async function (plain) {
  if (!this.passwordHash) return false;
  return bcrypt.compare(plain, this.passwordHash);
};

// ═══ Instance Method: Soft delete ═══
customerSchema.methods.softDelete = async function (userId, reason) {
  this.isDeleted = true;
  this.deletedAt = new Date();
  this.deletedBy = userId;
  this.deletionReason = reason;
  this.isActive = false;
  return this.save();
};

// ═══ Instance Method: Restore ═══
customerSchema.methods.restore = async function () {
  this.isDeleted = false;
  this.deletedAt = null;
  this.deletedBy = null;
  this.deletionReason = null;
  this.isActive = true;
  return this.save();
};

// ═══ Static: Find non-deleted by phone ═══
customerSchema.statics.findByPhone = function (phone) {
  return this.findOne({ phone: phone.trim(), isDeleted: false });
};

// ═══ Static: Active customers count ═══
customerSchema.statics.activeCount = function () {
  return this.countDocuments({ isActive: true, isDeleted: false });
};

// ═══ Helper: Available state codes (for validators / dropdowns) ═══
customerSchema.statics.STATE_CODES = STATE_CODES;

module.exports = mongoose.model('Customer', customerSchema);
