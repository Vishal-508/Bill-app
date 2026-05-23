require('dotenv').config();

if (process.env.NODE_ENV !== 'production') {
  const dns = require('dns');
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
}

const mongoose = require('mongoose');
const { ProductGrade } = require('../src/models');
const logger = require('../src/config/logger');

const DEFAULT_GRADES = [
  { code: 'INTERIOR', label: 'Interior Grade', description: 'Standard MDF for interior, non-moisture-prone applications', displayOrder: 10, defaultGstRatePct: 18 },
  { code: 'MR', label: 'Moisture Resistant (MR)', description: 'Moisture-resistant MDF for kitchens, bathrooms, semi-humid areas', displayOrder: 20, defaultGstRatePct: 18 },
  { code: 'EXTERIOR', label: 'Exterior Grade', description: 'Weather-resistant MDF for exterior use', displayOrder: 30, defaultGstRatePct: 18 },
  { code: 'HDHMR', label: 'HDHMR (High Density High Moisture Resistant)', description: 'Premium high-density moisture-resistant MDF, BWP grade', displayOrder: 40, defaultGstRatePct: 18 },
  { code: 'PRELAM', label: 'Pre-laminated', description: 'MDF with pre-applied laminate finish (one or both sides)', displayOrder: 50, defaultGstRatePct: 18 },
  { code: 'FIRE_RETARDANT', label: 'Fire Retardant', description: 'Fire-resistant MDF for commercial/safety applications', displayOrder: 60, defaultGstRatePct: 18 },
];

const seed = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);

    let created = 0, updated = 0, skipped = 0;

    for (const grade of DEFAULT_GRADES) {
      const existing = await ProductGrade.findOne({ code: grade.code });

      if (existing) {
        let changed = false;
        ['label', 'description', 'displayOrder', 'defaultGstRatePct'].forEach((key) => {
          if (existing[key] !== grade[key]) {
            existing[key] = grade[key];
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
        await ProductGrade.create({ ...grade, isSystemDefault: true });
        created++;
      }
    }

    logger.info('═══════════════════════════════════════');
    logger.info(`📊 Product Grades Seeding Complete`);
    logger.info('═══════════════════════════════════════');
    logger.info(`   Created: ${created} | Updated: ${updated} | Skipped: ${skipped}`);
    logger.info(`   Total in DB: ${await ProductGrade.countDocuments()}`);

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    logger.error('Seeding failed:', error);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  }
};

seed();
