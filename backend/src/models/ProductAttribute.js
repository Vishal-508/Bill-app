const mongoose = require('mongoose');

/**
 * ProductAttribute — admin-defined custom fields for products.
 *
 * Example use cases:
 *   - { name: "color", type: "enum", options: ["white", "black", "wood"] }
 *   - { name: "moisture-resistance", type: "enum", options: ["low", "medium", "high"] }
 *   - { name: "fire-rating", type: "string" }
 *   - { name: "is-prelaminated", type: "boolean" }
 *   - { name: "warranty-years", type: "number" }
 *
 * When admin adds a new attribute via API, it becomes available on Product.customFields.
 */
const productAttributeSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Attribute name is required'],
      unique: true,
      trim: true,
      lowercase: true,
      match: [/^[a-z][a-z0-9_-]*$/, 'Name must start with lowercase letter, contain only lowercase, digits, underscores, or hyphens'],
      maxlength: 50,
    },
    label: {
      type: String,
      required: [true, 'Display label is required'],
      trim: true,
      maxlength: 100,
    },
    description: { type: String, trim: true, maxlength: 500 },
    type: {
      type: String,
      enum: ['string', 'number', 'enum', 'boolean'],
      required: true,
    },
    options: {
      type: [String],
      default: [],
      // Only used when type === 'enum'
    },
    unit: {
      type: String,
      trim: true,
      maxlength: 20,
      // Optional — e.g., "mm", "%", "years"
    },
    isRequired: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true, index: true },
    isSystemDefault: { type: Boolean, default: false },
    displayOrder: { type: Number, default: 100, index: true },

    // Validation hints (used by frontend, enforced by Product validators)
    minValue: Number,
    maxValue: Number,
    minLength: Number,
    maxLength: Number,

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

// Pre-save: enum type must have options
productAttributeSchema.pre('save', function (next) {
  if (this.type === 'enum' && (!this.options || this.options.length === 0)) {
    return next(new Error('Enum attributes must have at least one option'));
  }
  // Clear options for non-enum types
  if (this.type !== 'enum') {
    this.options = [];
  }
  next();
});

productAttributeSchema.statics.getActive = function () {
  return this.find({ isActive: true }).sort({ displayOrder: 1, label: 1 });
};

module.exports = mongoose.model('ProductAttribute', productAttributeSchema);
