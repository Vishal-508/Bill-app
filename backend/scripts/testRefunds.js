require('dotenv').config();
if (process.env.NODE_ENV !== 'production') {
  const dns = require('dns');
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
}

const axios = require('axios');
const mongoose = require('mongoose');
const logger = require('../src/config/logger');

const BASE_URL = process.env.API_URL || 'http://localhost:5000';
const BYPASS = process.env.TEST_BYPASS_SECRET;

const api = axios.create({
  baseURL: BASE_URL,
  headers: { 'x-test-bypass-ratelimit': BYPASS },
  validateStatus: () => true,
});

const test = async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  let pass = 0, fail = 0;
  const failures = [];

  const assert = (name, condition, detail = '') => {
    if (condition) { pass++; logger.info(`  ✅ ${name}`); }
    else {
      fail++;
      logger.error(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
      failures.push(name);
    }
  };

  try {
    logger.info('\nSetup');
    const loginRes = await api.post('/api/auth/login', {
      email: 'testadmin@shreegopal.com',
      password: 'TestAdmin@123',
    });
    const h = { Authorization: `Bearer ${loginRes.data.accessToken}` };

    let orderRes = await api.get('/api/orders?limit=1', { headers: h });
    let testOrder = orderRes.data.data?.[0];
    let createdOwnOrder = false;

    if (!testOrder) {
      const custRes = await api.get('/api/customers?limit=1', { headers: h });
      const customer = custRes.data.data[0];
      const prodRes = await api.get('/api/products?productType=RAW_SHEET&limit=1', { headers: h });
      const product = prodRes.data.data[0];
      const ppu = product.basePrice * product.areaSqFt;
      const sub = ppu * 2;
      const orderBody = {
        customer: customer._id,
        items: [{
          itemType: 'FULL_SHEET',
          product: product._id,
          quantity: 2,
          pricePerUnit: ppu,
          materialCost: sub,
          lineSubtotal: sub,
        }],
        subtotal: sub,
        taxableAmount: sub,
        gstRatePct: 18,
        cgst: sub * 0.09,
        sgst: sub * 0.09,
        totalGst: sub * 0.18,
        totalAmount: sub * 1.18,
        paymentMode: 'PARTIAL',
        customerNotes: 'REFUND_TEST',
      };
      const createOrderRes = await api.post('/api/orders', orderBody, { headers: h });
      testOrder = createOrderRes.data.data;
      createdOwnOrder = true;
    }

    logger.info('\nSetup: Create + capture test payment');
    const initRes = await api.post('/api/payments/initiate', {
      order: testOrder._id,
      amount: 1000,
      notes: 'REFUND_TEST',
    }, { headers: h });

    const paymentId = initRes.data.data.paymentId;
    const paymentRef = initRes.data.data.paymentReference;
    const rzpOrderId = initRes.data.data.razorpayOrderId;

    await api.post('/api/payments/verify', {
      paymentReference: paymentRef,
      razorpayOrderId: rzpOrderId,
      razorpayPaymentId: 'pay_mock_refund_test',
      razorpaySignature: 'mock_signature',
    }, { headers: h });

    assert('Setup payment captured', true);

    // ─── Test 1: Partial refund ───
    logger.info('\nTest 1: Partial refund');
    let res = await api.post(`/api/payments/${paymentId}/refund`, {
      amount: 300,
      reason: 'Customer requested partial refund',
    }, { headers: h });

    assert('Partial refund initiated (201)', res.status === 201, `Got ${res.status}: ${JSON.stringify(res.data).substring(0, 200)}`);
    assert('Refund type = partial', res.data.data?.refundType === 'partial');
    assert('Refund amount = 300', res.data.data?.refundAmount === 300);
    assert('Total refunded = 300', res.data.data?.totalRefunded === 300);
    assert('Remaining refundable = 700', res.data.data?.remainingRefundable === 700);
    assert('Status still CAPTURED', res.data.data?.paymentStatus === 'CAPTURED');

    // ─── Test 2: Second partial refund ───
    logger.info('\nTest 2: Second partial refund');
    res = await api.post(`/api/payments/${paymentId}/refund`, {
      amount: 200,
      reason: 'Additional partial refund',
    }, { headers: h });

    assert('Second partial refund (201)', res.status === 201);
    assert('Total refunded = 500', res.data.data?.totalRefunded === 500);
    assert('Remaining refundable = 500', res.data.data?.remainingRefundable === 500);

    // ─── Test 3: Refund exceeding remaining balance ───
    logger.info('\nTest 3: Refund exceeding balance');
    res = await api.post(`/api/payments/${paymentId}/refund`, {
      amount: 600,
      reason: 'Should fail - exceeds remaining',
    }, { headers: h });
    assert('Excessive refund rejected (400)', res.status === 400);

    // ─── Test 4: Complete remaining refund ───
    logger.info('\nTest 4: Refund remaining balance');
    res = await api.post(`/api/payments/${paymentId}/refund`, {
      amount: 500,
      reason: 'Final partial refund',
    }, { headers: h });

    assert('Final refund (201)', res.status === 201);
    assert('Total refunded = 1000', res.data.data?.totalRefunded === 1000);
    assert('Status now REFUNDED', res.data.data?.paymentStatus === 'REFUNDED');

    // ─── Test 5: Cannot refund already-refunded payment ───
    logger.info('\nTest 5: Cannot refund REFUNDED payment');
    res = await api.post(`/api/payments/${paymentId}/refund`, {
      amount: 100,
      reason: 'Should fail',
    }, { headers: h });
    assert('Refund on REFUNDED rejected (400)', res.status === 400);

    // ─── Test 6: Full refund on different payment ───
    logger.info('\nTest 6: Full refund (no amount specified)');
    const init2 = await api.post('/api/payments/initiate', {
      order: testOrder._id,
      amount: 500,
      notes: 'REFUND_TEST',
    }, { headers: h });

    await api.post('/api/payments/verify', {
      paymentReference: init2.data.data.paymentReference,
      razorpayOrderId: init2.data.data.razorpayOrderId,
      razorpayPaymentId: 'pay_mock_full_refund',
      razorpaySignature: 'mock_signature',
    }, { headers: h });

    res = await api.post(`/api/payments/${init2.data.data.paymentId}/refund`, {
      reason: 'Full refund test',
    }, { headers: h });

    assert('Full refund initiated', res.status === 201);
    assert('Refund type = full', res.data.data?.refundType === 'full');
    assert('Status = REFUNDED', res.data.data?.paymentStatus === 'REFUNDED');

    // ─── Test 7: List refunds ───
    logger.info('\nTest 7: List refunds');
    res = await api.get('/api/payments/refunds?limit=10', { headers: h });
    assert('List refunds (200)', res.status === 200, `Got ${res.status}`);
    assert('Has refunds', res.data.count >= 2, `Got count=${res.data.count}`);

    // ─── Test 8: Refund detail ───
    logger.info('\nTest 8: Refund detail');
    res = await api.get(`/api/payments/refunds/${paymentId}`, { headers: h });
    assert('Refund detail (200)', res.status === 200, `Got ${res.status}`);
    assert('Has refund events', res.data.data?.refundEvents?.length > 0);
    assert('Has refund amount', res.data.data?.refundedAmount === 1000);

    // ─── Test 9: Cannot refund CREATED payment ───
    logger.info('\nTest 9: Cannot refund CREATED payment');
    const init3 = await api.post('/api/payments/initiate', {
      order: testOrder._id,
      amount: 200,
      notes: 'REFUND_TEST',
    }, { headers: h });

    res = await api.post(`/api/payments/${init3.data.data.paymentId}/refund`, {
      reason: 'Should fail - not captured',
    }, { headers: h });
    assert('CREATED refund rejected (400)', res.status === 400);

    // ─── Test 10: Refund with no reason rejected ───
    logger.info('\nTest 10: Refund requires reason');
    res = await api.post(`/api/payments/${paymentId}/refund`, {
      amount: 100,
    }, { headers: h });
    assert('Missing reason rejected (400)', res.status === 400);

    // Cleanup
    logger.info('\nCleanup');
    const { Payment, Order } = require('../src/models');
    await Payment.deleteMany({ notes: 'REFUND_TEST' });
    if (createdOwnOrder) {
      await Order.deleteOne({ _id: testOrder._id });
    }

    await mongoose.disconnect();

    logger.info('\n═══════════════════════════════════════');
    logger.info(`📊 Refund Tests: ${pass}/${pass + fail} passed`);
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
