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
    assert('Admin login', loginRes.status === 200);
    const h = { Authorization: `Bearer ${loginRes.data.accessToken}` };

    let orderRes = await api.get('/api/orders?limit=1', { headers: h });
    let testOrder = orderRes.data.data?.[0];
    let createdOwnOrder = false;

    if (!testOrder) {
      // Create one for the test
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
        customerNotes: 'PAYMENT_E2E_TEST',
      };
      const createOrderRes = await api.post('/api/orders', orderBody, { headers: h });
      testOrder = createOrderRes.data.data;
      createdOwnOrder = true;
    }
    assert('Test order available', testOrder?._id != null);

    // Test 1: Get config
    logger.info('\nTest 1: Payment config');
    let res = await api.get('/api/payments/config', { headers: h });
    assert('Config endpoint (200)', res.status === 200);
    assert('Provider = razorpay', res.data.data?.provider === 'razorpay');
    assert('keyId returned', res.data.data?.keyId?.length > 0);
    assert('isMockMode true', res.data.data?.isMockMode === true);

    // Test 2: Initiate payment
    logger.info('\nTest 2: Initiate payment');
    const remainingDue = testOrder.totalAmount - (testOrder.amountPaid || 0);
    const payAmount = Math.min(100, remainingDue);

    res = await api.post('/api/payments/initiate', {
      order: testOrder._id,
      amount: payAmount,
      notes: 'PAYMENT_E2E_TEST',
    }, { headers: h });
    assert('Initiate returns 201', res.status === 201, `Got ${res.status}: ${JSON.stringify(res.data).substring(0, 200)}`);
    assert('paymentReference returned', res.data.data?.paymentReference?.startsWith('PAY-'));
    assert('razorpayOrderId returned', res.data.data?.razorpayOrderId?.length > 0);
    assert('Amount in paise', res.data.data?.amount === payAmount * 100);
    assert('isMock flag set', res.data.data?.isMock === true);

    const paymentRef = res.data.data.paymentReference;
    const rzpOrderId = res.data.data.razorpayOrderId;
    const paymentId = res.data.data.paymentId;

    // Test 3: Cannot initiate amount exceeding due
    logger.info('\nTest 3: Excessive amount rejected');
    res = await api.post('/api/payments/initiate', {
      order: testOrder._id,
      amount: 9999999,
    }, { headers: h });
    assert('Excessive amount rejected (400)', res.status === 400, `Got ${res.status}`);

    // Test 4: Verify payment (mock signature)
    logger.info('\nTest 4: Verify payment');
    res = await api.post('/api/payments/verify', {
      paymentReference: paymentRef,
      razorpayOrderId: rzpOrderId,
      razorpayPaymentId: 'pay_mock_test123',
      razorpaySignature: 'mock_signature',
    }, { headers: h });
    assert('Verify returns 200', res.status === 200, `Got ${res.status}: ${JSON.stringify(res.data).substring(0, 200)}`);
    assert('Status = CAPTURED', res.data.data?.status === 'CAPTURED');

    // Test 5: Invalid signature rejected
    logger.info('\nTest 5: Invalid signature');
    const payRes2 = await api.post('/api/payments/initiate', {
      order: testOrder._id,
      amount: 50,
    }, { headers: h });
    assert('Second initiate succeeds', payRes2.status === 201, `Got ${payRes2.status}`);

    res = await api.post('/api/payments/verify', {
      paymentReference: payRes2.data.data.paymentReference,
      razorpayOrderId: payRes2.data.data.razorpayOrderId,
      razorpayPaymentId: 'pay_real_test',
      razorpaySignature: 'real_signature_not_mock',
    }, { headers: h });
    assert('Invalid signature rejected (403)', res.status === 403, `Got ${res.status}`);

    // Test 6: List payments
    logger.info('\nTest 6: List payments');
    res = await api.get('/api/payments?limit=10', { headers: h });
    assert('List returns 200', res.status === 200);
    assert('Includes our payment',
      res.data.data?.some(p => p.paymentReference === paymentRef));

    // Test 7: Get single payment
    logger.info('\nTest 7: Get single payment');
    res = await api.get(`/api/payments/${paymentId}`, { headers: h });
    assert('Get single (200)', res.status === 200);
    assert('Correct reference', res.data.data?.paymentReference === paymentRef);

    // Test 8: By-order endpoint
    logger.info('\nTest 8: By-order');
    res = await api.get(`/api/payments/by-order/${testOrder._id}`, { headers: h });
    assert('By-order returns 200', res.status === 200);
    assert('Count >= 1', res.data.count >= 1);

    // Test 9: By-customer endpoint
    logger.info('\nTest 9: By-customer');
    const customerId = testOrder.customer?._id || testOrder.customer;
    res = await api.get(`/api/payments/by-customer/${customerId}`, { headers: h });
    assert('By-customer returns 200', res.status === 200);

    // Test 10: Cancel pending payment
    logger.info('\nTest 10: Cancel payment');
    res = await api.get(`/api/payments/${payRes2.data.data.paymentId}`, { headers: h });
    const secondPaymentStatus = res.data.data?.status;

    if (['CREATED', 'ATTEMPTED'].includes(secondPaymentStatus)) {
      res = await api.post(`/api/payments/${payRes2.data.data.paymentId}/cancel`, {
        reason: 'E2E test cancellation',
      }, { headers: h });
      assert('Cancel successful (200)', res.status === 200);
      assert('Status = CANCELLED', res.data.data?.status === 'CANCELLED');
    } else {
      assert('Second payment in FAILED state (cannot cancel)', secondPaymentStatus === 'FAILED', `Got: ${secondPaymentStatus}`);
    }

    // Test 11: Idempotent verify
    logger.info('\nTest 11: Idempotent verify');
    res = await api.post('/api/payments/verify', {
      paymentReference: paymentRef,
      razorpayOrderId: rzpOrderId,
      razorpayPaymentId: 'pay_mock_test123',
      razorpaySignature: 'mock_signature',
    }, { headers: h });
    assert('Re-verify returns 200 (idempotent)', res.status === 200);

    // Test 12: Filter by status
    logger.info('\nTest 12: Filter by status');
    res = await api.get('/api/payments?status=CAPTURED&limit=5', { headers: h });
    assert('Filter by CAPTURED works', res.status === 200);

    // Test 13: Order.amountPaid synced after verify
    logger.info('\nTest 13: Order amountPaid sync');
    res = await api.get(`/api/orders/${testOrder._id}`, { headers: h });
    assert('Order amountPaid increased',
      (res.data.data?.amountPaid || 0) >= payAmount,
      `Expected ≥${payAmount}, got ${res.data.data?.amountPaid}`);

    // Cleanup
    logger.info('\nCleanup');
    const { Payment, Order } = require('../src/models');
    await Payment.deleteMany({ notes: 'PAYMENT_E2E_TEST' });
    if (createdOwnOrder) {
      await Order.deleteOne({ _id: testOrder._id });
    }

    await mongoose.disconnect();

    logger.info('\n═══════════════════════════════════════');
    logger.info(`📊 Payment Endpoints Tests: ${pass}/${pass + fail} passed`);
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
