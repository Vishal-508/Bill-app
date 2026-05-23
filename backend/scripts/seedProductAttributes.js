require('dotenv').config();

if (process.env.NODE_ENV !== 'production') {
  const dns = require('dns');
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
}

const mongoose = require('mongoose');
const { ProductAttribute } = require('../src/models');
const logger = require('../src/config/logger');

const DEFAULT_ATTRIBUTES = [
  { name: 'color', label: 'Color', type: 'enum', options: ['Natural', 'White', 'Black', 'Wood Finish', 'Custom'], displayOrder: 10 },
  { name: 'finish', label: 'Surface Finish', type: 'enum', options: ['Plain', 'Matte', 'Glossy', 'Textured'], displayOrder: 20 },
  { name: 'is-prelaminated', label: 'Pre-laminated', type: 'boolean', displayOrder: 30 },
  { name: 'fire-rating', label: 'Fire Rating', type: 'enum', options: ['None', 'Class B', 'Class A', 'Class A1'], displayOrder: 40 },
  { name: 'moisture-resistance', label: 'Moisture Resistance Level', type: 'enum', options: ['None', 'Low', 'Medium', 'High', 'BWP'], displayOrder: 50 },
  { name: 'density-kg-m3', label: 'Density', type: 'number', unit: 'kg/m³', minValue: 500, maxValue: 900, displayOrder: 60 },
  { name: 'warranty-years', label: 'Warranty', type: 'number', unit: 'years', minValue: 0, maxValue: 25, displayOrder: 70 },
  { name: 'origin-country', label: 'Country of Origin', type: 'string', maxLength: 50, displayOrder: 80 },
];

const seed = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);

    let created = 0, skipped = 0;

    for (const attr of DEFAULT_ATTRIBUTES) {
      const existing = await ProductAttribute.findOne({ name: attr.name });

      if (existing) {
        skipped++;
      } else {
        await ProductAttribute.create({ ...attr, isSystemDefault: true });
        created++;
      }
    }

    logger.info(`📊 Product Attributes Seeding Complete`);
    logger.info(`   Created: ${created} | Skipped: ${skipped}`);
    logger.info(`   Total in DB: ${await ProductAttribute.countDocuments()}`);

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    logger.error('Seeding failed:', error);
    process.exit(1);
  }
};

seed();
