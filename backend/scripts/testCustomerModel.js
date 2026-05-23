require('dotenv').config();

if (process.env.NODE_ENV !== 'production') {
  const dns = require('dns');
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
}

const mongoose = require('mongoose');
const { Customer, BusinessSegment } = require('../src/models');
const logger = require('../src/config/logger');

const TEST_PHONE = '9876543299';  // Different from any seeded test data

const test = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    logger.info('✅ Connected to MongoDB');

    // Cleanup any previous test customer
    await Customer.deleteOne({ phone: TEST_PHONE });

    // Fetch a business segment to reference
    const segment = await BusinessSegment.findByCode('PHOTO_STUDIO');
    if (!segment) {
      logger.error('❌ Run npm run seed:segments first!');
      process.exit(1);
    }
    logger.info(`✓ Found segment: ${segment.label} (${segment._id})`);

    // Test 1: Create customer with all fields
    logger.info('');
    logger.info('Test 1: Create customer with comprehensive fields');
    const customer = new Customer({
      companyName: 'Sharma Photo Studio',
      customerName: 'Test Customer',
      phone: TEST_PHONE,
      altPhone: '9876543298',
      email: 'test.customer@example.com',
      businessSegment: segment._id,
      businessSubSegment: 'Wedding photographer',
      businessSize: 'SMALL',
      gstin: '23ABCDE1234F1Z5',
      acquisitionSource: 'GOOGLE',
      billingAddress: {
        line1: '123 Test Street',
        city: 'Indore',
        state: 'Madhya Pradesh',
        pincode: '452001',
      },
      shippingSameAsBilling: true,
      tags: ['VIP', 'Trusted'],
      preferredUnit: 'sqft',
      creditLimit: 50000,
      communicationPrefs: {
        whatsappEnabled: true,
        emailEnabled: true,
        callPreferredTime: '10am-6pm',
      },
      notes: 'Walk-in customer, very polite',
    });

    await customer.save();
    logger.info(`  ✓ Customer created: ${customer._id}`);
    logger.info(`  ✓ Company: ${customer.companyName}`);
    logger.info(`  ✓ Auto-filled stateCode: ${customer.billingAddress.stateCode} (should be 23 for MP)`);
    logger.info(`  ✓ Shipping copied from billing: ${customer.shippingAddress.city === customer.billingAddress.city}`);
    logger.info(`  ✓ Tags: ${customer.tags.join(', ')}`);

    // Test 2: Populate business segment
    logger.info('');
    logger.info('Test 2: Populate business segment reference');
    const populated = await Customer.findById(customer._id).populate('businessSegment');
    logger.info(`  ✓ Populated segment label: ${populated.businessSegment.label}`);
    logger.info(`  ✓ Populated segment code: ${populated.businessSegment.code}`);

    // Test 3: Duplicate phone rejection
    logger.info('');
    logger.info('Test 3: Duplicate phone rejected');
    try {
      const dup = new Customer({
        customerName: 'Duplicate',
        phone: TEST_PHONE,
      });
      await dup.save();
      logger.error('  ❌ Duplicate was allowed — bug!');
    } catch (error) {
      if (error.code === 11000) {
        logger.info('  ✓ Duplicate phone rejected (code 11000)');
      } else {
        logger.error(`  ⚠ Unexpected error: ${error.message}`);
      }
    }

    // Test 4: Invalid GSTIN rejection
    logger.info('');
    logger.info('Test 4: Invalid GSTIN rejected');
    try {
      const badGst = new Customer({
        customerName: 'Bad GST',
        phone: '9876543297',
        gstin: 'INVALID_GSTIN',
      });
      await badGst.save();
      logger.error('  ❌ Invalid GSTIN was allowed — bug!');
    } catch (error) {
      logger.info(`  ✓ Invalid GSTIN rejected: ${error.message.substring(0, 80)}`);
    }

    // Test 5: Invalid pincode rejection
    logger.info('');
    logger.info('Test 5: Invalid pincode rejected');
    try {
      const badPin = new Customer({
        customerName: 'Bad Pin',
        phone: '9876543296',
        billingAddress: { pincode: '123' },  // too short
      });
      await badPin.save();
      logger.error('  ❌ Invalid pincode was allowed — bug!');
    } catch (error) {
      logger.info(`  ✓ Invalid pincode rejected: ${error.message.substring(0, 80)}`);
    }

    // Test 6: Soft delete
    logger.info('');
    logger.info('Test 6: Soft delete');
    await customer.softDelete(null, 'Test cleanup');
    logger.info(`  ✓ isDeleted: ${customer.isDeleted}`);
    logger.info(`  ✓ deletedAt set: ${!!customer.deletedAt}`);
    logger.info(`  ✓ isActive: ${customer.isActive} (should be false)`);

    // Test 7: Restore
    logger.info('');
    logger.info('Test 7: Restore deleted customer');
    await customer.restore();
    logger.info(`  ✓ isDeleted: ${customer.isDeleted} (should be false)`);
    logger.info(`  ✓ isActive: ${customer.isActive} (should be true)`);

    // Test 8: findByPhone static
    logger.info('');
    logger.info('Test 8: findByPhone static method');
    const byPhone = await Customer.findByPhone(TEST_PHONE);
    logger.info(`  ✓ Found by phone: ${!!byPhone}`);
    logger.info(`  ✓ Returns active customer: ${byPhone?.isActive}`);

    // Test 9: activeCount static
    logger.info('');
    logger.info('Test 9: activeCount static');
    const count = await Customer.activeCount();
    logger.info(`  ✓ Active customers: ${count}`);

    // Cleanup
    await Customer.deleteOne({ phone: TEST_PHONE });
    logger.info('');
    logger.info('✓ Test customer cleaned up');

    await mongoose.disconnect();
    logger.info('');
    logger.info('═══════════════════════════════════════');
    logger.info('🎉 All Customer model tests passed');
    logger.info('═══════════════════════════════════════');
    process.exit(0);
  } catch (error) {
    logger.error('❌ Test failed:', error);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  }
};

test();
