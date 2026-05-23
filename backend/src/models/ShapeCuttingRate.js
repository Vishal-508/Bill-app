const mongoose = require('mongoose');

const shapeCuttingRateSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      match: [/^[A-Z_]+$/, 'Code must be UPPERCASE with underscores only'],
      maxlength: 50,
    },
    label: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    description: { type: String, trim: true, maxlength: 500 },
    iconName: { type: String, trim: true },

    calculationMode: {
      type: String,
      enum: ['multiplier', 'fixed-addon', 'perimeter-based', 'custom'],
      default: 'multiplier',
    },

    baseMultiplier: { type: Number, default: 1.0, min: 0 },
    fixedAddOnPerPiece: { type: Number, default: 0, min: 0 },
    perInchPerimeterRate: { type: Number, default: 0, min: 0 },
    customCalculationNotes: { type: String, trim: true, maxlength: 500 },
    cutsPerPiece: { type: Number, default: 4, min: 0 },

    isActive: { type: Boolean, default: true, index: true },
    isSystemDefault: { type: Boolean, default: false },
    displayOrder: { type: Number, default: 100 },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

shapeCuttingRateSchema.index({ displayOrder: 1, label: 1 });

shapeCuttingRateSchema.statics.findByCode = function (code) {
  return this.findOne({ code: code.toUpperCase() });
};

shapeCuttingRateSchema.statics.getActive = function () {
  return this.find({ isActive: true }).sort({ displayOrder: 1, label: 1 });
};

module.exports = mongoose.model('ShapeCuttingRate', shapeCuttingRateSchema);
