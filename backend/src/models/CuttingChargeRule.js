const mongoose = require('mongoose');

const cuttingChargeRuleSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      match: [/^[A-Z0-9_]+$/, 'Code must be UPPERCASE with underscores/digits'],
      maxlength: 50,
    },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    description: { type: String, trim: true, maxlength: 500 },

    mode: {
      type: String,
      enum: ['per-piece', 'per-cut', 'per-sqft', 'included', 'tiered'],
      required: true,
    },

    perPieceRate: { type: Number, default: 0, min: 0 },
    perCutRate: { type: Number, default: 0, min: 0 },
    perSqftRate: { type: Number, default: 0, min: 0 },

    tieredRates: [
      {
        maxAreaSqFt: { type: Number, default: null },
        rate: { type: Number, required: true, min: 0 },
        unit: { type: String, enum: ['per-piece', 'per-sqft'], default: 'per-piece' },
      },
    ],

    isDefault: { type: Boolean, default: false },

    isActive: { type: Boolean, default: true, index: true },
    isSystemDefault: { type: Boolean, default: false },
    displayOrder: { type: Number, default: 100 },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

cuttingChargeRuleSchema.index({ displayOrder: 1, name: 1 });

cuttingChargeRuleSchema.statics.findByCode = function (code) {
  return this.findOne({ code: code.toUpperCase() });
};

cuttingChargeRuleSchema.statics.getDefault = function () {
  return this.findOne({ isDefault: true, isActive: true });
};

module.exports = mongoose.model('CuttingChargeRule', cuttingChargeRuleSchema);
