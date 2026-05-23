require('dotenv').config();
if (process.env.NODE_ENV !== 'production') {
  const dns = require('dns');
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
}

const mongoose = require('mongoose');
const { CuttingChargeRule } = require('../src/models');
const logger = require('../src/config/logger');

const DEFAULT_RULES = [
  {
    code: 'PER_PIECE_STD',
    name: 'Per Piece - Standard',
    description: 'Charge per final cut piece (most common)',
    mode: 'per-piece',
    perPieceRate: 3,
    isDefault: true,
    displayOrder: 10,
    isSystemDefault: true,
  },
  {
    code: 'PER_PIECE_PREMIUM',
    name: 'Per Piece - Premium',
    description: 'Higher rate for precision/specialty cuts',
    mode: 'per-piece',
    perPieceRate: 5,
    displayOrder: 20,
    isSystemDefault: true,
  },
  {
    code: 'PER_CUT_BULK',
    name: 'Per Cut - Bulk',
    description: 'Charge per blade cut (cheaper for many pieces)',
    mode: 'per-cut',
    perCutRate: 2,
    displayOrder: 30,
    isSystemDefault: true,
  },
  {
    code: 'PER_SQFT',
    name: 'Per Square Foot',
    description: 'Charge based on total cutting area',
    mode: 'per-sqft',
    perSqftRate: 1.5,
    displayOrder: 40,
    isSystemDefault: true,
  },
  {
    code: 'INCLUDED',
    name: 'Included in Price',
    description: 'No extra cutting charge (built into material price)',
    mode: 'included',
    displayOrder: 50,
    isSystemDefault: true,
  },
];

const seed = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);

    let created = 0, skipped = 0;
    for (const rule of DEFAULT_RULES) {
      const existing = await CuttingChargeRule.findOne({ code: rule.code });
      if (existing) {
        skipped++;
      } else {
        await CuttingChargeRule.create(rule);
        created++;
      }
    }

    logger.info(`✅ Cutting rules: ${created} created, ${skipped} skipped`);
    logger.info(`   Total: ${await CuttingChargeRule.countDocuments()}`);
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    logger.error('Failed:', error);
    process.exit(1);
  }
};

seed();
