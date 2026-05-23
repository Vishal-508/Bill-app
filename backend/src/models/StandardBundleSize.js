const mongoose = require('mongoose');
const { formatDimensions } = require('../utils/unitConverter');

const standardBundleSizeSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      maxlength: 100,
    },

    shape: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ShapeCuttingRate',
      required: true,
      index: true,
    },

    // ═══ Universal storage (always in inches) ═══
    lengthInches: { type: Number, required: true, min: 0.1 },
    widthInches: { type: Number, required: true, min: 0.1 },

    // For ROUND shape (when applicable)
    diameterInches: { type: Number, min: 0 },

    // Auto-computed
    areaSqInches: { type: Number },
    areaSqFt: { type: Number, index: true },

    preferredUnit: {
      type: String,
      enum: ['inch', 'ft', 'cm', 'mm'],
      default: 'inch',
    },
    displayName: { type: String, trim: true },

    defaultPiecesPerBundle: { type: Number, default: 50, min: 1 },

    description: { type: String, trim: true, maxlength: 500 },
    notes: { type: String, trim: true, maxlength: 500 },

    // Popularity tracking
    timesOrdered: { type: Number, default: 0 },
    uniqueCustomerCount: { type: Number, default: 0 },
    lastOrderedAt: { type: Date },

    isActive: { type: Boolean, default: true, index: true },
    isSystemDefault: { type: Boolean, default: false },
    displayOrder: { type: Number, default: 100 },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

standardBundleSizeSchema.index({ displayOrder: 1 });
standardBundleSizeSchema.index({ lengthInches: 1, widthInches: 1 });

// Pre-save: auto-compute area and display name
standardBundleSizeSchema.pre('save', function (next) {
  this.areaSqInches = +(this.lengthInches * this.widthInches).toFixed(4);
  this.areaSqFt = +(this.areaSqInches / 144).toFixed(4);

  if (!this.displayName) {
    this.displayName = formatDimensions(this.lengthInches, this.widthInches, this.preferredUnit);
  }

  next();
});

module.exports = mongoose.model('StandardBundleSize', standardBundleSizeSchema);
