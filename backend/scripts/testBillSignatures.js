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

// 1×1 transparent PNG as base64
const SAMPLE_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const SAMPLE_SIGNATURE = `data:image/png;base64,${SAMPLE_PNG_BASE64}`;

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
    logger.info('\nSetup: Authentication + create test bill');

    const loginRes = await api.post('/api/auth/login', {
      email: 'testadmin@shreegopal.com',
      password: 'TestAdmin@123',
    });
    const adminToken = loginRes.data.accessToken;
    const h = { Authorization: `Bearer ${adminToken}` };

    let billRes = await api.get('/api/bills?limit=1', { headers: h });
    let testBill = billRes.data.data?.[0];
    let createdOwnBill = false;

    if (!testBill) {
      // Need to create from existing order
      const orderRes = await api.get('/api/orders?limit=1', { headers: h });
      let order = orderRes.data.data?.[0];

      if (!order) {
        // No orders either — create one
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
          customerNotes: 'SIGNATURE_TEST',
        };
        const createOrderRes = await api.post('/api/orders', orderBody, { headers: h });
        order = createOrderRes.data.data;
      }

      const createRes = await api.post(`/api/bills/from-order/${order._id}`, {
        format: 'detailed',
        notesToCustomer: 'SIGNATURE_TEST',
      }, { headers: h });
      testBill = createRes.data.data;
      createdOwnBill = true;
    }

    assert('Test bill available', testBill?._id != null);
    const billId = testBill._id;

    // ─── Test 1: Initial signature state ───
    logger.info('\nTest 1: Initial signature state');
    let res = await api.get(`/api/bills/${billId}/signatures`, { headers: h });
    assert('Signatures endpoint returns 200', res.status === 200);

    // ─── Test 2: Upload customer signature ───
    logger.info('\nTest 2: Upload customer signature');
    res = await api.post(`/api/bills/${billId}/customer-signature`, {
      signatureImage: SAMPLE_SIGNATURE,
      signedByName: 'Rajesh Kumar',
    }, { headers: h });
    assert('Customer signature uploaded (200)', res.status === 200, `Got ${res.status}: ${JSON.stringify(res.data).substring(0, 200)}`);
    assert('signedAt timestamp returned', res.data.data?.signedAt != null);
    assert('signedByName captured', res.data.data?.signedByName === 'Rajesh Kumar');

    // ─── Test 3: Verify customer signature stored ───
    logger.info('\nTest 3: Verify customer signature retrieval');
    res = await api.get(`/api/bills/${billId}/signatures?includeImages=true`, { headers: h });
    assert('hasCustomerSignature = true', res.data.data?.hasCustomerSignature === true);
    assert('Image data present',
      res.data.data?.customerSignature?.signatureImage?.startsWith('data:image/'));

    // ─── Test 4: Upload issuer signature ───
    logger.info('\nTest 4: Upload issuer signature');
    res = await api.post(`/api/bills/${billId}/issuer-signature`, {
      signatureImage: SAMPLE_SIGNATURE,
    }, { headers: h });
    assert('Issuer signature uploaded', res.status === 200, `Got ${res.status}`);

    // ─── Test 5: Both signatures present ───
    logger.info('\nTest 5: Both signatures verified');
    res = await api.get(`/api/bills/${billId}/signatures`, { headers: h });
    assert('hasCustomerSignature', res.data.data?.hasCustomerSignature === true);
    assert('hasIssuerSignature', res.data.data?.hasIssuerSignature === true);

    // ─── Test 6: Reject invalid signature ───
    logger.info('\nTest 6: Reject invalid signature');
    res = await api.post(`/api/bills/${billId}/customer-signature`, {
      signatureImage: 'not-a-valid-base64-image',
    }, { headers: h });
    assert('Invalid format rejected (400)', res.status === 400, `Got ${res.status}`);

    // ─── Test 7: Reject oversized signature ───
    logger.info('\nTest 7: Reject oversized signature');
    const huge = 'a'.repeat(3_000_000);
    res = await api.post(`/api/bills/${billId}/customer-signature`, {
      signatureImage: `data:image/png;base64,${huge}`,
    }, { headers: h });
    // Express body limit (1MB) returns 413; if body limit raised, Zod (2MB max) returns 400. Accept either.
    assert('Oversized rejected (4xx)', res.status === 400 || res.status === 413,
      `Got ${res.status}`);

    // ─── Test 8: PDF includes signatures ───
    logger.info('\nTest 8: PDF includes signatures');
    const pdfRes = await api.get(`/api/bills/${billId}/pdf`, {
      headers: h,
      responseType: 'arraybuffer',
    });
    assert('PDF generated (200)', pdfRes.status === 200);
    assert('PDF size larger with signatures',
      pdfRes.data.byteLength > 30000,
      `Size: ${pdfRes.data.byteLength}`);

    // ─── Test 9: Event log captures signatures ───
    logger.info('\nTest 9: Events tracked');
    res = await api.get(`/api/bills/${billId}`, { headers: h });
    const events = res.data.data?.events || [];
    assert('CUSTOMER_SIGNED event present',
      events.some(e => e.eventType === 'CUSTOMER_SIGNED'));
    assert('ISSUER_SIGNED event present',
      events.some(e => e.eventType === 'ISSUER_SIGNED'));

    // ─── Test 10: Clear customer signature ───
    logger.info('\nTest 10: Clear customer signature');
    res = await api.delete(`/api/bills/${billId}/customer-signature`, { headers: h });
    assert('Customer signature cleared (200)', res.status === 200, `Got ${res.status}`);

    res = await api.get(`/api/bills/${billId}/signatures`, { headers: h });
    assert('hasCustomerSignature now false', res.data.data?.hasCustomerSignature === false);
    assert('hasIssuerSignature still true', res.data.data?.hasIssuerSignature === true);

    // ─── Test 11: Clear when already empty ───
    logger.info('\nTest 11: Clear empty signature');
    res = await api.delete(`/api/bills/${billId}/customer-signature`, { headers: h });
    assert('Empty clear rejected (400)', res.status === 400, `Got ${res.status}`);

    // Cleanup
    logger.info('\nCleanup');
    if (createdOwnBill) {
      const superRes = await api.post('/api/auth/login', {
        email: process.env.SEED_ADMIN_EMAIL,
        password: process.env.SEED_ADMIN_PASSWORD,
      });
      const superH = { Authorization: `Bearer ${superRes.data.accessToken}` };
      await api.delete(`/api/bills/${billId}`, {
        headers: superH,
        data: { reason: 'E2E signature test cleanup' },
      });
      logger.info('  ✅ Test bill soft-deleted');
    }

    await mongoose.disconnect();

    logger.info('\n═══════════════════════════════════════');
    logger.info(`📊 Bill Signatures Tests: ${pass}/${pass + fail} passed`);
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
