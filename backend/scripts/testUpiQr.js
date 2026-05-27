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
    assert('Login successful', loginRes.status === 200);

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
        customerNotes: 'UPI_QR_TEST',
      };
      const createOrderRes = await api.post('/api/orders', orderBody, { headers: h });
      testOrder = createOrderRes.data.data;
      createdOwnOrder = true;
    }
    assert('Test order available', testOrder?._id != null);

    logger.info('\nInitiate test payment');
    const initRes = await api.post('/api/payments/initiate', {
      order: testOrder._id,
      amount: 1,
      notes: 'UPI_QR_TEST',
    }, { headers: h });

    assert('Payment initiated', initRes.status === 201, `Got ${initRes.status}: ${JSON.stringify(initRes.data).substring(0, 200)}`);
    const paymentId = initRes.data.data.paymentId;
    const paymentRef = initRes.data.data.paymentReference;

    // ─── Test 1: Get UPI URI ───
    logger.info('\nTest 1: UPI URI endpoint');
    let res = await api.get(`/api/payments/${paymentId}/upi-uri`, { headers: h });
    assert('UPI URI endpoint 200', res.status === 200, `Got ${res.status}`);
    assert('Reference returned', res.data.data?.paymentReference === paymentRef);
    assert('UPI URI format', res.data.data?.upiUri?.startsWith('upi://pay?'));
    assert('URI has pa parameter', res.data.data?.upiUri?.includes('pa='));
    assert('URI has amount', res.data.data?.upiUri?.includes('am=1.00'));
    assert('URI has reference', res.data.data?.upiUri?.includes('tr='));
    assert('URI has currency INR', res.data.data?.upiUri?.includes('cu=INR'));

    // ─── Test 2: QR as data URL ───
    logger.info('\nTest 2: QR data URL');
    res = await api.get(`/api/payments/${paymentId}/qr`, { headers: h });
    assert('QR endpoint 200', res.status === 200);
    assert('Has qrDataUrl', res.data.data?.qrDataUrl?.startsWith('data:image/png;base64,'));
    assert('Data URL reasonable length', (res.data.data?.qrDataUrl?.length || 0) > 500);

    // ─── Test 3: QR as PNG ───
    logger.info('\nTest 3: QR as PNG image');
    res = await api.get(`/api/payments/${paymentId}/qr?format=png`, {
      headers: h,
      responseType: 'arraybuffer',
    });
    assert('PNG endpoint 200', res.status === 200);
    assert('Content-Type is PNG', res.headers['content-type']?.includes('image/png'));

    const pngMagic = Buffer.from(res.data).subarray(0, 8);
    const expectedMagic = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    assert('PNG magic bytes valid', pngMagic.equals(expectedMagic));
    assert('PNG reasonable size', res.data.byteLength > 500);

    const outputDir = path.join(__dirname, '..', 'storage', 'qr-samples');
    await fs.mkdir(outputDir, { recursive: true });
    const pngPath = path.join(outputDir, `sample-${paymentRef}.png`);
    await fs.writeFile(pngPath, Buffer.from(res.data));
    logger.info(`  💾 Saved sample PNG: ${pngPath}`);

    // ─── Test 4: QR as SVG ───
    logger.info('\nTest 4: QR as SVG');
    res = await api.get(`/api/payments/${paymentId}/qr?format=svg`, { headers: h });
    assert('SVG endpoint 200', res.status === 200);
    assert('Content-Type is SVG', res.headers['content-type']?.includes('image/svg'));
    assert('Has SVG tag', res.data?.includes('<svg'));

    const svgPath = path.join(outputDir, `sample-${paymentRef}.svg`);
    await fs.writeFile(svgPath, res.data);
    logger.info(`  💾 Saved sample SVG: ${svgPath}`);

    // ─── Test 5: Custom size ───
    logger.info('\nTest 5: Custom QR size');
    res = await api.get(`/api/payments/${paymentId}/qr?size=500`, { headers: h });
    assert('Custom size 200', res.status === 200);
    assert('Size echoed', res.data.data?.size === 500);

    // ─── Test 6: Invalid payment ID ───
    logger.info('\nTest 6: Invalid payment ID');
    res = await api.get('/api/payments/not-a-real-id/qr', { headers: h });
    assert('Invalid ID rejected (400)', res.status === 400, `Got ${res.status}`);

    // ─── Test 7: Non-existent payment ───
    logger.info('\nTest 7: Non-existent payment');
    res = await api.get('/api/payments/507f1f77bcf86cd799439011/qr', { headers: h });
    assert('Not found returns 404', res.status === 404, `Got ${res.status}`);

    // ─── Test 8: QR rejected for captured payment ───
    logger.info('\nTest 8: QR rejected for completed payments');

    await api.post('/api/payments/verify', {
      paymentReference: paymentRef,
      razorpayOrderId: initRes.data.data.razorpayOrderId,
      razorpayPaymentId: 'pay_mock_qrtest',
      razorpaySignature: 'mock_signature',
    }, { headers: h });

    res = await api.get(`/api/payments/${paymentId}/qr`, { headers: h });
    assert('Captured payment QR rejected (400)', res.status === 400, `Got ${res.status}`);

    res = await api.get(`/api/payments/${paymentId}/upi-uri`, { headers: h });
    assert('Captured payment URI rejected (400)', res.status === 400, `Got ${res.status}`);

    // Cleanup
    logger.info('\nCleanup');
    const { Payment, Order } = require('../src/models');
    await Payment.deleteMany({ notes: 'UPI_QR_TEST' });
    if (createdOwnOrder) {
      await Order.deleteOne({ _id: testOrder._id });
    }

    await mongoose.disconnect();

    logger.info('\n═══════════════════════════════════════');
    logger.info(`📊 UPI QR Tests: ${pass}/${pass + fail} passed`);
    if (failures.length > 0) {
      logger.info('\nFailures:');
      failures.forEach((f, i) => logger.info(`  ${i + 1}. ${f}`));
    }

    logger.info('\n📂 Sample QR files saved to backend/storage/qr-samples/');
    logger.info('   Open them visually to verify the QR scans correctly with any UPI app.');

    process.exit(fail === 0 ? 0 : 1);
  } catch (error) {
    logger.error('Test crashed:', error);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  }
};

test();
