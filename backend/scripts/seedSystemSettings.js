require('dotenv').config();
if (process.env.NODE_ENV !== 'production') {
  const dns = require('dns');
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
}

const mongoose = require('mongoose');
const { SystemSetting } = require('../src/models');
const logger = require('../src/config/logger');

const DEFAULT_SETTINGS = [
  // ═══ ORDER category ═══
  {
    key: 'ORDER_EDIT_LOCK_STATUS',
    label: 'Order Edit Lock Status',
    description: 'After which status are edits blocked? Options: IN_PROGRESS, COMPLETED, DELIVERED, NEVER',
    value: 'COMPLETED',
    defaultValue: 'COMPLETED',
    valueType: 'enum',
    options: ['IN_PROGRESS', 'COMPLETED', 'DELIVERED', 'NEVER'],
    category: 'ORDER',
    displayOrder: 10,
    isSystemDefault: true,
  },
  {
    key: 'ORDER_PREFIX',
    label: 'Order Number Prefix',
    description: 'Prefix for order numbers (e.g., ORD-2026-001)',
    value: 'ORD',
    defaultValue: 'ORD',
    valueType: 'string',
    category: 'ORDER',
    displayOrder: 20,
    isSystemDefault: true,
  },
  {
    key: 'DEFAULT_CUTTING_RULE_CODE',
    label: 'Default Cutting Charge Rule',
    description: 'Which cutting rule to apply by default if not specified',
    value: 'PER_PIECE_STD',
    defaultValue: 'PER_PIECE_STD',
    valueType: 'string',
    category: 'ORDER',
    displayOrder: 30,
    isSystemDefault: true,
  },

  // ═══ BILLING category ═══
  {
    key: 'DEFAULT_GST_RATE_PCT',
    label: 'Default GST Rate (%)',
    description: 'Default GST percentage applied to MDF products',
    value: 18,
    defaultValue: 18,
    valueType: 'number',
    category: 'BILLING',
    displayOrder: 10,
    isSystemDefault: true,
  },
  {
    key: 'BUSINESS_STATE',
    label: 'Business State',
    description: 'Home state of business — used for CGST/SGST vs IGST decision',
    value: 'Madhya Pradesh',
    defaultValue: 'Madhya Pradesh',
    valueType: 'string',
    category: 'BILLING',
    displayOrder: 20,
    isSystemDefault: true,
  },
  {
    key: 'BUSINESS_GSTIN',
    label: 'Business GSTIN',
    description: 'Business GSTIN for bill headers',
    value: '',
    defaultValue: '',
    valueType: 'string',
    category: 'BILLING',
    displayOrder: 30,
    isSystemDefault: true,
  },
  {
    key: 'BUSINESS_NAME',
    label: 'Business Name',
    description: 'Business name shown on bills',
    value: 'Shree Gopal MDF',
    defaultValue: 'Shree Gopal MDF',
    valueType: 'string',
    category: 'BILLING',
    displayOrder: 40,
    isSystemDefault: true,
  },

  // ═══ NUMBERING category ═══
  {
    key: 'FINANCIAL_YEAR_START_MONTH',
    label: 'Financial Year Start Month',
    description: 'Month FY starts (1=Jan, 4=April for India)',
    value: 4,
    defaultValue: 4,
    valueType: 'number',
    category: 'NUMBERING',
    displayOrder: 10,
    isSystemDefault: true,
  },
  {
    key: 'INVOICE_PREFIX',
    label: 'Invoice Number Prefix',
    description: 'Prefix for invoice numbers',
    value: 'INV',
    defaultValue: 'INV',
    valueType: 'string',
    category: 'NUMBERING',
    displayOrder: 20,
    isSystemDefault: true,
  },

  // ═══ INVENTORY category ═══
  {
    key: 'LOW_STOCK_ALERT_ENABLED',
    label: 'Low Stock Alerts Enabled',
    description: 'Whether to show low-stock warnings',
    value: true,
    defaultValue: true,
    valueType: 'boolean',
    category: 'INVENTORY',
    displayOrder: 10,
    isSystemDefault: true,
  },
];

const seed = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);

    let created = 0, updated = 0, skipped = 0;

    for (const setting of DEFAULT_SETTINGS) {
      const existing = await SystemSetting.findOne({ key: setting.key });

      if (existing) {
        let changed = false;
        ['label', 'description', 'defaultValue', 'options', 'displayOrder'].forEach(field => {
          if (JSON.stringify(existing[field]) !== JSON.stringify(setting[field])) {
            existing[field] = setting[field];
            changed = true;
          }
        });
        if (changed) {
          await existing.save();
          updated++;
        } else {
          skipped++;
        }
      } else {
        await SystemSetting.create(setting);
        created++;
      }
    }

    logger.info(`✅ System settings: ${created} created, ${updated} updated, ${skipped} skipped`);
    logger.info(`   Total: ${await SystemSetting.countDocuments()}`);

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    logger.error('Failed:', error);
    process.exit(1);
  }
};

seed();
