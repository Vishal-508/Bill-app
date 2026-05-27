require('dotenv').config();
if (process.env.NODE_ENV !== 'production') {
  const dns = require('dns');
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
}

const axios = require('axios');
const mongoose = require('mongoose');
const fs = require('fs/promises');
const path = require('path');
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
        customerNotes: 'RECEIPT_TEST',
      };
      const createOrderRes = await api.post('/api/orders', orderBody, { headers: h });
      testOrder = createOrderRes.data.data;
      createdOwnOrder = true;
    }

    logger.info('\nSetup: Create captured payment for receipt');
    const initRes = await api.post('/api/payments/initiate', {
      order: testOrder._id,
      amount: 2500,
      notes: 'RECEIPT_TEST',
    }, { headers: h });

    const paymentId = initRes.data.data.paymentId;
    const paymentRef = initRes.data.data.paymentReference;

    await api.post('/api/payments/verify', {
      paymentReference: paymentRef,
      razorpayOrderId: initRes.data.data.razorpayOrderId,
      razorpayPaymentId: 'pay_mock_receipt_test',
      razorpaySignature: 'mock_signature',
    }, { headers: h });

    // ─── Test 1: Generate receipt for CAPTURED payment ───
    logger.info('\nTest 1: Receipt for CAPTURED payment');
    let res = await api.get(`/api/payments/${paymentId}/receipt`, {
      headers: h,
      responseType: 'arraybuffer',
    });

    assert('Receipt endpoint 200', res.status === 200, `Got ${res.status}`);
    assert('Content-Type is PDF', res.headers['content-type']?.includes('pdf'));

    const magic = Buffer.from(res.data).subarray(0, 4).toString();
    assert('PDF magic bytes valid', magic === '%PDF');
    assert('Reasonable size (>20KB)', res.data.byteLength > 20000);

    const samplePath = path.join(__dirname, '..', 'storage', 'receipts', `sample_${paymentRef}.pdf`);
    await fs.writeFile(samplePath, Buffer.from(res.data));
    logger.info(`  💾 Saved sample: ${samplePath}`);

    // ─── Test 2: Invalid payment ID ───
    logger.info('\nTest 2: Invalid payment ID');
    res = await api.get('/api/payments/not-valid/receipt', { headers: h });
    assert('Invalid ID rejected (400)', res.status === 400);

    // ─── Test 3: Non-existent payment ───
    logger.info('\nTest 3: Non-existent payment');
    res = await api.get('/api/payments/507f1f77bcf86cd799439011/receipt', { headers: h });
    assert('Non-existent rejected (404)', res.status === 404);

    // ─── Test 4: Cannot generate receipt for CREATED payment ───
    logger.info('\nTest 4: Cannot generate for non-captured');

    const init2 = await api.post('/api/payments/initiate', {
      order: testOrder._id,
      amount: 500,
      notes: 'RECEIPT_TEST',
    }, { headers: h });

    res = await api.get(`/api/payments/${init2.data.data.paymentId}/receipt`, { headers: h });
    assert('CREATED status rejected (400)', res.status === 400);

    // ─── Test 5: Receipt for partially refunded payment ───
    logger.info('\nTest 5: Receipt with refund');

    await api.post(`/api/payments/${paymentId}/refund`, {
      amount: 1000,
      reason: 'Test partial refund for receipt',
    }, { headers: h });

    res = await api.get(`/api/payments/${paymentId}/receipt`, {
      headers: h,
      responseType: 'arraybuffer',
    });

    assert('Refund receipt 200', res.status === 200);
    assert('Refund receipt has %PDF', Buffer.from(res.data).subarray(0, 4).toString() === '%PDF');
    assert('Refund receipt size > 25KB', res.data.byteLength > 25000);

    const refundSamplePath = path.join(__dirname, '..', 'storage', 'receipts', `sample_${paymentRef}_with_refund.pdf`);
    await fs.writeFile(refundSamplePath, Buffer.from(res.data));
    logger.info(`  💾 Saved with refund: ${refundSamplePath}`);

    // ─── Test 6: Receipt for fully REFUNDED payment ───
    logger.info('\nTest 6: Receipt for REFUNDED payment');

    await api.post(`/api/payments/${paymentId}/refund`, {
      amount: 1500,
      reason: 'Full refund test',
    }, { headers: h });

    res = await api.get(`/api/payments/${paymentId}/receipt`, {
      headers: h,
      responseType: 'arraybuffer',
    });

    assert('Full refund receipt 200', res.status === 200);
    assert('Full refund PDF generated', Buffer.from(res.data).subarray(0, 4).toString() === '%PDF');

    const fullRefundSamplePath = path.join(__dirname, '..', 'storage', 'receipts', `sample_${paymentRef}_full_refund.pdf`);
    await fs.writeFile(fullRefundSamplePath, Buffer.from(res.data));
    logger.info(`  💾 Saved full refund: ${fullRefundSamplePath}`);

    // ─── Test 7: Auth required ───
    logger.info('\nTest 7: Auth required');
    res = await api.get(`/api/payments/${paymentId}/receipt`);
    assert('No auth rejected (401)', res.status === 401, `Got ${res.status}`);

    // Cleanup
    logger.info('\nCleanup');
    const { Payment, Order } = require('../src/models');
    await Payment.deleteMany({ notes: 'RECEIPT_TEST' });
    if (createdOwnOrder) {
      await Order.deleteOne({ _id: testOrder._id });
    }

    await mongoose.disconnect();

    logger.info('\n═══════════════════════════════════════');
    logger.info(`📊 Payment Receipt Tests: ${pass}/${pass + fail} passed`);
    if (failures.length > 0) {
      logger.info('\nFailures:');
      failures.forEach((f, i) => logger.info(`  ${i + 1}. ${f}`));
    }

    logger.info('\n📂 Sample receipts saved to backend/storage/receipts/');
    logger.info('   Open them to verify visual quality:');
    logger.info('   - sample_PAY-XXX.pdf (basic captured payment)');
    logger.info('   - sample_PAY-XXX_with_refund.pdf (partial refund)');
    logger.info('   - sample_PAY-XXX_full_refund.pdf (full refund)');

    process.exit(fail === 0 ? 0 : 1);
  } catch (error) {
    logger.error('Test crashed:', error);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  }
};

test();
