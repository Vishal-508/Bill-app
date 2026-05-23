const mongoose = require('mongoose');

/**
 * SystemSetting — admin-configurable runtime settings.
 *
 * Use cases:
 *   - ORDER_EDIT_LOCK_STATUS: When edits become locked
 *   - DEFAULT_GST_RATE_PCT: Default GST percentage
 *   - DEFAULT_CUTTING_RULE: Which cutting rule applies by default
 *   - LOW_STOCK_ALERT_DAYS: How many days advance for alerts
 *   - FINANCIAL_YEAR_START_MONTH: 4 (April for India)
 *   - INVOICE_PREFIX: 'INV', 'BILL', etc.
 *   - ORDER_PREFIX: 'ORD'
 */
const systemSettingSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
      match: [/^[A-Z][A-Z0-9_]*$/, 'Key must be UPPERCASE_WITH_UNDERSCORES'],
      maxlength: 100,
    },
    label: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    description: { type: String, trim: true, maxlength: 1000 },

    value: { type: mongoose.Schema.Types.Mixed, required: true },
    valueType: {
      type: String,
      enum: ['string', 'number', 'boolean', 'enum', 'json'],
      required: true,
    },

    options: { type: [String], default: [] },

    category: {
      type: String,
      enum: ['ORDER', 'BILLING', 'INVENTORY', 'GENERAL', 'NUMBERING'],
      default: 'GENERAL',
      index: true,
    },

    defaultValue: { type: mongoose.Schema.Types.Mixed },

    isActive: { type: Boolean, default: true },
    isSystemDefault: { type: Boolean, default: false },
    isUserConfigurable: { type: Boolean, default: true },
    displayOrder: { type: Number, default: 100 },

    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

systemSettingSchema.index({ category: 1, displayOrder: 1 });

// Static: get setting value by key (with default fallback)
systemSettingSchema.statics.getValue = async function (key, fallback = null) {
  const setting = await this.findOne({ key: key.toUpperCase(), isActive: true });
  return setting ? setting.value : fallback;
};

// Static: get all settings in a category
systemSettingSchema.statics.getCategory = function (category) {
  return this.find({ category: category.toUpperCase(), isActive: true })
    .sort({ displayOrder: 1, key: 1 });
};

module.exports = mongoose.model('SystemSetting', systemSettingSchema);
