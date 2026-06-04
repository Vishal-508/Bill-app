require('dotenv').config();
if (process.env.NODE_ENV !== 'production') {
  const dns = require('dns');
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
}

const mongoose = require('mongoose');
const { Vendor } = require('../src/models');
const logger = require('../src/config/logger');

/**
 * Idempotent vendor seed. Re-runs are safe — vendors keyed by name + gstin.
 * Real production should replace these with actual vendors via admin UI.
 */
const SAMPLE_VENDORS = [
  {
    name: 'Indore MDF Suppliers',
    companyName: 'Indore MDF Suppliers Pvt Ltd',
    phone: '9876543210',
    email: 'sales@indoremdf.example',
    gstin: '23AAAAA0000A1Z5',
    address: {
      line1: 'Plot 14, MIDC Industrial Area',
      city: 'Indore',
      state: 'Madhya Pradesh',
      stateCode: '23',
      pincode: '452015',
    },
    avgLeadTimeDays: 7,
    paymentTerms: 'Net 30',
    notes: 'Primary supplier for 18mm sheets',
  },
  {
    name: 'Bhopal Boards',
    companyName: 'Bhopal Boards & Plywoods',
    phone: '9876512340',
    email: 'orders@bhopalboards.example',
    gstin: '23BBBBB1111B1Z6',
    address: {
      line1: 'Govindpura Industrial Area',
      city: 'Bhopal',
      state: 'Madhya Pradesh',
      stateCode: '23',
      pincode: '462023',
    },
    avgLeadTimeDays: 10,
    paymentTerms: 'Net 45',
    notes: 'Backup supplier; longer lead time but better pricing on bulk',
  },
  {
    name: 'Pithampur Premier Wood',
    companyName: 'Pithampur Premier Wood Industries',
    phone: '9876598760',
    email: 'enquiry@ppwi.example',
    gstin: '23CCCCC2222C1Z7',
    address: {
      line1: 'Sector 3, Pithampur Industrial Hub',
      city: 'Pithampur',
      state: 'Madhya Pradesh',
      stateCode: '23',
      pincode: '454775',
    },
    avgLeadTimeDays: 5,
    paymentTerms: 'Net 15',
    notes: 'Fastest delivery; premium pricing',
  },
];

const seed = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);

    let created = 0, updated = 0, skipped = 0;

    for (const v of SAMPLE_VENDORS) {
      const existing = await Vendor.findOne({ gstin: v.gstin });
      if (existing) {
        let changed = false;
        ['name', 'companyName', 'phone', 'email', 'avgLeadTimeDays', 'paymentTerms', 'notes'].forEach(field => {
          if (JSON.stringify(existing[field]) !== JSON.stringify(v[field])) {
            existing[field] = v[field];
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
        await Vendor.create(v);
        created++;
      }
    }

    logger.info(`✅ Vendors: ${created} created, ${updated} updated, ${skipped} skipped`);
    logger.info(`   Total: ${await Vendor.countDocuments({ isDeleted: false })}`);

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    logger.error('Vendor seed failed:', error);
    process.exit(1);
  }
};

seed();
