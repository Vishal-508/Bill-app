require('dotenv').config();
if (process.env.NODE_ENV !== 'production') {
  const dns = require('dns');
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
}

const mongoose = require('mongoose');
const { Order, Customer, Product, User } = require('../src/models');
const { generateOrderNumber } = require('../src/utils/orderNumberGenerator');
const paymentService = require('../src/utils/paymentService');
const logger = require('../src/config/logger');

const test = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);

    let pass = 0, fail = 0;
    const failures = [];

    const assert = (name, condition, detail = '') => {
      if (condition) { pass++; logger.info(`  ✅ ${name}`); }
      else {
        fail++;
        const msg = `${name}${detail ? ` — ${detail}` : ''}`;
        logger.error(`  ❌ ${msg}`);
        failures.push(msg);
      }
    };

    const customer = await Customer.findOne({ phone: '8000000001' });
    const product = await Product.findOne({ productType: 'RAW_SHEET' });
    const admin = await User.findOne({ role: { $in: ['ADMIN', 'SUPER_ADMIN'] } });

    if (!customer || !product || !admin) {
      logger.error('Missing test data');
      process.exit(1);
    }

    logger.info('\nSetup: Creating 3 test orders');
    const orderIds = [];

    for (let i = 0; i < 3; i++) {
      const order = await Order.create({
        orderNumber: await generateOrderNumber(),
        customer: customer._id,
        customerSnapshot: { customerName: customer.customerName, phone: customer.phone, billingState: 'Madhya Pradesh' },
        items: [{
          itemType: 'FULL_SHEET',
          product: product._id,
          productSnapshot: { sku: product.sku, name: product.name, productType: 'RAW_SHEET' },
          quantity: i + 1,
          pricePerUnit: 2000,
          materialCost: 2000 * (i + 1),
          lineSubtotal: 2000 * (i + 1),
        }],
        subtotal: 2000 * (i + 1),
        taxableAmount: 2000 * (i + 1),
        gstRatePct: 18,
        cgst: 180 * (i + 1),
        sgst: 180 * (i + 1),
        totalGst: 360 * (i + 1),
        totalAmount: 2360 * (i + 1),
        paymentMode: 'PARTIAL',
        createdBy: admin._id,
        customerNotes: 'ANALYTICS_TEST',
      });
      orderIds.push(order._id);

      if (i % 2 === 0) {
        await paymentService.addPayment(order._id, {
          amount: 1000,
          mode: i === 0 ? 'CASH' : 'UPI',
        }, admin._id);
      }
    }

    logger.info('  ✅ 3 test orders created');

    // Test 1: Revenue by period
    logger.info('\nTest 1: Revenue by period');
    const revenue = await Order.aggregate([
      { $match: { isDeleted: false, status: { $nin: ['CANCELLED'] } } },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          totalRevenue: { $sum: '$totalAmount' },
        },
      },
    ]);
    assert('Revenue aggregation works', revenue.length > 0 && revenue[0].totalRevenue > 0);

    // Test 2: Top customers
    logger.info('\nTest 2: Top customers aggregation');
    const topCust = await Order.aggregate([
      { $match: { isDeleted: false, status: { $nin: ['CANCELLED'] } } },
      { $group: { _id: '$customer', totalRevenue: { $sum: '$totalAmount' } } },
      { $sort: { totalRevenue: -1 } },
      { $limit: 5 },
    ]);
    assert('Top customers query works', topCust.length > 0);

    // Test 3: Status distribution
    logger.info('\nTest 3: Status distribution');
    const statusDist = await Order.aggregate([
      { $match: { isDeleted: false } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    assert('Status distribution query works', statusDist.length > 0);
    assert('Has PENDING status', statusDist.some(s => s._id === 'PENDING'));

    // Test 4: Sales by product type
    logger.info('\nTest 4: Sales by product type');
    const byType = await Order.aggregate([
      { $match: { isDeleted: false, status: { $nin: ['CANCELLED'] } } },
      { $unwind: '$items' },
      { $group: { _id: '$items.itemType', revenue: { $sum: '$items.lineSubtotal' } } },
    ]);
    assert('Sales by type works', byType.length > 0);
    assert('Has FULL_SHEET sales', byType.some(t => t._id === 'FULL_SHEET'));

    // Test 5: Payment mode distribution
    logger.info('\nTest 5: Payment mode distribution');
    const payModes = await Order.aggregate([
      { $match: { isDeleted: false } },
      { $unwind: '$payments' },
      { $match: { 'payments.amount': { $gt: 0 } } },
      { $group: { _id: '$payments.mode', count: { $sum: 1 } } },
    ]);
    assert('Payment modes detected', payModes.length > 0);

    // Test 6: Cancellation rate
    logger.info('\nTest 6: Cancellation rate calculation');
    const cancStats = await Order.aggregate([
      { $match: { isDeleted: false } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          cancelled: { $sum: { $cond: [{ $eq: ['$status', 'CANCELLED'] }, 1, 0] } },
        },
      },
    ]);
    assert('Cancellation stats calculable', cancStats.length > 0);

    // Test 7: Customer patterns
    logger.info('\nTest 7: Customer patterns');
    const patterns = await Order.aggregate([
      { $match: { isDeleted: false, status: { $nin: ['CANCELLED'] } } },
      {
        $group: {
          _id: '$customer',
          orderCount: { $sum: 1 },
          totalRevenue: { $sum: '$totalAmount' },
        },
      },
    ]);
    assert('Customer patterns work', patterns.length > 0);

    // Test 8: Outstanding totals
    logger.info('\nTest 8: Outstanding payments aggregation');
    const outstanding = await Order.aggregate([
      {
        $match: {
          isDeleted: false,
          status: { $nin: ['CANCELLED'] },
          amountDue: { $gt: 0 },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$amountDue' },
          count: { $sum: 1 },
        },
      },
    ]);
    assert('Outstanding query works', outstanding.length > 0);

    // Cleanup
    logger.info('\nCleanup');
    await Order.deleteMany({ customerNotes: 'ANALYTICS_TEST' });
    await paymentService.syncCustomerDues(customer._id);

    logger.info('✅ Test data cleaned up');

    await mongoose.disconnect();

    logger.info('\n═══════════════════════════════════════');
    logger.info(`📊 Analytics Tests: ${pass}/${pass + fail} passed`);
    if (failures.length > 0) {
      logger.info('\nFailures:');
      failures.forEach((f, i) => logger.info(`  ${i + 1}. ${f}`));
    }

    process.exit(fail === 0 ? 0 : 1);
  } catch (error) {
    logger.error('Test crashed:', error);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  }
};

test();
