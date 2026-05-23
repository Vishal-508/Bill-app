require('dotenv').config();
if (process.env.NODE_ENV !== 'production') {
  const dns = require('dns');
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
}

const mongoose = require('mongoose');
const { Product, StandardBundleSize, ProductGrade, User } = require('../src/models');
const logger = require('../src/config/logger');

// Bundle inventory: [sizeCode, thicknessMM, gradeCode, brand, piecesPerBundle, pricePerBundle, currentBundles]
const BUNDLES = [
  // 18×36 inch in multiple thicknesses
  ['BS-18X36-RECT', 1.8,  'INTERIOR', 'Local',       100, 450,  3],
  ['BS-18X36-RECT', 3,    'INTERIOR', 'Local',       100, 650,  5],  // no 3mm sheet — will skip

  // 12×8 photo frames (most popular)
  ['BS-12X8-RECT', 6,    'INTERIOR', 'Greenply',    50, 1100, 8],
  ['BS-12X8-RECT', 9,    'INTERIOR', 'Greenply',    50, 1400, 6],
  ['BS-12X8-RECT', 18,   'INTERIOR', 'Greenply',    50, 2350, 10],

  // 10×8 frames
  ['BS-10X8-RECT', 18,   'INTERIOR', 'Greenply',    50, 1950, 12],

  // 16×12 large frames
  ['BS-16X12-RECT', 18,  'INTERIOR', 'Greenply',    30, 2750, 5],

  // 6×4 small (gift box pieces)
  ['BS-6X4-RECT',  6,    'INTERIOR', 'Local',       100, 700,  15],

  // 24×18 inch (poster size)
  ['BS-24X18-RECT', 18,  'INTERIOR', 'Greenply',    20, 3600, 4],

  // Feet-based sizes
  ['BS-24X12-RECT', 18,  'INTERIOR', 'Greenply',    20, 2800, 6],
  ['BS-12X12-RECT', 18,  'INTERIOR', 'Greenply',    25, 2200, 8],

  // MR variants
  ['BS-12X8-RECT', 18,   'MR',       'Greenply',    50, 2800, 5],
  ['BS-18X12-RECT', 18,  'MR',       'Greenply',    25, 2600, 3],
];

const seed = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);

    const admin = await User.findOne({ role: { $in: ['SUPER_ADMIN', 'ADMIN'] } });

    const cleared = await Product.deleteMany({ productType: 'PRE_CUT_BUNDLE' });
    logger.info(`Cleared ${cleared.deletedCount} previous bundles`);

    let created = 0;
    let skipped = 0;

    for (const [sizeCode, thickness, gradeCode, brand, pieces, bundlePrice, stock] of BUNDLES) {
      const size = await StandardBundleSize.findOne({ code: sizeCode });
      if (!size) {
        logger.warn(`Size ${sizeCode} not found, skipping`);
        skipped++;
        continue;
      }

      // Find the grade first (we'll use ID in query for proper filtering)
      const grade = await ProductGrade.findOne({ code: gradeCode });
      if (!grade) {
        logger.warn(`Grade ${gradeCode} not found, skipping ${sizeCode}`);
        skipped++;
        continue;
      }

      // Find the raw sheet with grade ID directly in query
      const rawSheet = await Product.findOne({
        productType: 'RAW_SHEET',
        thicknessMM: thickness,
        brand,
        grade: grade._id,
      }).populate('grade');

      if (!rawSheet) {
        logger.warn(`Raw sheet ${thickness}mm ${gradeCode} ${brand} not found for ${sizeCode}, skipping`);
        skipped++;
        continue;
      }

      const pricePerPiece = +(bundlePrice / pieces).toFixed(2);

      const sku = `BDL-${sizeCode.replace('BS-', '')}-${pieces}P-${thickness}MM-${gradeCode}-${brand.toUpperCase().replace(/\s/g, '')}-001`;

      await Product.create({
        productType: 'PRE_CUT_BUNDLE',
        name: `Bundle ${size.displayName} (${pieces} pcs) - ${thickness}mm ${gradeCode} - ${brand}`,
        sku,
        description: `Pre-cut bundle: ${pieces} pieces of ${size.displayName}, from ${thickness}mm ${gradeCode} sheet`,
        brand,
        thicknessMM: thickness,
        lengthFT: size.lengthInches / 12,
        widthFT: size.widthInches / 12,
        grade: rawSheet.grade._id,
        pricingUnit: 'sqft',
        basePrice: pricePerPiece,
        currentStock: stock,
        minStockAlert: 2,
        hsnCode: '4411',
        gstRatePct: 18,
        bundle: {
          standardSize: size._id,
          fromRawSheetType: rawSheet._id,
          piecesPerBundle: pieces,
          pricingMode: 'both',
          pricePerBundle: bundlePrice,
          pricePerPiece,
          currentBundles: stock,
          currentLoosePieces: 0,
        },
        tags: ['bundle'],
        createdBy: admin._id,
      });
      created++;
    }

    logger.info(`✅ Pre-cut bundles: ${created} created, ${skipped} skipped`);
    logger.info(`   Total: ${await Product.countDocuments({ productType: 'PRE_CUT_BUNDLE' })}`);

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    logger.error('Failed:', error);
    process.exit(1);
  }
};

seed();
