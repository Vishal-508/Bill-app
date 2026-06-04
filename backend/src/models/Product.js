const mongoose = require('mongoose');

const quantityTierSchema = new mongoose.Schema(
  {
    minQty: { type: Number, required: true, min: 1 },
    maxQty: { type: Number, default: null },  // null = unlimited
    discountPct: { type: Number, required: true, min: 0, max: 100 },
  },
  { _id: false }
);

const priceHistoryEntrySchema = new mongoose.Schema(
  {
    oldPrice: Number,
    newPrice: Number,
    changedAt: { type: Date, default: Date.now },
    changedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reason: { type: String, trim: true, maxlength: 200 },
  },
  { _id: false }
);

// ─── Forecast + consumption analytics (Prompt 8) ───
// Denormalized cache, updated by jobs/dailyForecast + dailyAnalytics crons.
// Read-heavy for admin dashboards. Stays in sync with StockMovement
// aggregations; recomputed nightly. See [[prompt8_inventory_analytics_only]]
// in memory — this is admin analytics ONLY and never gates order flow.
const lastForecastSchema = new mongoose.Schema(
  {
    next30days: { type: Number, default: 0, min: 0 },
    next90days: { type: Number, default: 0, min: 0 },
    next180days: { type: Number, default: 0, min: 0 },
    method: {
      type: String,
      enum: ['holt-winters', 'moving-average', 'naive', 'fallback'],
      default: 'fallback',
    },
    mape: { type: Number, default: null, min: 0 }, // null if not computable
    computedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const forecastDataSchema = new mongoose.Schema(
  {
    last30Days: { type: Number, default: 0, min: 0 },
    last90Days: { type: Number, default: 0, min: 0 },
    last365Days: { type: Number, default: 0, min: 0 },
    avgMonthly: { type: Number, default: 0, min: 0 },
    avgWeekly: { type: Number, default: 0, min: 0 },
    peakMonths: { type: [String], default: [] },
    lastForecast: { type: lastForecastSchema, default: () => ({}) },
    lastComputedAt: Date,
  },
  { _id: false }
);

const productSchema = new mongoose.Schema(
  {
    // ═══ Type discriminator ═══
    productType: {
      type: String,
      enum: ['RAW_SHEET', 'PRE_CUT_BUNDLE'],
      required: true,
      default: 'RAW_SHEET',
      index: true,
    },

    // ═══ Bundle-specific (only for PRE_CUT_BUNDLE) ═══
    bundle: {
      standardSize: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'StandardBundleSize',
      },
      fromRawSheetType: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
      },
      piecesPerBundle: { type: Number, min: 1 },

      pricingMode: {
        type: String,
        enum: ['per-bundle', 'per-piece', 'both'],
        default: 'per-bundle',
      },
      pricePerBundle: { type: Number, min: 0 },
      pricePerPiece: { type: Number, min: 0 },

      currentBundles: { type: Number, default: 0, min: 0 },
      currentLoosePieces: { type: Number, default: 0, min: 0 },

      materialCostPerBundle: { type: Number, default: 0 },
      cuttingCostPerBundle: { type: Number, default: 0 },
    },

    // ═══ Basic Info ═══
    name: {
      type: String,
      required: [true, 'Product name is required'],
      trim: true,
      minlength: 2,
      maxlength: 200,
      index: true,
    },
    sku: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      // Auto-generated format: MDF-{THICKNESS}-{SIZE}-{GRADE}-{SEQ}
      // e.g., MDF-18MM-8X4-INTERIOR-001
    },
    description: { type: String, trim: true, maxlength: 1000 },
    brand: { type: String, trim: true, maxlength: 100, index: true },

    // ═══ Dimensions ═══
    thicknessMM: {
      type: Number,
      required: [true, 'Thickness is required'],
      min: [0.1, 'Thickness must be at least 0.1mm'],
      max: [100, 'Thickness cannot exceed 100mm'],
      index: true,
    },
    lengthFT: {
      type: Number,
      required: true,
      default: 8,
      min: 0.1,
      max: 100,
    },
    widthFT: {
      type: Number,
      required: true,
      default: 4,
      min: 0.1,
      max: 100,
    },
    areaSqFt: {
      type: Number,
      // Auto-computed in pre-save
    },
    areaSqInch: {
      type: Number,
      // Auto-computed in pre-save
    },

    // ═══ Grade ═══
    grade: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ProductGrade',
      required: [true, 'Grade is required'],
      index: true,
    },

    // ═══ Pricing ═══
    pricingUnit: {
      type: String,
      enum: ['sqft', 'sqinch', 'sheet'],
      default: 'sqft',
      required: true,
    },
    basePrice: {
      type: Number,
      required: [true, 'Base price is required'],
      min: 0,
    },
    quantityTiers: {
      type: [quantityTierSchema],
      default: [],
    },
    priceHistory: {
      type: [priceHistoryEntrySchema],
      default: [],
    },

    // ═══ Stock ═══
    currentStock: { type: Number, default: 0, min: 0 },
    minStockAlert: { type: Number, default: 10, min: 0 },
    reorderQuantity: { type: Number, default: 50, min: 0 },
    lastRestockedAt: Date,

    // ═══ Forecast + consumption analytics (Prompt 8) — admin-only insight ═══
    forecastData: { type: forecastDataSchema, default: () => ({}) },

    // ═══ Tax ═══
    hsnCode: {
      type: String,
      default: '4411',
      trim: true,
      maxlength: 10,
      // 4411 is the HSN code for MDF in India
    },
    gstRatePct: {
      type: Number,
      default: 18,
      min: 0,
      max: 100,
    },

    // ═══ Custom Attributes (Admin-Extensible) ═══
    customFields: {
      type: Map,
      of: mongoose.Schema.Types.Mixed,
      default: {},
    },

    // ═══ Status ═══
    isActive: { type: Boolean, default: true, index: true },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: Date,
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    deletionReason: { type: String, trim: true, maxlength: 500 },

    // ═══ Tags ═══
    tags: {
      type: [String],
      default: [],
      validate: {
        validator: (arr) => arr.length <= 10,
        message: 'Maximum 10 tags allowed',
      },
    },

    // ═══ Audit ═══
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    notes: { type: String, trim: true, maxlength: 2000 },
  },
  {
    timestamps: true,
    toJSON: {
      transform: (doc, ret) => {
        if (ret.customFields instanceof Map) {
          ret.customFields = Object.fromEntries(ret.customFields);
        }
        delete ret.__v;
        return ret;
      },
    },
  }
);

// ═══ Indexes ═══
productSchema.index({ productType: 1, isActive: 1, isDeleted: 1 });
productSchema.index({ 'bundle.standardSize': 1 });
productSchema.index({ name: 'text', sku: 'text', brand: 'text' });
productSchema.index({ thicknessMM: 1, lengthFT: 1, widthFT: 1 });
productSchema.index({ grade: 1, isActive: 1, isDeleted: 1 });
productSchema.index({ basePrice: 1 });
productSchema.index({ currentStock: 1 });
productSchema.index({ tags: 1 });
productSchema.index({ createdAt: -1 });

// ═══ Pre-save: Auto-compute dimensions ═══
productSchema.pre('save', function (next) {
  if (this.lengthFT && this.widthFT) {
    this.areaSqFt = +(this.lengthFT * this.widthFT).toFixed(2);
    this.areaSqInch = +(this.areaSqFt * 144).toFixed(2);  // 1 sqft = 144 sqinch
  }
  next();
});

// ═══ Pre-save: Validate quantity tiers (no overlaps) ═══
productSchema.pre('save', function (next) {
  if (!this.quantityTiers || this.quantityTiers.length === 0) return next();

  const tiers = [...this.quantityTiers].sort((a, b) => a.minQty - b.minQty);

  for (let i = 0; i < tiers.length - 1; i++) {
    const current = tiers[i];
    const next_ = tiers[i + 1];

    if (current.maxQty === null || current.maxQty === undefined) {
      return next(new Error(
        `Tier with minQty=${current.minQty} has no maxQty but is not the last tier`
      ));
    }

    if (current.maxQty < current.minQty) {
      return next(new Error(
        `Tier maxQty (${current.maxQty}) is less than minQty (${current.minQty})`
      ));
    }

    if (next_.minQty <= current.maxQty) {
      return next(new Error(
        `Quantity tiers overlap: ${current.minQty}-${current.maxQty} and ${next_.minQty}-${next_.maxQty}`
      ));
    }
  }

  next();
});

// ═══ Pre-save: Track price changes (single source of truth) ═══
productSchema.pre('save', function (next) {
  if (this.isModified('basePrice') && !this.isNew) {
    const oldPrice = this._original?.basePrice;
    if (oldPrice !== undefined && oldPrice !== this.basePrice) {
      this.priceHistory.push({
        oldPrice,
        newPrice: this.basePrice,
        changedAt: new Date(),
        changedBy: this._priceChangedByUser || this._updatedByUser,
        reason: this._priceChangeReason || undefined,
      });
    }
  }
  next();
});

// Capture original for price change tracking — both lifecycle paths
productSchema.post('init', function () {
  this._original = this.toObject();
});

productSchema.post('save', function () {
  this._original = this.toObject();
});

// ═══ Instance Method: Calculate price for given quantity ═══
productSchema.methods.calculatePrice = function (quantity, unitOverride = null) {
  const unit = unitOverride || this.pricingUnit;

  let basePriceForUnit;
  if (unit === 'sqft') {
    basePriceForUnit = this.basePrice;
  } else if (unit === 'sqinch') {
    basePriceForUnit = this.basePrice / 144;
  } else if (unit === 'sheet') {
    basePriceForUnit = this.basePrice * this.areaSqFt;
  }

  const tier = this.quantityTiers.find((t) =>
    quantity >= t.minQty && (t.maxQty === null || quantity <= t.maxQty)
  );
  const discountPct = tier?.discountPct || 0;

  const subtotal = basePriceForUnit * quantity;
  const discountAmount = subtotal * (discountPct / 100);
  const finalPrice = subtotal - discountAmount;

  return {
    quantity,
    unit,
    basePriceForUnit: +basePriceForUnit.toFixed(2),
    subtotal: +subtotal.toFixed(2),
    appliedTier: tier ? `${tier.minQty}+ → ${tier.discountPct}% off` : 'No tier',
    discountPct,
    discountAmount: +discountAmount.toFixed(2),
    finalPrice: +finalPrice.toFixed(2),
  };
};

// ═══ Instance Method: Soft delete ═══
productSchema.methods.softDelete = async function (userId, reason) {
  this.isDeleted = true;
  this.deletedAt = new Date();
  this.deletedBy = userId;
  this.deletionReason = reason;
  this.isActive = false;
  return this.save();
};

productSchema.methods.restore = async function () {
  this.isDeleted = false;
  this.deletedAt = null;
  this.deletedBy = null;
  this.deletionReason = null;
  this.isActive = true;
  return this.save();
};

// ═══ Static: Stock check ═══
productSchema.statics.lowStock = function () {
  return this.find({
    isDeleted: false,
    isActive: true,
    $expr: { $lte: ['$currentStock', '$minStockAlert'] },
  });
};

module.exports = mongoose.model('Product', productSchema);
