require('dotenv').config();

if (process.env.NODE_ENV !== 'production') {
  const dns = require('dns');
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
}

const mongoose = require('mongoose');
const { Customer, BusinessSegment, User } = require('../src/models');
const logger = require('../src/config/logger');

const seed = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);

    // Fetch the admin user as createdBy
    const admin = await User.findOne({ role: { $in: ['ADMIN', 'SUPER_ADMIN'] } });
    if (!admin) {
      logger.error('No admin user found. Run npm run seed:admin first.');
      process.exit(1);
    }

    // Fetch segments
    const segMap = {};
    const segments = await BusinessSegment.find();
    segments.forEach(s => { segMap[s.code] = s._id; });

    // Clean previous test customers (phones starting with 8000)
    await Customer.deleteMany({ phone: /^8000/ });

    const testCustomers = [
      // Photo studios
      { customerName: 'Rajesh Kumar', companyName: 'Kumar Photography', phone: '8000000001', businessSegment: segMap.PHOTO_STUDIO, businessSize: 'SMALL', acquisitionSource: 'GOOGLE', tags: ['VIP', 'Trusted'], creditLimit: 50000, currentDues: 0, billingAddress: { city: 'Indore', state: 'Madhya Pradesh', pincode: '452001' }, purchaseInsights: { totalOrders: 12, totalRevenue: 145000, lifetimeValue: 145000, avgOrderValue: 12083 } },
      { customerName: 'Priya Sharma', companyName: 'Priya Studios', phone: '8000000002', businessSegment: segMap.PHOTO_STUDIO, businessSize: 'INDIVIDUAL', acquisitionSource: 'REFERRAL', tags: ['Trusted'], creditLimit: 20000, currentDues: 5000, billingAddress: { city: 'Indore', state: 'Madhya Pradesh', pincode: '452010' }, purchaseInsights: { totalOrders: 8, totalRevenue: 65000, lifetimeValue: 65000 } },

      // Interior designers
      { customerName: 'Anil Mehta', companyName: 'Mehta Interiors', phone: '8000000003', businessSegment: segMap.INTERIOR_DESIGN, businessSize: 'MEDIUM', acquisitionSource: 'JUSTDIAL', tags: ['VIP', 'Big Order'], gstin: '23ABCDE1234F1Z5', creditLimit: 150000, currentDues: 25000, billingAddress: { city: 'Bhopal', state: 'Madhya Pradesh', pincode: '462001' }, purchaseInsights: { totalOrders: 22, totalRevenue: 480000, lifetimeValue: 480000 } },
      { customerName: 'Sunita Verma', companyName: 'Design Studio Verma', phone: '8000000004', businessSegment: segMap.INTERIOR_DESIGN, businessSize: 'SMALL', acquisitionSource: 'INDIAMART', tags: ['Trusted'], creditLimit: 75000, currentDues: 0, billingAddress: { city: 'Indore', state: 'Madhya Pradesh', pincode: '452015' }, purchaseInsights: { totalOrders: 15, totalRevenue: 220000, lifetimeValue: 220000 } },

      // Furniture makers
      { customerName: 'Mohan Carpenter', phone: '8000000005', businessSegment: segMap.FURNITURE_MAKER, businessSize: 'INDIVIDUAL', acquisitionSource: 'WALK_IN', tags: [], creditLimit: 10000, currentDues: 2500, billingAddress: { city: 'Indore', state: 'Madhya Pradesh', pincode: '452007' }, purchaseInsights: { totalOrders: 5, totalRevenue: 28000, lifetimeValue: 28000 } },
      { customerName: 'Suresh Wadhwa', companyName: 'Wadhwa Furniture Co', phone: '8000000006', businessSegment: segMap.FURNITURE_MAKER, businessSize: 'LARGE', acquisitionSource: 'EXHIBITION', tags: ['VIP', 'Bulk'], gstin: '23PQRST5678U2Z9', creditLimit: 500000, currentDues: 75000, billingAddress: { city: 'Mumbai', state: 'Maharashtra', pincode: '400001' }, purchaseInsights: { totalOrders: 45, totalRevenue: 1250000, lifetimeValue: 1250000 } },

      // Modular kitchen
      { customerName: 'Ramesh Singh', companyName: 'Singh Modular Kitchen', phone: '8000000007', businessSegment: segMap.MODULAR_KITCHEN, businessSize: 'MEDIUM', acquisitionSource: 'GOOGLE', tags: ['Trusted'], creditLimit: 200000, currentDues: 0, billingAddress: { city: 'Pune', state: 'Maharashtra', pincode: '411001' }, purchaseInsights: { totalOrders: 18, totalRevenue: 380000, lifetimeValue: 380000 } },

      // Gift packaging
      { customerName: 'Neha Agarwal', companyName: 'Neha Gifts', phone: '8000000008', businessSegment: segMap.GIFT_PACKAGING, businessSize: 'SMALL', acquisitionSource: 'SOCIAL_MEDIA', tags: ['Festival', 'Repeat'], creditLimit: 30000, currentDues: 8000, billingAddress: { city: 'Indore', state: 'Madhya Pradesh', pincode: '452003' }, purchaseInsights: { totalOrders: 28, totalRevenue: 95000, lifetimeValue: 95000 } },

      // Signage
      { customerName: 'Vikram Yadav', companyName: 'Yadav Signs', phone: '8000000009', businessSegment: segMap.SIGNAGE, businessSize: 'SMALL', acquisitionSource: 'JUSTDIAL', tags: [], creditLimit: 25000, currentDues: 0, billingAddress: { city: 'Indore', state: 'Madhya Pradesh', pincode: '452009' }, purchaseInsights: { totalOrders: 7, totalRevenue: 42000, lifetimeValue: 42000 } },

      // Construction
      { customerName: 'Ashok Builders', companyName: 'Ashok Construction Co', phone: '8000000010', businessSegment: segMap.CONSTRUCTION, businessSize: 'LARGE', acquisitionSource: 'REFERRAL', tags: ['VIP', 'Bulk'], gstin: '27ABCDE9876F3Z2', creditLimit: 1000000, currentDues: 250000, billingAddress: { city: 'Mumbai', state: 'Maharashtra', pincode: '400050' }, purchaseInsights: { totalOrders: 60, totalRevenue: 2500000, lifetimeValue: 2500000 } },

      // DIY hobbyists
      { customerName: 'Ravi Joshi', phone: '8000000011', businessSegment: segMap.DIY_HOBBYIST, businessSize: 'INDIVIDUAL', acquisitionSource: 'WALK_IN', tags: [], creditLimit: 0, currentDues: 0, billingAddress: { city: 'Indore', state: 'Madhya Pradesh', pincode: '452002' }, purchaseInsights: { totalOrders: 2, totalRevenue: 4500, lifetimeValue: 4500 } },
      { customerName: 'Anjali Gupta', phone: '8000000012', businessSegment: segMap.DIY_HOBBYIST, businessSize: 'INDIVIDUAL', acquisitionSource: 'WHATSAPP', tags: ['New'], creditLimit: 0, currentDues: 0, billingAddress: { city: 'Delhi', state: 'Delhi', pincode: '110001' }, purchaseInsights: { totalOrders: 1, totalRevenue: 1500, lifetimeValue: 1500 } },

      // Office furniture
      { customerName: 'Corporate Solutions', companyName: 'Corporate Office Solutions', phone: '8000000013', businessSegment: segMap.OFFICE_FURNITURE, businessSize: 'MEDIUM', acquisitionSource: 'GOOGLE', tags: ['Trusted'], gstin: '23XYZAB4567C8Z1', creditLimit: 300000, currentDues: 50000, billingAddress: { city: 'Bangalore', state: 'Karnataka', pincode: '560001' }, purchaseInsights: { totalOrders: 14, totalRevenue: 320000, lifetimeValue: 320000 } },

      // Retail
      { customerName: 'Kishore Retail', companyName: 'Kishore Hardware', phone: '8000000014', businessSegment: segMap.RETAIL_SHOP, businessSize: 'SMALL', acquisitionSource: 'EXISTING_CUSTOMER', tags: ['Bulk'], gstin: '23QRSTU1234V5Z6', creditLimit: 100000, currentDues: 0, billingAddress: { city: 'Indore', state: 'Madhya Pradesh', pincode: '452006' }, purchaseInsights: { totalOrders: 35, totalRevenue: 425000, lifetimeValue: 425000 } },

      // Other
      { customerName: 'Unknown Customer', phone: '8000000015', businessSegment: segMap.OTHER, businessSize: 'INDIVIDUAL', acquisitionSource: 'OTHER', tags: [], creditLimit: 5000, currentDues: 1200, billingAddress: { city: 'Indore', state: 'Madhya Pradesh', pincode: '452008' }, purchaseInsights: { totalOrders: 3, totalRevenue: 7500, lifetimeValue: 7500 } },
    ];

    let created = 0;
    for (const c of testCustomers) {
      await Customer.create({
        ...c,
        createdBy: admin._id,
        purchaseInsights: {
          ...c.purchaseInsights,
          firstOrderDate: new Date('2024-06-01'),
          lastOrderDate: new Date('2026-05-15'),
        },
      });
      created++;
    }

    logger.info(`✅ Seeded ${created} test customers (phones 8000000001-8000000015)`);
    logger.info(`   Use these for query/filter/search/analytics testing`);
    logger.info(`   To clean up: db.customers.deleteMany({ phone: /^8000/ })`);

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    logger.error('Seeding failed:', error);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  }
};

seed();
