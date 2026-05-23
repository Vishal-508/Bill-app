require('dotenv').config();
if (process.env.NODE_ENV !== 'production') {
  const dns = require('dns');
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
}

const mongoose = require('mongoose');
const { Product, Customer, User, Order, StockMovement } = require('../src/models');
const stockService = require('../src/utils/stockService');
const { generateOrderNumber } = require('../src/utils/orderNumberGenerator');
const logger = require('../src/config/logger');

const test = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);

    let pass = 0, fail = 0;
    const failures = [];

    const assert = (name, condition, detail = '') => {
      if (condition) {
        pass++;
        logger.info(`  ✅ ${name}`);
      } else {
        fail++;
        const msg = `${name}${detail ? ` — ${detail}` : ''}`;
        logger.error(`  ❌ ${msg}`);
        failures.push(msg);
      }
    };

    const customer = await Customer.findOne({ phone: '8000000001' });
    const rawSheet = await Product.findOne({ productType: 'RAW_SHEET', currentStock: { $gte: 10 } });
    const bundle = await Product.findOne({ productType: 'PRE_CUT_BUNDLE', 'bundle.currentBundles': { $gte: 2 } });
    const admin = await User.findOne({ role: { $in: ['ADMIN', 'SUPER_ADMIN'] } });

    if (!rawSheet || !bundle || !customer || !admin) {
      logger.error('Missing test data');
      process.exit(1);
    }

    const rawStockBefore = rawSheet.currentStock;
    const bundleStockBefore = bundle.bundle.currentBundles;
    const customerLifetimeBefore = customer.purchaseInsights?.lifetimeValue || 0;
    const customerOrdersBefore = customer.purchaseInsights?.totalOrders || 0;
    const customerRevenueBefore = customer.purchaseInsights?.totalRevenue || 0;
    const customerAvgBefore = customer.purchaseInsights?.avgOrderValue || 0;
    const customerDuesBefore = customer.currentDues || 0;

    logger.info(`\nInitial state:`);
    logger.info(`  Raw sheet ${rawSheet.sku}: ${rawStockBefore} units`);
    logger.info(`  Bundle ${bundle.sku}: ${bundleStockBefore} bundles`);
    logger.info(`  Customer lifetime: ₹${customerLifetimeBefore}, dues: ₹${customerDuesBefore}`);

    // Test 1: Stock availability check
    logger.info('\nTest 1: Stock availability check');

    const availResult = await stockService.checkStockAvailability([
      { itemType: 'FULL_SHEET', product: rawSheet._id, quantity: 3 },
      { itemType: 'BUNDLE', product: bundle._id, quantity: 1 },
    ]);
    assert('Sufficient stock check', availResult.sufficient === true);

    const overReq = await stockService.checkStockAvailability([
      { itemType: 'FULL_SHEET', product: rawSheet._id, quantity: 99999 },
    ]);
    assert('Over-requested stock flagged', overReq.sufficient === false && overReq.issues.length === 1);

    // Test 2: Create test order
    logger.info('\nTest 2: Create test order');

    const orderNumber = await generateOrderNumber();
    const order = await Order.create({
      orderNumber,
      customer: customer._id,
      customerSnapshot: {
        customerName: customer.customerName,
        phone: customer.phone,
        billingState: customer.billingAddress?.state || 'Madhya Pradesh',
      },
      items: [
        {
          itemType: 'FULL_SHEET',
          product: rawSheet._id,
          productSnapshot: { sku: rawSheet.sku, name: rawSheet.name, productType: 'RAW_SHEET' },
          quantity: 3,
          pricePerUnit: rawSheet.basePrice * rawSheet.areaSqFt,
          materialCost: rawSheet.basePrice * rawSheet.areaSqFt * 3,
          lineSubtotal: rawSheet.basePrice * rawSheet.areaSqFt * 3,
        },
        {
          itemType: 'BUNDLE',
          product: bundle._id,
          productSnapshot: { sku: bundle.sku, name: bundle.name, productType: 'PRE_CUT_BUNDLE' },
          quantity: 1,
          pricePerUnit: bundle.bundle.pricePerBundle,
          materialCost: bundle.bundle.pricePerBundle,
          lineSubtotal: bundle.bundle.pricePerBundle,
        },
      ],
      subtotal: (rawSheet.basePrice * rawSheet.areaSqFt * 3) + bundle.bundle.pricePerBundle,
      taxableAmount: (rawSheet.basePrice * rawSheet.areaSqFt * 3) + bundle.bundle.pricePerBundle,
      gstRatePct: 18,
      cgst: ((rawSheet.basePrice * rawSheet.areaSqFt * 3) + bundle.bundle.pricePerBundle) * 0.09,
      sgst: ((rawSheet.basePrice * rawSheet.areaSqFt * 3) + bundle.bundle.pricePerBundle) * 0.09,
      totalGst: ((rawSheet.basePrice * rawSheet.areaSqFt * 3) + bundle.bundle.pricePerBundle) * 0.18,
      totalAmount: ((rawSheet.basePrice * rawSheet.areaSqFt * 3) + bundle.bundle.pricePerBundle) * 1.18,
      paymentMode: 'FULL_UPFRONT',
      createdBy: admin._id,
      customerNotes: 'STOCK_TEST',
    });
    assert('Test order created', order._id != null);
    assert('Order status PENDING (no deduction yet)', order.status === 'PENDING');

    // Test 3: Stock NOT deducted yet
    logger.info('\nTest 3: Verify stock unchanged in PENDING');
    const rawAfterCreate = await Product.findById(rawSheet._id);
    const bundleAfterCreate = await Product.findById(bundle._id);
    assert('Raw stock unchanged in PENDING', rawAfterCreate.currentStock === rawStockBefore,
           `Before: ${rawStockBefore}, After: ${rawAfterCreate.currentStock}`);
    assert('Bundle stock unchanged in PENDING', bundleAfterCreate.bundle.currentBundles === bundleStockBefore);

    // Test 4: Deduct stock
    logger.info('\nTest 4: Deduction triggers');
    await stockService.deductForOrder(order, admin._id);

    const rawAfterDeduct = await Product.findById(rawSheet._id);
    const bundleAfterDeduct = await Product.findById(bundle._id);
    assert('Raw stock deducted by 3', rawAfterDeduct.currentStock === rawStockBefore - 3);
    assert('Bundle stock deducted by 1', bundleAfterDeduct.bundle.currentBundles === bundleStockBefore - 1);

    // Test 5: Audit trail
    logger.info('\nTest 5: Audit trail created');
    const movements = await StockMovement.find({ relatedOrder: order._id });
    assert('2 stock movements created', movements.length === 2);
    assert('All are DEDUCTION type', movements.every(m => m.movementType === 'DEDUCTION'));

    // Test 6: Restore
    logger.info('\nTest 6: Restore stock (cancellation)');
    await stockService.restoreForOrder(order, admin._id);

    const rawAfterRestore = await Product.findById(rawSheet._id);
    const bundleAfterRestore = await Product.findById(bundle._id);
    assert('Raw stock restored', rawAfterRestore.currentStock === rawStockBefore);
    assert('Bundle stock restored', bundleAfterRestore.bundle.currentBundles === bundleStockBefore);

    const restoreMovements = await StockMovement.find({
      relatedOrder: order._id,
      movementType: 'RESTORATION'
    });
    assert('2 restoration movements logged', restoreMovements.length === 2);

    // Test 7: Customer insights
    logger.info('\nTest 7: Customer insights update');
    order.status = 'COMPLETED';
    await stockService.updateCustomerInsights(order);

    const customerAfter = await Customer.findById(customer._id);
    const newLifetime = customerAfter.purchaseInsights?.lifetimeValue || 0;
    assert('Customer lifetime increased', newLifetime > customerLifetimeBefore,
           `Before: ${customerLifetimeBefore}, After: ${newLifetime}`);
    assert('Customer total orders incremented',
           customerAfter.purchaseInsights?.totalOrders >= 1);

    // Cleanup
    logger.info('\nCleanup');
    await StockMovement.deleteMany({ relatedOrder: order._id });
    await Order.deleteOne({ _id: order._id });

    // Restore all customer fields touched by updateCustomerInsights
    customer.purchaseInsights = customer.purchaseInsights || {};
    customer.purchaseInsights.lifetimeValue = customerLifetimeBefore;
    customer.purchaseInsights.totalOrders = customerOrdersBefore;
    customer.purchaseInsights.totalRevenue = customerRevenueBefore;
    customer.purchaseInsights.avgOrderValue = customerAvgBefore;
    customer.currentDues = customerDuesBefore;
    await customer.save();

    logger.info('✅ Test data cleaned up');

    await mongoose.disconnect();

    logger.info('\n═══════════════════════════════════════');
    logger.info(`📊 Stock Integration Tests: ${pass}/${pass + fail} passed`);
    if (failures.length > 0) {
      logger.info('\nFailures:');
      failures.forEach((f, i) => logger.info(`  ${i + 1}. ${f}`));
    }

    process.exit(fail === 0 ? 0 : 1);
  } catch (error) {
    logger.error('Test crashed:', error);
    process.exit(1);
  }
};

test();
