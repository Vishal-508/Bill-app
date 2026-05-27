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

  // ═══ BILLING category — Invoice config (Prompt 5 Section A) ═══
  {
    key: 'INVOICE_TERMS_DEFAULT',
    label: 'Invoice Default Terms',
    category: 'BILLING',
    description: 'Default terms and conditions printed on invoice',
    value: '1. Goods once sold will not be taken back. 2. Interest @ 18% p.a. will be charged on outstanding amount after due date. 3. Subject to local jurisdiction.',
    defaultValue: '1. Goods once sold will not be taken back. 2. Interest @ 18% p.a. will be charged on outstanding amount after due date. 3. Subject to local jurisdiction.',
    valueType: 'string',
    displayOrder: 30,
    isSystemDefault: true,
  },
  {
    key: 'INVOICE_DEFAULT_FORMAT',
    label: 'Invoice Default Format',
    category: 'BILLING',
    description: 'Default invoice format (detailed/simple/minimal)',
    value: 'detailed',
    defaultValue: 'detailed',
    valueType: 'enum',
    options: ['detailed', 'simple', 'minimal'],
    displayOrder: 31,
    isSystemDefault: true,
  },
  {
    key: 'INVOICE_LANGUAGE',
    label: 'Invoice Language',
    category: 'BILLING',
    description: 'Invoice language preference (English/Hindi)',
    value: 'en',
    defaultValue: 'en',
    valueType: 'enum',
    options: ['en', 'hi'],
    displayOrder: 32,
    isSystemDefault: true,
  },
  {
    key: 'BUSINESS_ADDRESS',
    label: 'Business Address',
    category: 'BILLING',
    description: 'Business address printed on invoices',
    value: 'Indore, Madhya Pradesh, India - 452001',
    defaultValue: 'Indore, Madhya Pradesh, India - 452001',
    valueType: 'string',
    displayOrder: 33,
    isSystemDefault: true,
  },
  {
    key: 'BUSINESS_PHONE',
    label: 'Business Phone',
    category: 'BILLING',
    description: 'Business contact number printed on invoices',
    value: '+91-XXXXXXXXXX',
    defaultValue: '+91-XXXXXXXXXX',
    valueType: 'string',
    displayOrder: 34,
    isSystemDefault: true,
  },
  {
    key: 'BUSINESS_EMAIL',
    label: 'Business Email',
    category: 'BILLING',
    description: 'Business email printed on invoices',
    value: 'business@shreegopal.com',
    defaultValue: 'business@shreegopal.com',
    valueType: 'string',
    displayOrder: 35,
    isSystemDefault: true,
  },
  {
    key: 'BUSINESS_BANK_DETAILS',
    label: 'Business Bank Details',
    category: 'BILLING',
    description: 'Bank details for invoice (account, IFSC, branch)',
    value: 'Bank: SBI, A/c: XXXXXXXXXX, IFSC: SBIN0000000, Branch: Indore',
    defaultValue: 'Bank: SBI, A/c: XXXXXXXXXX, IFSC: SBIN0000000, Branch: Indore',
    valueType: 'string',
    displayOrder: 36,
    isSystemDefault: true,
  },

  // ═══ BILLING category — Payment Gateway (Prompt 6 Section A) ═══
  {
    key: 'PAYMENT_GATEWAY_ENABLED',
    label: 'Payment Gateway Enabled',
    category: 'BILLING',
    description: 'Enable/disable online payment collection via gateway',
    value: true,
    defaultValue: true,
    valueType: 'boolean',
    displayOrder: 40,
    isSystemDefault: true,
  },
  {
    key: 'PAYMENT_GATEWAY_PROVIDER',
    label: 'Payment Gateway Provider',
    category: 'BILLING',
    description: 'Which payment gateway to use (razorpay or manual only)',
    value: 'razorpay',
    defaultValue: 'razorpay',
    valueType: 'enum',
    options: ['razorpay', 'manual'],
    displayOrder: 41,
    isSystemDefault: true,
  },
  {
    key: 'PAYMENT_AUTO_CAPTURE',
    label: 'Auto-Capture Payments',
    category: 'BILLING',
    description: 'Automatically capture authorized payments (true) or hold for manual capture (false)',
    value: true,
    defaultValue: true,
    valueType: 'boolean',
    displayOrder: 42,
    isSystemDefault: true,
  },
  {
    key: 'PAYMENT_WEBHOOK_TOLERANCE_SECONDS',
    label: 'Webhook Tolerance (Seconds)',
    category: 'BILLING',
    description: 'Anti-replay protection: how old webhook timestamps are accepted (default 300s)',
    value: 300,
    defaultValue: 300,
    valueType: 'number',
    displayOrder: 43,
    isSystemDefault: true,
  },
  {
    key: 'BUSINESS_UPI_VPA',
    label: 'Business UPI VPA',
    category: 'BILLING',
    description: 'Business UPI ID for direct UPI payments (e.g., shreegopal@paytm)',
    value: 'shreegopal@upi',
    defaultValue: 'shreegopal@upi',
    valueType: 'string',
    displayOrder: 44,
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
