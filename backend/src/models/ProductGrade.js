const mongoose = require('mongoose');

const productGradeSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: [true, 'Code is required'],
      unique: true,
      uppercase: true,
      trim: true,
      match: [/^[A-Z_]+$/, 'Code must be UPPERCASE with underscores only'],
      maxlength: 50,
    },
    label: {
      type: String,
      required: [true, 'Label is required'],
      trim: true,
      maxlength: 100,
    },
    description: { type: String, trim: true, maxlength: 500 },
    iconName: { type: String, trim: true },
    displayOrder: { type: Number, default: 100, index: true },
    isActive: { type: Boolean, default: true, index: true },
    isSystemDefault: { type: Boolean, default: false },

    // Grade-specific defaults (admin can pre-fill suggested values)
    defaultGstRatePct: { type: Number, default: 18, min: 0, max: 100 },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

productGradeSchema.index({ displayOrder: 1, label: 1 });

productGradeSchema.statics.getActive = function () {
  return this.find({ isActive: true }).sort({ displayOrder: 1, label: 1 });
};

productGradeSchema.statics.findByCode = function (code) {
  return this.findOne({ code: code.toUpperCase() });
};

module.exports = mongoose.model('ProductGrade', productGradeSchema);
