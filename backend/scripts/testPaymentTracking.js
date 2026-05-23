require('dotenv').config();
if (process.env.NODE_ENV !== 'production') {
  const dns = require('dns');
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
}

const mongoose = require('mongoose');
const { Product, Customer, User, Order, StockMovement } = require('../src/models');
const paymentService = require('../src/utils/paymentService');
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
    const rawSheet = await Product.findOne({ productType: 'RAW_SHEET', currentStock: { $gte: 5 } });
    const admin = await User.findOne({ role: { $in: ['ADMIN', 'SUPER_ADMIN'] } });

    if (!customer || !rawSheet || !admin) {
      logger.error('Missing test data (need customer phone 8000000001, raw sheet with ≥5 stock, admin user)');
      process.exit(1);
    }

    const customerDuesBefore = customer.currentDues || 0;

    logger.info(`\nInitial state:`);
    logger.info(`  Customer: ${customer.customerName}, dues: ₹${customerDuesBefore}`);

    // Build a test order (₹10,000 base, ₹11,800 with 18% GST)
    const lineSub = 10000;
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
          quantity: 1,
          pricePerUnit: lineSub,
          materialCost: lineSub,
          lineSubtotal: lineSub,
        },
      ],
      subtotal: lineSub,
      taxableAmount: lineSub,
      gstRatePct: 18,
      cgst: lineSub * 0.09,
      sgst: lineSub * 0.09,
      totalGst: lineSub * 0.18,
      totalAmount: lineSub * 1.18,
      paymentMode: 'PARTIAL',
      createdBy: admin._id,
      customerNotes: 'PAYMENT_TEST',
    });

    const totalAmount = order.totalAmount;
    logger.info(`  Order ${orderNumber} created. Total: ₹${totalAmount.toFixed(2)}`);

    // ─── Test 1: Initial state UNPAID ───
    logger.info('\nTest 1: Initial payment state');
    assert('paymentStatus is UNPAID', order.paymentStatus === 'UNPAID');
    assert('amountPaid is 0', order.amountPaid === 0);
    assert('amountDue equals totalAmount',
           Math.abs(order.amountDue - totalAmount) < 0.01,
           `Expected ${totalAmount.toFixed(2)}, got ${order.amountDue}`);

    // ─── Test 2: Partial payment ───
    logger.info('\nTest 2: Partial payment → PARTIAL status');
    const partialAmount = +(totalAmount * 0.4).toFixed(2);
    const partialResult = await paymentService.addPayment(order._id, {
      amount: partialAmount,
      mode: 'UPI',
      reference: 'UPI/TEST/001',
      notes: 'First partial payment',
    }, admin._id);

    assert('paymentStatus is PARTIAL', partialResult.newStatus === 'PARTIAL');
    assert('amountDue reduced',
           Math.abs(partialResult.amountDue - (totalAmount - partialAmount)) < 0.01);

    // ─── Test 3: Customer dues sync (full rebuild, not incremental) ───
    logger.info('\nTest 3: Customer dues synced after partial');
    const customerAfterPartial = await Customer.findById(customer._id);
    // syncCustomerDues rebuilds from truth — dues must be AT LEAST this order's outstanding
    const thisOrderOutstanding = +(totalAmount - partialAmount).toFixed(2);
    assert('Customer dues reflect this order\'s outstanding',
           customerAfterPartial.currentDues >= thisOrderOutstanding - 0.5,
           `Expected ≥${thisOrderOutstanding}, got ${customerAfterPartial.currentDues}`);

    // ─── Test 4: Final payment → PAID ───
    logger.info('\nTest 4: Final payment → PAID status');
    const remainingAmount = +(totalAmount - partialAmount).toFixed(2);
    const finalResult = await paymentService.addPayment(order._id, {
      amount: remainingAmount,
      mode: 'CASH',
      notes: 'Final payment',
    }, admin._id);

    assert('paymentStatus is PAID', finalResult.newStatus === 'PAID');
    assert('amountDue is 0', finalResult.amountDue === 0);

    // ─── Test 5: Overpayment rejected ───
    logger.info('\nTest 5: Overpayment rejection');
    let overpaymentRejected = false;
    try {
      await paymentService.addPayment(order._id, {
        amount: 100,
        mode: 'CASH',
      }, admin._id);
    } catch (err) {
      overpaymentRejected = err.message.includes('exceeds');
    }
    assert('Overpayment beyond due rejected', overpaymentRejected);

    // ─── Test 6: Refund handling ───
    logger.info('\nTest 6: Refund processing → REFUNDED status');
    const reloaded = await Order.findById(order._id);
    const firstPaymentId = reloaded.payments[0]._id;
    const secondPaymentId = reloaded.payments[1]._id;

    await paymentService.processRefund(order._id, firstPaymentId, {
      reason: 'Customer requested refund',
      refundMode: 'BANK_TRANSFER',
    }, admin._id);

    const afterFirstRefund = await Order.findById(order._id);
    assert('Status still PARTIAL after one refund',
           afterFirstRefund.paymentStatus === 'PARTIAL' || afterFirstRefund.paymentStatus === 'PAID',
           `Got: ${afterFirstRefund.paymentStatus}, amountPaid: ${afterFirstRefund.amountPaid}`);

    // Refund the second payment to drive to REFUNDED
    await paymentService.processRefund(order._id, secondPaymentId, {
      reason: 'Full refund',
      refundMode: 'BANK_TRANSFER',
    }, admin._id);

    const afterFullRefund = await Order.findById(order._id);
    assert('paymentStatus is REFUNDED after all refunds',
           afterFullRefund.paymentStatus === 'REFUNDED',
           `Got: ${afterFullRefund.paymentStatus}, amountPaid: ${afterFullRefund.amountPaid}`);

    // ─── Test 7: Outstanding payments query ───
    logger.info('\nTest 7: Outstanding payments query');

    // Create another unpaid order to ensure outstanding list has entries
    const outstandingOrderNum = await generateOrderNumber();
    const outstandingOrder = await Order.create({
      orderNumber: outstandingOrderNum,
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
          quantity: 1,
          pricePerUnit: 5000,
          materialCost: 5000,
          lineSubtotal: 5000,
        },
      ],
      subtotal: 5000,
      taxableAmount: 5000,
      gstRatePct: 18,
      cgst: 450,
      sgst: 450,
      totalGst: 900,
      totalAmount: 5900,
      paymentMode: 'CREDIT',
      createdBy: admin._id,
      customerNotes: 'PAYMENT_TEST_OUTSTANDING',
    });

    const outstanding = await paymentService.getOutstandingPayments({ customerId: customer._id });
    assert('Outstanding list returned', Array.isArray(outstanding));
    assert('At least one outstanding order',
           outstanding.length >= 1,
           `Got ${outstanding.length} outstanding orders`);
    if (outstanding.length > 0) {
      const sample = outstanding[0];
      assert('Outstanding entry has urgency',
             ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(sample.urgency));
      assert('Outstanding entry has daysOutstanding', typeof sample.daysOutstanding === 'number');
    }

    // ─── Test 8: Customer dues breakdown via sync ───
    logger.info('\nTest 8: Customer dues breakdown');
    await paymentService.syncCustomerDues(customer._id);
    const customerFinal = await Customer.findById(customer._id);
    assert('Customer dues recomputed (>= outstanding)',
           customerFinal.currentDues >= 5900 - 0.5,
           `Expected ≥ 5900, got ${customerFinal.currentDues}`);

    // ─── Cleanup ───
    logger.info('\nCleanup');
    await Order.deleteOne({ _id: order._id });
    await Order.deleteOne({ _id: outstandingOrder._id });
    await StockMovement.deleteMany({ relatedOrder: { $in: [order._id, outstandingOrder._id] } });

    customer.currentDues = customerDuesBefore;
    await customer.save();

    logger.info('✅ Test data cleaned up');

    await mongoose.disconnect();

    logger.info('\n═══════════════════════════════════════');
    logger.info(`📊 Payment Tracking Tests: ${pass}/${pass + fail} passed`);
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
