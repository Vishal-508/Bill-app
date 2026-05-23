require('dotenv').config();
if (process.env.NODE_ENV !== 'production') {
  const dns = require('dns');
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
}

const mongoose = require('mongoose');
const { Order, Customer, Product, User, SystemSetting } = require('../src/models');
const { generateOrderNumber, getFinancialYear } = require('../src/utils/orderNumberGenerator');
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

    // ─── Test 1: SystemSetting helpers ───
    logger.info('\nTest 1: SystemSetting');
    const lockStatus = await SystemSetting.getValue('ORDER_EDIT_LOCK_STATUS', 'NEVER');
    assert('Get ORDER_EDIT_LOCK_STATUS', lockStatus === 'COMPLETED', `Got: ${lockStatus}`);

    const orderSettings = await SystemSetting.getCategory('ORDER');
    assert('Get ORDER category settings', orderSettings.length >= 3, `Count: ${orderSettings.length}`);

    // ─── Test 2: Order number generation ───
    logger.info('\nTest 2: Order number generation');

    await Order.deleteMany({ orderNumber: { $regex: /^ORD-/ }, customerNotes: 'SMOKE_TEST' });

    const orderNum1 = await generateOrderNumber();
    const year = new Date().getFullYear();
    assert(`Order # format ORD-${year}-NNN`, orderNum1.startsWith(`ORD-${year}-`), `Got: ${orderNum1}`);

    // ─── Test 3: Financial year ───
    logger.info('\nTest 3: Financial year computation');

    const fyJune = getFinancialYear(new Date('2026-06-15'));
    assert('FY for June 2026 is 2026-27', fyJune === '2026-27', `Got: ${fyJune}`);

    const fyFeb = getFinancialYear(new Date('2026-02-15'));
    assert('FY for Feb 2026 is 2025-26', fyFeb === '2025-26', `Got: ${fyFeb}`);

    // ─── Test 4: Create order ───
    logger.info('\nTest 4: Create order with mixed items');

    const customer = await Customer.findOne({ phone: '8000000001' });
    if (!customer) {
      logger.warn('No test customer found, skipping order creation tests');
      logger.info(`\n📊 Tests: ${pass}/${pass + fail} passed`);
      await mongoose.disconnect();
      process.exit(fail === 0 ? 0 : 1);
    }

    const rawSheet = await Product.findOne({ productType: 'RAW_SHEET' });
    const bundle = await Product.findOne({ productType: 'PRE_CUT_BUNDLE' });
    const admin = await User.findOne({ role: { $in: ['ADMIN', 'SUPER_ADMIN'] } });

    if (!rawSheet || !bundle || !admin) {
      logger.warn('Missing test data for order creation, skipping');
      logger.info(`\n📊 Tests: ${pass}/${pass + fail} passed`);
      await mongoose.disconnect();
      process.exit(fail === 0 ? 0 : 1);
    }

    const order = new Order({
      orderNumber: orderNum1,
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
          productSnapshot: {
            sku: rawSheet.sku,
            name: rawSheet.name,
            productType: rawSheet.productType,
            thicknessMM: rawSheet.thicknessMM,
          },
          quantity: 5,
          pricePerUnit: rawSheet.basePrice * 32,
          materialCost: rawSheet.basePrice * 32 * 5,
          lineSubtotal: rawSheet.basePrice * 32 * 5,
        },
        {
          itemType: 'BUNDLE',
          product: bundle._id,
          productSnapshot: {
            sku: bundle.sku,
            name: bundle.name,
            productType: bundle.productType,
          },
          quantity: 2,
          pricePerUnit: bundle.bundle?.pricePerBundle || 2000,
          materialCost: (bundle.bundle?.pricePerBundle || 2000) * 2,
          lineSubtotal: (bundle.bundle?.pricePerBundle || 2000) * 2,
        },
      ],
      subtotal: 0,
      taxableAmount: 0,
      gstRatePct: 18,
      totalAmount: 0,
      paymentMode: 'FULL_UPFRONT',
      createdBy: admin._id,
      customerNotes: 'SMOKE_TEST',
    });

    order.subtotal = order.items.reduce((sum, it) => sum + it.lineSubtotal, 0);
    order.taxableAmount = order.subtotal;
    order.cgst = +(order.taxableAmount * 0.09).toFixed(2);
    order.sgst = +(order.taxableAmount * 0.09).toFixed(2);
    order.totalGst = order.cgst + order.sgst;
    order.totalAmount = +(order.taxableAmount + order.totalGst).toFixed(2);

    await order.save();
    assert('Order created with mixed items', order._id != null);
    assert('Order has 2 items', order.items.length === 2);
    assert('Financial year auto-computed', order.financialYear?.match(/^\d{4}-\d{2}$/) != null, `Got: ${order.financialYear}`);
    assert('Status history has initial entry', order.statusHistory.length === 1);
    assert('Payment status = UNPAID', order.paymentStatus === 'UNPAID');
    assert('Amount due = total', order.amountDue === order.totalAmount);

    // ─── Test 5: Update payment ───
    logger.info('\nTest 5: Add partial payment');

    order.amountPaid = 5000;
    await order.save();
    assert('Payment status = PARTIAL', order.paymentStatus === 'PARTIAL', `Got: ${order.paymentStatus}`);
    assert('Amount due decreased', order.amountDue === +(order.totalAmount - 5000).toFixed(2));

    // ─── Test 6: Full payment ───
    order.amountPaid = order.totalAmount;
    await order.save();
    assert('Payment status = PAID after full payment', order.paymentStatus === 'PAID');
    assert('Amount due = 0', order.amountDue === 0);

    // ─── Test 7: Status transition ───
    logger.info('\nTest 7: Status transitions');

    order._statusChangedByUser = admin._id;
    order._statusChangeNotes = 'Started processing';
    order.status = 'IN_PROGRESS';
    await order.save();
    assert('Status changed to IN_PROGRESS', order.status === 'IN_PROGRESS');
    assert('Status history has 2 entries', order.statusHistory.length === 2);

    // ─── Test 8: canEdit() ───
    logger.info('\nTest 8: Edit lock');

    const canEditInProgress = await order.canEdit();
    assert('Can edit when IN_PROGRESS (lock=COMPLETED)', canEditInProgress === true);

    order.status = 'COMPLETED';
    await order.save();
    const canEditCompleted = await order.canEdit();
    assert('Cannot edit when COMPLETED', canEditCompleted === false);

    // ─── Cleanup ───
    await Order.deleteOne({ _id: order._id });
    logger.info('\n✅ Test order cleaned up');

    await mongoose.disconnect();

    logger.info('\n═══════════════════════════════════════');
    logger.info(`📊 Tests: ${pass}/${pass + fail} passed`);
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
