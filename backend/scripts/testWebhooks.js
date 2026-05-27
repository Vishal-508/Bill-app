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

function mockWebhookPayload(eventType, razorpayOrderId, options = {}) {
  const eventId = `evt_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now = Math.floor(Date.now() / 1000);

  const base = {
    entity: 'event',
    account_id: 'acc_test',
    event: eventType,
    contains: ['payment'],
    created_at: now,
    id: eventId,
  };

  if (eventType.startsWith('payment.')) {
    base.payload = {
      payment: {
        entity: {
          id: options.paymentId || `pay_test_${Date.now()}`,
          order_id: razorpayOrderId,
          amount: options.amount || 10000,
          currency: 'INR',
          status: eventType === 'payment.captured' ? 'captured' :
                  eventType === 'payment.failed' ? 'failed' : 'authorized',
          method: options.method || 'upi',
          vpa: options.vpa || 'test@upi',
          error_code: options.errorCode,
          error_description: options.errorDescription,
          ...options.paymentExtras,
        },
      },
    };
  } else if (eventType.startsWith('refund.')) {
    base.contains = ['refund'];
    base.payload = {
      refund: {
        entity: {
          id: options.refundId || `rfnd_test_${Date.now()}`,
          payment_id: options.paymentId,
          amount: options.amount || 5000,
          currency: 'INR',
          status: eventType === 'refund.processed' ? 'processed' : 'created',
        },
      },
    };
  }

  return base;
}

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
        customerNotes: 'WEBHOOK_TEST',
      };
      const createOrderRes = await api.post('/api/orders', orderBody, { headers: h });
      testOrder = createOrderRes.data.data;
      createdOwnOrder = true;
    }

    const payRes = await api.post('/api/payments/initiate', {
      order: testOrder._id,
      amount: 100,
      notes: 'WEBHOOK_TEST',
    }, { headers: h });

    assert('Test payment created', payRes.status === 201);
    const paymentRef = payRes.data.data.paymentReference;
    const rzpOrderId = payRes.data.data.razorpayOrderId;
    const paymentId = payRes.data.data.paymentId;

    // ─── Test 1: Webhook without signature ───
    // Use a non-matching rzpOrderId so this test only exercises mock-mode signature
    // acceptance — doesn't pollute our test Payment's razorpayPaymentId before Test 2.
    logger.info('\nTest 1: Missing signature (mock-mode bypass)');
    let res = await api.post('/api/webhooks/razorpay',
      mockWebhookPayload('payment.captured', 'order_test_unrelated'));
    assert('Webhook accepted in mock mode', res.status === 200, `Got ${res.status}`);

    // ─── Test 2: payment.captured event ───
    logger.info('\nTest 2: payment.captured handling');
    const capturePayload = mockWebhookPayload('payment.captured', rzpOrderId, {
      paymentId: 'pay_webhook_test_123',
      amount: 10000,
      method: 'upi',
      vpa: 'customer@paytm',
    });

    res = await api.post('/api/webhooks/razorpay', capturePayload, {
      headers: { 'x-razorpay-signature': 'mock_webhook_signature' },
    });
    assert('Captured webhook 200', res.status === 200);

    res = await api.get(`/api/payments/${paymentId}`, { headers: h });
    assert('Payment status = CAPTURED', res.data.data?.status === 'CAPTURED');
    assert('Method = upi', res.data.data?.method === 'upi');

    // ─── Test 3: Idempotent processing (same event ID) ───
    logger.info('\nTest 3: Idempotent processing');
    const duplicatePayload = { ...capturePayload };
    res = await api.post('/api/webhooks/razorpay', duplicatePayload, {
      headers: { 'x-razorpay-signature': 'mock_webhook_signature' },
    });
    assert('Duplicate webhook 200', res.status === 200);

    // ─── Test 4: payment.failed event ───
    logger.info('\nTest 4: payment.failed handling');
    const payRes2 = await api.post('/api/payments/initiate', {
      order: testOrder._id,
      amount: 50,
      notes: 'WEBHOOK_TEST',
    }, { headers: h });

    const failPayload = mockWebhookPayload('payment.failed', payRes2.data.data.razorpayOrderId, {
      errorCode: 'BAD_REQUEST_ERROR',
      errorDescription: 'Insufficient funds',
    });

    res = await api.post('/api/webhooks/razorpay', failPayload, {
      headers: { 'x-razorpay-signature': 'mock_webhook_signature' },
    });
    assert('Failed webhook 200', res.status === 200);

    res = await api.get(`/api/payments/${payRes2.data.data.paymentId}`, { headers: h });
    assert('Payment status = FAILED', res.data.data?.status === 'FAILED');
    assert('Failure code captured', res.data.data?.failureCode === 'BAD_REQUEST_ERROR');

    // ─── Test 5: List webhook events ───
    logger.info('\nTest 5: Audit trail');
    res = await api.get('/api/webhooks/events?limit=10', { headers: h });
    assert('Events list 200', res.status === 200);
    assert('Has events', res.data.count >= 2);

    // ─── Test 6: Filter by status ───
    logger.info('\nTest 6: Filter events');
    res = await api.get('/api/webhooks/events?status=PROCESSED&limit=5', { headers: h });
    assert('Filter by status 200', res.status === 200);

    // ─── Test 7: Unknown event type ───
    logger.info('\nTest 7: Unknown event type');
    const unknownPayload = mockWebhookPayload('subscription.activated', rzpOrderId);
    res = await api.post('/api/webhooks/razorpay', unknownPayload, {
      headers: { 'x-razorpay-signature': 'mock_webhook_signature' },
    });
    assert('Unknown event still 200', res.status === 200);

    // ─── Test 8: payment.authorized ───
    logger.info('\nTest 8: payment.authorized');
    const payRes3 = await api.post('/api/payments/initiate', {
      order: testOrder._id,
      amount: 25,
      notes: 'WEBHOOK_TEST',
    }, { headers: h });

    const authPayload = mockWebhookPayload('payment.authorized', payRes3.data.data.razorpayOrderId);
    res = await api.post('/api/webhooks/razorpay', authPayload, {
      headers: { 'x-razorpay-signature': 'mock_webhook_signature' },
    });
    assert('Authorized webhook 200', res.status === 200);

    res = await api.get(`/api/payments/${payRes3.data.data.paymentId}`, { headers: h });
    assert('Payment status = AUTHORIZED', res.data.data?.status === 'AUTHORIZED');

    // ─── Test 9: refund.created ───
    logger.info('\nTest 9: refund.created');
    const refundCreatedPayload = mockWebhookPayload('refund.created', rzpOrderId, {
      paymentId: 'pay_webhook_test_123',
      refundId: 'rfnd_test_001',
      amount: 5000,
    });

    res = await api.post('/api/webhooks/razorpay', refundCreatedPayload, {
      headers: { 'x-razorpay-signature': 'mock_webhook_signature' },
    });
    assert('Refund created webhook 200', res.status === 200);

    res = await api.get(`/api/payments/${paymentId}`, { headers: h });
    assert('Refund ID captured', res.data.data?.razorpayRefundId === 'rfnd_test_001');
    assert('Refund amount tracked', res.data.data?.amountRefunded === 5000);

    // ─── Test 10: Webhook event details ───
    logger.info('\nTest 10: Event detail endpoint');
    res = await api.get('/api/webhooks/events?limit=1', { headers: h });
    const eventDocId = res.data.data?.[0]?._id;

    if (eventDocId) {
      res = await api.get(`/api/webhooks/events/${eventDocId}`, { headers: h });
      assert('Event detail 200', res.status === 200);
      assert('Has payload', res.data.data?.payload != null);
      assert('Has actions taken', Array.isArray(res.data.data?.actionsTaken));
    }

    // Cleanup
    logger.info('\nCleanup');
    const { Payment, WebhookEvent, Order } = require('../src/models');
    await Payment.deleteMany({ notes: 'WEBHOOK_TEST' });
    // Webhook events created during this run reference our test order's razorpay order ids;
    // best to wipe events generated in the last 5 minutes that match test event id prefix.
    await WebhookEvent.deleteMany({ razorpayEventId: { $regex: '^evt_test_' } });
    await WebhookEvent.deleteMany({ razorpayEventId: { $regex: '^invalid_' } });
    if (createdOwnOrder) {
      await Order.deleteOne({ _id: testOrder._id });
    }

    await mongoose.disconnect();

    logger.info('\n═══════════════════════════════════════');
    logger.info(`📊 Webhook Tests: ${pass}/${pass + fail} passed`);
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
