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
    // ─── Setup: Login + get test order ───
    logger.info('\nSetup: Authentication');

    const loginRes = await api.post('/api/auth/login', {
      email: 'testadmin@shreegopal.com',
      password: 'TestAdmin@123',
    });
    assert('Admin login', loginRes.status === 200 && loginRes.data.accessToken);
    const adminToken = loginRes.data.accessToken;
    const h = { Authorization: `Bearer ${adminToken}` };

    logger.info('\nSetup: Get test order');
    let orderRes = await api.get('/api/orders?limit=1&status=COMPLETED', { headers: h });

    if (!orderRes.data.data || orderRes.data.data.length === 0) {
      orderRes = await api.get('/api/orders?limit=1', { headers: h });
    }

    let testOrder = orderRes.data.data?.[0];
    let createdOwnOrder = false;

    if (!testOrder) {
      logger.info('  Creating test order...');
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
        paymentMode: 'FULL_UPFRONT',
        customerNotes: 'BILL_TEST',
      };

      const createOrderRes = await api.post('/api/orders', orderBody, { headers: h });
      testOrder = createOrderRes.data.data;
      createdOwnOrder = true;
    }

    assert('Test order available', testOrder?._id != null);
    logger.info(`  Using order: ${testOrder.orderNumber}`);

    // ─── Test 1: Create bill from order ───
    logger.info('\nTest 1: Create bill from order');
    let res = await api.post(`/api/bills/from-order/${testOrder._id}`, {
      format: 'detailed',
      language: 'en',
      hasGst: true,
      notesToCustomer: 'E2E test bill',
    }, { headers: h });

    assert('Bill created (201)', res.status === 201, `Got ${res.status}: ${JSON.stringify(res.data).substring(0, 300)}`);
    assert('Bill number assigned', res.data.data?.billNumber?.startsWith('INV-'));
    assert('Status = DRAFT', res.data.data?.status === 'DRAFT');
    assert('Has customer snapshot', res.data.data?.customerInfo?.customerName);
    assert('Has business snapshot', res.data.data?.businessInfo?.name);

    const billId = res.data.data._id;

    // ─── Test 2: Cannot create duplicate ───
    logger.info('\nTest 2: Duplicate bill prevention');
    res = await api.post(`/api/bills/from-order/${testOrder._id}`, {
      format: 'simple',
    }, { headers: h });
    assert('Duplicate rejected (409)', res.status === 409, `Got ${res.status}`);

    // ─── Test 3: List bills ───
    logger.info('\nTest 3: List bills');
    res = await api.get('/api/bills?limit=5', { headers: h });
    assert('List returns bills', res.status === 200 && res.data.data?.length >= 1);

    // ─── Test 4: Get single bill ───
    logger.info('\nTest 4: Get single bill');
    res = await api.get(`/api/bills/${billId}`, { headers: h });
    assert('Single bill retrieved', res.status === 200);
    assert('Has items', res.data.data?.items?.length > 0);
    assert('Has amount in words', res.data.data?.amountInWords?.includes('Rupees'));

    // ─── Test 5: Update DRAFT bill ───
    logger.info('\nTest 5: Update DRAFT bill');
    res = await api.put(`/api/bills/${billId}`, {
      notesToCustomer: 'Updated notes',
      format: 'simple',
    }, { headers: h });
    assert('Update successful', res.status === 200, `Got ${res.status}`);
    assert('Format changed to simple', res.data.data?.format === 'simple');

    // ─── Test 6: Finalize bill ───
    logger.info('\nTest 6: Finalize bill');
    res = await api.post(`/api/bills/${billId}/finalize`, {
      notes: 'Finalized via E2E test',
    }, { headers: h });
    assert('Finalize successful', res.status === 200);
    assert('Status = FINALIZED', res.data.data?.status === 'FINALIZED');

    // ─── Test 7: Cannot edit FINALIZED bill ───
    logger.info('\nTest 7: FINALIZED bill is locked');
    res = await api.put(`/api/bills/${billId}`, {
      notesToCustomer: 'Should fail',
    }, { headers: h });
    assert('Update rejected (403)', res.status === 403, `Got ${res.status}`);

    // ─── Test 8: Generate PDF ───
    logger.info('\nTest 8: Generate PDF');
    const pdfRes = await api.get(`/api/bills/${billId}/pdf`, {
      headers: h,
      responseType: 'arraybuffer',
    });
    assert('PDF endpoint returns 200', pdfRes.status === 200);
    assert('Content-Type is PDF', pdfRes.headers['content-type']?.includes('pdf'));
    assert('Response is binary PDF',
      Buffer.from(pdfRes.data).subarray(0, 4).toString() === '%PDF');
    assert('Reasonable size', pdfRes.data.byteLength > 30000);

    // ─── Test 9: Mark as sent ───
    logger.info('\nTest 9: Mark as sent');
    res = await api.post(`/api/bills/${billId}/mark-sent`, {
      channel: 'whatsapp',
      notes: 'Sent via WhatsApp test',
      recipientInfo: '+91-9000000001',
    }, { headers: h });
    assert('Mark sent successful', res.status === 200);
    assert('Status = SENT', res.data.data?.status === 'SENT');

    // ─── Test 10: By-order endpoint ───
    logger.info('\nTest 10: Bills by order');
    res = await api.get(`/api/bills/by-order/${testOrder._id}`, { headers: h });
    assert('By-order returns bill', res.status === 200 && res.data.count >= 1);

    // ─── Test 11: By-customer endpoint ───
    logger.info('\nTest 11: Bills by customer');
    const customerId = testOrder.customer?._id || testOrder.customer;
    res = await api.get(`/api/bills/by-customer/${customerId}`, { headers: h });
    assert('By-customer returns bills', res.status === 200, `Got ${res.status}`);

    // ─── Test 12: Filter by status ───
    logger.info('\nTest 12: Filter by status');
    res = await api.get('/api/bills?status=SENT', { headers: h });
    assert('Status filter works', res.status === 200);

    // ─── Cleanup ───
    logger.info('\nCleanup');

    const superRes = await api.post('/api/auth/login', {
      email: process.env.SEED_ADMIN_EMAIL,
      password: process.env.SEED_ADMIN_PASSWORD,
    });
    const superH = { Authorization: `Bearer ${superRes.data.accessToken}` };

    await api.delete(`/api/bills/${billId}`, {
      headers: superH,
      data: { reason: 'E2E cleanup' },
    });

    if (createdOwnOrder) {
      await api.delete(`/api/orders/${testOrder._id}`, {
        headers: superH,
        data: { reason: 'E2E cleanup' },
      });
    }

    logger.info('  ✅ Test data cleaned up');

    await mongoose.disconnect();

    logger.info('\n═══════════════════════════════════════');
    logger.info(`📊 Bill Endpoints Tests: ${pass}/${pass + fail} passed`);
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
