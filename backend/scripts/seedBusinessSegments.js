require('dotenv').config();

if (process.env.NODE_ENV !== 'production') {
  const dns = require('dns');
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
}

const mongoose = require('mongoose');
const { BusinessSegment } = require('../src/models');
const logger = require('../src/config/logger');

const DEFAULT_SEGMENTS = [
  { code: 'PHOTO_STUDIO', label: 'Photo Studio', description: 'Photography businesses, studios, photo frames', iconName: 'camera', displayOrder: 10 },
  { code: 'INTERIOR_DESIGN', label: 'Interior Designer', description: 'Interior designers, decorators, consultants', iconName: 'palette', displayOrder: 20 },
  { code: 'FURNITURE_MAKER', label: 'Furniture Maker', description: 'Carpenters, furniture manufacturers, custom furniture', iconName: 'armchair', displayOrder: 30 },
  { code: 'MODULAR_KITCHEN', label: 'Modular Kitchen', description: 'Modular kitchen specialists, kitchen designers', iconName: 'chef-hat', displayOrder: 40 },
  { code: 'WARDROBE', label: 'Wardrobe Specialist', description: 'Custom wardrobe makers', iconName: 'shirt', displayOrder: 50 },
  { code: 'OFFICE_FURNITURE', label: 'Office Furniture', description: 'Office furniture suppliers, workstation makers', iconName: 'briefcase', displayOrder: 60 },
  { code: 'SCHOOL_FURNITURE', label: 'School/Institutional Furniture', description: 'Schools, colleges, institutional furniture', iconName: 'graduation-cap', displayOrder: 70 },
  { code: 'GIFT_PACKAGING', label: 'Gift & Packaging', description: 'Gift makers, packaging businesses, custom boxes', iconName: 'gift', displayOrder: 80 },
  { code: 'SIGNAGE', label: 'Signage & Sign Boards', description: 'Sign board makers, signage businesses', iconName: 'sign', displayOrder: 90 },
  { code: 'EXHIBITION', label: 'Exhibition & Events', description: 'Exhibition stalls, event setup, wedding decorators', iconName: 'tent', displayOrder: 100 },
  { code: 'RETAIL_SHOP', label: 'Retail Shop / Reseller', description: 'Retail stores reselling MDF or related products', iconName: 'store', displayOrder: 110 },
  { code: 'CONSTRUCTION', label: 'Construction / Builder', description: 'Builders, construction contractors, real estate developers', iconName: 'hard-hat', displayOrder: 120 },
  { code: 'ARCHITECT', label: 'Architect Firm', description: 'Architecture firms, design consultancies', iconName: 'building-2', displayOrder: 130 },
  { code: 'DIY_HOBBYIST', label: 'DIY / Hobbyist', description: 'Individual home users, hobbyists, DIY projects', iconName: 'hammer', displayOrder: 140 },
  { code: 'OTHER', label: 'Other', description: 'Catch-all for uncategorized businesses', iconName: 'help-circle', displayOrder: 999 },
];

const seed = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    logger.info('✅ Connected to MongoDB');

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const segment of DEFAULT_SEGMENTS) {
      const existing = await BusinessSegment.findOne({ code: segment.code });

      if (existing) {
        // Update label/description if changed (in case we tweak seed data)
        let changed = false;
        ['label', 'description', 'iconName', 'displayOrder'].forEach((key) => {
          if (existing[key] !== segment[key]) {
            existing[key] = segment[key];
            changed = true;
          }
        });

        if (changed) {
          await existing.save();
          updated++;
          logger.info(`  ↻ Updated: ${segment.code}`);
        } else {
          skipped++;
        }
      } else {
        await BusinessSegment.create({
          ...segment,
          isSystemDefault: true,
        });
        created++;
        logger.info(`  ✓ Created: ${segment.code}`);
      }
    }

    logger.info('═══════════════════════════════════════');
    logger.info(`📊 Business Segments Seeding Complete`);
    logger.info('═══════════════════════════════════════');
    logger.info(`   Created: ${created}`);
    logger.info(`   Updated: ${updated}`);
    logger.info(`   Skipped: ${skipped} (no changes)`);
    logger.info(`   Total in DB: ${await BusinessSegment.countDocuments()}`);
    logger.info('═══════════════════════════════════════');

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    logger.error('❌ Seeding failed:', error);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  }
};

seed();
