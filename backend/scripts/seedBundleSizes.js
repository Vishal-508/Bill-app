require('dotenv').config();
if (process.env.NODE_ENV !== 'production') {
  const dns = require('dns');
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
}

const mongoose = require('mongoose');
const { StandardBundleSize, ShapeCuttingRate } = require('../src/models');
const { toInches } = require('../src/utils/unitConverter');
const logger = require('../src/config/logger');

// Sizes from user's actual cut data — flat list, no categorization
const BUNDLE_SIZES = [
  // Sizes in INCHES
  { length: 6,  width: 4,  unit: 'inch', piecesPerBundle: 100 },
  { length: 8,  width: 6,  unit: 'inch', piecesPerBundle: 50 },
  { length: 10, width: 8,  unit: 'inch', piecesPerBundle: 50 },
  { length: 12, width: 8,  unit: 'inch', piecesPerBundle: 50 },
  { length: 12, width: 10, unit: 'inch', piecesPerBundle: 50 },
  { length: 14, width: 11, unit: 'inch', piecesPerBundle: 30 },
  { length: 16, width: 12, unit: 'inch', piecesPerBundle: 30 },
  { length: 18, width: 12, unit: 'inch', piecesPerBundle: 25 },
  { length: 18, width: 36, unit: 'inch', piecesPerBundle: 100 },
  { length: 20, width: 16, unit: 'inch', piecesPerBundle: 20 },
  { length: 24, width: 18, unit: 'inch', piecesPerBundle: 20 },
  { length: 26.5, width: 26.5, unit: 'inch', piecesPerBundle: 25 },
  { length: 34.3, width: 49.53, unit: 'inch', piecesPerBundle: 15 },

  // Sizes in FEET
  { length: 1,   width: 0.5, unit: 'ft', piecesPerBundle: 25 },
  { length: 1,   width: 1,   unit: 'ft', piecesPerBundle: 25 },
  { length: 1.5, width: 1,   unit: 'ft', piecesPerBundle: 20 },
  { length: 2,   width: 1,   unit: 'ft', piecesPerBundle: 20 },
  { length: 2,   width: 1.5, unit: 'ft', piecesPerBundle: 15 },
  { length: 2,   width: 2,   unit: 'ft', piecesPerBundle: 15 },
  { length: 3,   width: 2,   unit: 'ft', piecesPerBundle: 10 },
  { length: 4,   width: 2,   unit: 'ft', piecesPerBundle: 10 },

  // Special sizes from user data
  { length: 30, width: 121, unit: 'inch', piecesPerBundle: 5 },
  { length: 45, width: 121, unit: 'inch', piecesPerBundle: 5 },
  { length: 58, width: 121, unit: 'inch', piecesPerBundle: 5 },
  { length: 121, width: 243, unit: 'inch', piecesPerBundle: 2 },
];

const seed = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);

    const rect = await ShapeCuttingRate.findOne({ code: 'RECTANGLE' });
    if (!rect) {
      logger.error('Run npm run seed:shapes first!');
      process.exit(1);
    }

    const cleared = await StandardBundleSize.deleteMany({ code: /^BS-/ });
    logger.info(`Cleared ${cleared.deletedCount} previous sizes`);

    let created = 0, dup = 0;
    for (let i = 0; i < BUNDLE_SIZES.length; i++) {
      const size = BUNDLE_SIZES[i];
      const lengthIn = toInches(size.length, size.unit);
      const widthIn = toInches(size.width, size.unit);

      const code = `BS-${Math.round(lengthIn * 10) / 10}X${Math.round(widthIn * 10) / 10}-RECT`;

      try {
        await StandardBundleSize.create({
          code,
          shape: rect._id,
          lengthInches: lengthIn,
          widthInches: widthIn,
          preferredUnit: size.unit,
          defaultPiecesPerBundle: size.piecesPerBundle,
          isSystemDefault: true,
          displayOrder: (i + 1) * 10,
        });
        created++;
      } catch (e) {
        if (e.code === 11000) {
          dup++;
          logger.warn(`Skipped duplicate: ${code}`);
        } else {
          throw e;
        }
      }
    }

    logger.info(`✅ Bundle sizes: ${created} created, ${dup} duplicates skipped`);
    logger.info(`   Total: ${await StandardBundleSize.countDocuments()}`);

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    logger.error('Failed:', error);
    process.exit(1);
  }
};

seed();
