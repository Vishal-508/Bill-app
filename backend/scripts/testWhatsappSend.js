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

const TAG = 'WA_SEND_TEST'; // for cleanup

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
    // ─── Setup: Auth ───
    logger.info('\nSetup: Auth');
    const loginRes = await api.post('/api/auth/login', {
      email: 'testadmin@shreegopal.com',
      password: 'TestAdmin@123',
    });
    assert('Admin login (200)', loginRes.status === 200);
    const h = { Authorization: `Bearer ${loginRes.data.accessToken}` };

    // ─── Setup: Find a customer with a phone ───
    logger.info('\nSetup: Customer with phone');
    const custRes = await api.get('/api/customers?limit=20', { headers: h });
    const customer = custRes.data.data?.find(c => c.phone);
    assert('Customer with phone available', customer != null, 'No customer with phone found in DB');
    const customerId = customer._id;

    // ─── Setup: Find or create a bill for this customer ───
    logger.info('\nSetup: Bill for the customer');
    let billRes = await api.get(`/api/bills/by-customer/${customerId}`, { headers: h });
    let testBill = billRes.data.data?.[0];

    if (!testBill) {
      // Need to find an order for this customer first
      const orderRes = await api.get(`/api/orders/by-customer/${customerId}`, { headers: h });
      let testOrder = orderRes.data.data?.[0];

      if (!testOrder) {
        // Create an order
        const prodRes = await api.get('/api/products?productType=RAW_SHEET&limit=1', { headers: h });
        const product = prodRes.data.data[0];
        const ppu = product.basePrice * product.areaSqFt;
        const sub = ppu * 2;
        const createOrderRes = await api.post('/api/orders', {
          customer: customerId,
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
          customerNotes: TAG,
        }, { headers: h });
        testOrder = createOrderRes.data.data;
      }

      const createBillRes = await api.post(`/api/bills/from-order/${testOrder._id || testOrder.id}`, {
        format: 'detailed',
        notesToCustomer: TAG,
      }, { headers: h });
      testBill = createBillRes.data.data;
    }
    assert('Test bill available', testBill?._id != null);

    // ─── Setup: Find any order for this customer (different from bill source) ───
    logger.info('\nSetup: Order for the customer');
    const orderRes2 = await api.get(`/api/orders/by-customer/${customerId}`, { headers: h });
    const testOrder = orderRes2.data.data?.[0];
    assert('Test order available', testOrder?._id != null);

    // ─── Setup: Make sure WHATSAPP_ENABLED = true ───
    const { SystemSetting } = require('../src/models');
    let waSetting = await SystemSetting.findOne({ key: 'WHATSAPP_ENABLED' });
    if (waSetting && waSetting.value !== true) {
      waSetting.value = true;
      await waSetting.save();
    }

    // ─── Test 1: sendBill — happy path ───
    logger.info('\nTest 1: send-bill (happy path)');
    let res = await api.post(`/api/whatsapp/send-bill/${testBill._id}`, {}, { headers: h });
    assert('201 Created', res.status === 201, `Got ${res.status}: ${JSON.stringify(res.data).substring(0, 200)}`);
    assert('Has logId', res.data.data?.logId != null);
    assert('Has waMessageId (mock)', res.data.data?.waMessageId?.startsWith('wamid.mock_'));
    assert('isMock: true', res.data.data?.isMock === true);
    const billLogId = res.data.data?.logId;

    // ─── Test 2: sendBill — idempotency (60s window) ───
    logger.info('\nTest 2: send-bill (idempotency)');
    res = await api.post(`/api/whatsapp/send-bill/${testBill._id}`, {}, { headers: h });
    assert('Resend within 60s rejected (409)', res.status === 409, `Got ${res.status}`);

    // ─── Test 3: sendBill — invalid bill ID ───
    logger.info('\nTest 3: send-bill (invalid id)');
    res = await api.post('/api/whatsapp/send-bill/not-a-real-id', {}, { headers: h });
    assert('Invalid ID rejected (400)', res.status === 400);

    // ─── Test 4: sendBill — non-existent bill ───
    logger.info('\nTest 4: send-bill (non-existent)');
    res = await api.post('/api/whatsapp/send-bill/507f1f77bcf86cd799439011', {}, { headers: h });
    assert('Non-existent rejected (404)', res.status === 404);

    // ─── Test 5: sendPaymentLink — happy path ───
    logger.info('\nTest 5: send-payment-link (happy path)');
    res = await api.post('/api/whatsapp/send-payment-link', {
      billId: testBill._id,
      paymentLinkUrl: 'https://rzp.io/i/test_pay_link_abc',
    }, { headers: h });
    assert('201 Created', res.status === 201, `Got ${res.status}: ${JSON.stringify(res.data).substring(0, 200)}`);
    assert('Has waMessageId', res.data.data?.waMessageId?.startsWith('wamid.mock_'));
    assert('Echoes paymentLinkUrl', res.data.data?.paymentLinkUrl === 'https://rzp.io/i/test_pay_link_abc');

    // ─── Test 6: sendPaymentLink — invalid URL ───
    logger.info('\nTest 6: send-payment-link (invalid URL)');
    res = await api.post('/api/whatsapp/send-payment-link', {
      billId: testBill._id,
      paymentLinkUrl: 'not-a-url',
    }, { headers: h });
    assert('Invalid URL rejected (400)', res.status === 400);

    // ─── Test 7: sendPaymentLink — missing billId ───
    logger.info('\nTest 7: send-payment-link (missing billId)');
    res = await api.post('/api/whatsapp/send-payment-link', {
      paymentLinkUrl: 'https://rzp.io/i/abc',
    }, { headers: h });
    assert('Missing billId rejected (400)', res.status === 400);

    // ─── Test 8: sendOrderConfirmation — happy path ───
    logger.info('\nTest 8: send-order-confirmation (happy path)');
    res = await api.post(`/api/whatsapp/send-order-confirmation/${testOrder._id}`, {}, { headers: h });
    assert('201 Created', res.status === 201, `Got ${res.status}: ${JSON.stringify(res.data).substring(0, 200)}`);
    assert('Has waMessageId', res.data.data?.waMessageId?.startsWith('wamid.mock_'));
    assert('Echoes orderNumber', res.data.data?.orderNumber === testOrder.orderNumber);

    // ─── Test 9: sendOrderConfirmation — idempotency ───
    logger.info('\nTest 9: send-order-confirmation (idempotency)');
    res = await api.post(`/api/whatsapp/send-order-confirmation/${testOrder._id}`, {}, { headers: h });
    assert('Resend within 60s rejected (409)', res.status === 409);

    // ─── Test 10: sendOrderReady — happy path ───
    logger.info('\nTest 10: send-order-ready (happy path)');
    res = await api.post(`/api/whatsapp/send-order-ready/${testOrder._id}`, {}, { headers: h });
    assert('201 Created', res.status === 201, `Got ${res.status}: ${JSON.stringify(res.data).substring(0, 200)}`);
    assert('Has waMessageId', res.data.data?.waMessageId?.startsWith('wamid.mock_'));

    // ─── Test 11: sendOrderReady — invalid orderId ───
    logger.info('\nTest 11: send-order-ready (invalid id)');
    res = await api.post('/api/whatsapp/send-order-ready/not-a-real-id', {}, { headers: h });
    assert('Invalid ID rejected (400)', res.status === 400);

    // ─── Test 12: send-text — no inbound history → rejected (24h window) ───
    logger.info('\nTest 12: send-text (no inbound history — 24h window violated)');
    res = await api.post('/api/whatsapp/send-text', {
      customerId: customerId,
      text: 'Hello from outside window',
    }, { headers: h });
    assert('Outside 24h window rejected (403)', res.status === 403, `Got ${res.status}`);

    // ─── Test 13: send-text — seed INBOUND then succeed ───
    logger.info('\nTest 13: send-text (with INBOUND in window)');
    const { WhatsAppLog } = require('../src/models');
    const inboundLog = await WhatsAppLog.create({
      to: '919999999999',
      customer: customerId,
      type: 'INBOUND',
      payload: { text: { body: 'Hi I need help' } },
      status: 'SENT',
      isMock: true,
    });
    res = await api.post('/api/whatsapp/send-text', {
      customerId: customerId,
      text: 'Thanks for reaching out!',
    }, { headers: h });
    assert('Inside 24h window succeeds (201)', res.status === 201, `Got ${res.status}: ${JSON.stringify(res.data).substring(0, 200)}`);
    assert('Has waMessageId', res.data.data?.waMessageId?.startsWith('wamid.mock_'));

    // ─── Test 14: send-text — old INBOUND > 24h rejected ───
    logger.info('\nTest 14: send-text (stale INBOUND > 24h)');
    // Backdate the inbound log by 25 hours via the raw MongoDB driver
    // (bypasses Mongoose timestamps middleware entirely).
    await WhatsAppLog.collection.updateOne(
      { _id: inboundLog._id },
      { $set: { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) } }
    );
    // Verify the backdate actually persisted (defensive — if Mongoose still
    // intervened we'd want to see the failure here, not at the assert).
    const refreshed = await WhatsAppLog.findById(inboundLog._id).select('createdAt').lean();
    const hoursAgo = (Date.now() - new Date(refreshed.createdAt).getTime()) / (1000 * 60 * 60);
    logger.info(`  [check] inbound createdAt is ${hoursAgo.toFixed(1)}h ago`);
    res = await api.post('/api/whatsapp/send-text', {
      customerId: customerId,
      text: 'After window',
    }, { headers: h });
    assert('Stale INBOUND rejected (403)', res.status === 403, `Got ${res.status}`);

    // ─── Test 15: send-text — text too long ───
    logger.info('\nTest 15: send-text (length validation)');
    res = await api.post('/api/whatsapp/send-text', {
      customerId: customerId,
      text: 'a'.repeat(5000),
    }, { headers: h });
    assert('Oversized text rejected (400)', res.status === 400);

    // ─── Test 16: send-text — missing both customerId and to ───
    logger.info('\nTest 16: send-text (no target)');
    res = await api.post('/api/whatsapp/send-text', {
      text: 'Where am I going?',
    }, { headers: h });
    assert('Missing target rejected (400)', res.status === 400);

    // ─── Test 17: RBAC — no auth ───
    logger.info('\nTest 17: RBAC (no auth)');
    res = await api.post(`/api/whatsapp/send-bill/${testBill._id}`, {});
    assert('No auth rejected (401)', res.status === 401);

    // ─── Test 18: WHATSAPP_ENABLED = false → reject ───
    logger.info('\nTest 18: WHATSAPP_ENABLED toggle');
    waSetting.value = false;
    await waSetting.save();

    res = await api.post('/api/whatsapp/send-payment-link', {
      billId: testBill._id,
      paymentLinkUrl: 'https://rzp.io/i/disabled_test',
    }, { headers: h });
    assert('Disabled → send rejected (403)', res.status === 403, `Got ${res.status}`);

    // Restore for cleanup safety
    waSetting.value = true;
    await waSetting.save();

    // ─── Cleanup ───
    logger.info('\nCleanup');
    await WhatsAppLog.deleteMany({
      $or: [
        { _id: billLogId },
        { customer: customerId, createdAt: { $gte: new Date(Date.now() - 5 * 60 * 1000) } },
      ],
    });
    // Also clean tagged orders / bills if we created them
    const { Order, Bill } = require('../src/models');
    await Bill.deleteMany({ notesToCustomer: TAG });
    await Order.deleteMany({ customerNotes: TAG });
    logger.info('  Test data cleaned');

    await mongoose.disconnect();

    logger.info('\n═══════════════════════════════════════');
    logger.info(`📊 WhatsApp Send Endpoints (Section B): ${pass}/${pass + fail} passed`);
    if (failures.length > 0) {
      logger.info('\nFailures:');
      failures.forEach((f, i) => logger.info(`  ${i + 1}. ${f}`));
    }

    process.exit(fail === 0 ? 0 : 1);
  } catch (error) {
    logger.error('Test crashed:', error);
    try { await mongoose.disconnect(); } catch {}
    process.exit(1);
  }
};

test();
