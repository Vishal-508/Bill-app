require('dotenv').config();
if (process.env.NODE_ENV !== 'production') {
  const dns = require('dns');
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
}

const mongoose = require('mongoose');
const { ShapeCuttingRate } = require('../src/models');
const logger = require('../src/config/logger');

const DEFAULT_SHAPES = [
  {
    code: 'RECTANGLE',
    label: 'Rectangle',
    description: 'Standard 4-sided rectangular cuts',
    iconName: 'square',
    calculationMode: 'multiplier',
    baseMultiplier: 1.0,
    cutsPerPiece: 4,
    displayOrder: 10,
    isSystemDefault: true,
  },
  {
    code: 'TRIANGLE',
    label: 'Triangle',
    description: '3-sided angled cuts',
    iconName: 'triangle',
    calculationMode: 'multiplier',
    baseMultiplier: 1.5,
    cutsPerPiece: 3,
    displayOrder: 20,
    isSystemDefault: true,
  },
  {
    code: 'HEXAGON',
    label: 'Hexagon',
    description: '6-sided cuts for modular designs',
    iconName: 'hexagon',
    calculationMode: 'multiplier',
    baseMultiplier: 2.0,
    cutsPerPiece: 6,
    displayOrder: 30,
    isSystemDefault: true,
  },
  {
    code: 'ROUND',
    label: 'Round / Disk',
    description: 'Circular cuts using router or jigsaw',
    iconName: 'circle',
    calculationMode: 'multiplier',
    baseMultiplier: 2.5,
    cutsPerPiece: 1,
    displayOrder: 40,
    isSystemDefault: true,
  },
];

const seed = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);

    let created = 0, skipped = 0;
    for (const shape of DEFAULT_SHAPES) {
      const existing = await ShapeCuttingRate.findOne({ code: shape.code });
      if (existing) {
        skipped++;
      } else {
        await ShapeCuttingRate.create(shape);
        created++;
      }
    }

    logger.info(`✅ Shapes: ${created} created, ${skipped} skipped`);
    logger.info(`   Total: ${await ShapeCuttingRate.countDocuments()}`);
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    logger.error('Failed:', error);
    process.exit(1);
  }
};

seed();
