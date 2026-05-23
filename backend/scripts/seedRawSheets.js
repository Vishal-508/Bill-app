require('dotenv').config();
if (process.env.NODE_ENV !== 'production') {
  const dns = require('dns');
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
}

const mongoose = require('mongoose');
const { Product, ProductGrade, User } = require('../src/models');
const { generateSKU } = require('../src/utils/skuGenerator');
const logger = require('../src/config/logger');

const STANDARD_TIERS = [
  { minQty: 1, maxQty: 49, discountPct: 0 },
  { minQty: 50, maxQty: 99, discountPct: 5 },
  { minQty: 100, maxQty: null, discountPct: 10 },
];

const RAW_SHEETS = [
  // 8×4 ft sheets in various thicknesses
  { thickness: 1.8,  grade: 'INTERIOR', brand: 'Local',       price: 25,  stock: 100 },
  { thickness: 2.5,  grade: 'INTERIOR', brand: 'Local',       price: 28,  stock: 80 },
  { thickness: 5.5,  grade: 'INTERIOR', brand: 'Greenply',    price: 34,  stock: 90 },
  { thickness: 6,    grade: 'INTERIOR', brand: 'Greenply',    price: 38,  stock: 250 },
  { thickness: 9,    grade: 'INTERIOR', brand: 'Greenply',    price: 48,  stock: 200 },
  { thickness: 12,   grade: 'INTERIOR', brand: 'Greenply',    price: 58,  stock: 180 },
  { thickness: 18,   grade: 'INTERIOR', brand: 'Greenply',    price: 70,  stock: 300 },
  { thickness: 18,   grade: 'INTERIOR', brand: 'Action Tesa', price: 68,  stock: 180 },
  { thickness: 25,   grade: 'INTERIOR', brand: 'Greenply',    price: 100, stock: 80 },

  // MR grade
  { thickness: 12,   grade: 'MR',       brand: 'Greenply',    price: 75,  stock: 120 },
  { thickness: 18,   grade: 'MR',       brand: 'Greenply',    price: 82,  stock: 150 },

  // HDHMR premium
  { thickness: 18,   grade: 'HDHMR',    brand: 'Action Tesa', price: 108, stock: 90 },

  // Pre-laminated
  { thickness: 18,   grade: 'PRELAM',   brand: 'Greenply',    price: 120, stock: 50 },

  // Fire retardant
  { thickness: 18,   grade: 'FIRE_RETARDANT', brand: 'Century', price: 165, stock: 20 },
];

const seed = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);

    const admin = await User.findOne({ role: { $in: ['SUPER_ADMIN', 'ADMIN'] } });
    if (!admin) {
      logger.error('No admin user. Run seed:admin first.');
      process.exit(1);
    }

    const grades = {};
    (await ProductGrade.find()).forEach(g => { grades[g.code] = g._id; });

    const cleared = await Product.deleteMany({ productType: 'RAW_SHEET', sku: /^MDF-/ });
    logger.info(`Cleared ${cleared.deletedCount} previous raw sheets`);

    let created = 0;
    for (const sheet of RAW_SHEETS) {
      const sku = await generateSKU({
        thicknessMM: sheet.thickness,
        lengthFT: 8,
        widthFT: 4,
        grade: grades[sheet.grade],
      });

      await Product.create({
        productType: 'RAW_SHEET',
        name: `MDF ${sheet.thickness}mm 8×4 ft ${sheet.grade.replace(/_/g, ' ')} - ${sheet.brand}`,
        sku,
        description: `${sheet.thickness}mm full sheet, ${sheet.grade} grade, ${sheet.brand} brand`,
        brand: sheet.brand,
        thicknessMM: sheet.thickness,
        lengthFT: 8,
        widthFT: 4,
        grade: grades[sheet.grade],
        pricingUnit: 'sqft',
        basePrice: sheet.price,
        quantityTiers: STANDARD_TIERS,
        currentStock: sheet.stock,
        minStockAlert: 15,
        reorderQuantity: 100,
        hsnCode: '4411',
        gstRatePct: 18,
        tags: sheet.brand === 'Greenply' ? ['top-brand'] : [],
        createdBy: admin._id,
      });
      created++;
    }

    logger.info(`✅ Raw sheets: ${created} created`);
    logger.info(`   Total: ${await Product.countDocuments({ productType: 'RAW_SHEET' })}`);

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    logger.error('Failed:', error);
    process.exit(1);
  }
};

seed();
