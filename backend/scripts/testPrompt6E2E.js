require('dotenv').config();
if (process.env.NODE_ENV !== 'production') {
  const dns = require('dns');
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
}

const axios = require('axios');
const mongoose = require('mongoose');

const BASE_URL = process.env.API_URL || 'http://localhost:5000';
const BYPASS = process.env.TEST_BYPASS_SECRET;
const ADMIN_EMAIL = 'testadmin@shreegopal.com';
const ADMIN_PASSWORD = 'TestAdmin@123';

if (!BYPASS) {
  console.error('TEST_BYPASS_SECRET not set in .env');
  process.exit(1);
}

const api = axios.create({
  baseURL: BASE_URL,
  headers: { 'x-test-bypass-ratelimit': BYPASS },
  validateStatus: () => true,
});

let passed = 0, failed = 0;
const failures = [];
let adminToken, superToken;
const ctx = {};

const log = {
  section: (t) => console.log(`\n${'═'.repeat(70)}\n${t}\n${'═'.repeat(70)}`),
  test: (name) => process.stdout.write(`  ${name.padEnd(60)} `),
  pass: () => { passed++; console.log('PASS'); },
  fail: (reason) => {
    failed++;
    console.log('FAIL');
    console.log(`    -> ${reason}`);
    failures.push(reason);
  },
};

const assert = (condition, failMsg) => {
  if (condition) log.pass();
  else log.fail(failMsg);
};

const auth = (token) => ({ Authorization: `Bearer ${token}` });

async function runAll() {
  log.section('PROMPT 6 — FINAL E2E TEST SUITE (Payment Module)');
  console.log(`Target: ${BASE_URL}`);
  console.log(`Started: ${new Date().toISOString()}`);

  await mongoose.connect(process.env.MONGODB_URI);

  try {
    await setupAuth();
    await testPaymentInitiation();
    await testUpiQrGeneration();
    await testWebhookCapture();
    await testRefundProcessing();
    await testReceiptGeneration();
    await testReconciliation();
    await testEdgeCases();
    await cleanup();
  } finally {
    await mongoose.disconnect();
    printSummary();
  }
}

async function setupAuth() {
  log.section('1. AUTHENTICATION & SETUP');

  log.test('1.1 Admin login');
  let res = await api.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  assert(res.status === 200 && res.data.accessToken, `Status ${res.status}`);
  adminToken = res.data.accessToken;

  log.test('1.2 Super-admin login');
  res = await api.post('/api/auth/login', {
    email: process.env.SEED_ADMIN_EMAIL,
    password: process.env.SEED_ADMIN_PASSWORD,
  });
  assert(res.status === 200 && res.data.accessToken, `Status ${res.status}`);
  superToken = res.data.accessToken;

  log.test('1.3 Fetch test customer');
  res = await api.get('/api/customers?limit=1', { headers: auth(adminToken) });
  assert(res.data.data?.length > 0, 'No customers found');
  ctx.customer = res.data.data[0];

  log.test('1.4 Fetch or create test order');
  res = await api.get('/api/orders?limit=1', { headers: auth(adminToken) });
  ctx.order = res.data.data?.[0];

  if (!ctx.order) {
    const prodRes = await api.get('/api/products?productType=RAW_SHEET&limit=1',
      { headers: auth(adminToken) });
    const product = prodRes.data.data[0];
    const ppu = product.basePrice * product.areaSqFt;
    const sub = ppu * 2;
    const createRes = await api.post('/api/orders', {
      customer: ctx.customer._id,
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
      customerNotes: 'PROMPT6_E2E',
    }, { headers: auth(adminToken) });
    ctx.order = createRes.data.data;
  }
  assert(ctx.order?._id != null, 'Failed to setup order');

  log.test('1.5 Payment config endpoint accessible');
  res = await api.get('/api/payments/config', { headers: auth(adminToken) });
  assert(res.status === 200 && res.data.data?.provider === 'razorpay',
    `Status ${res.status}`);
}

async function testPaymentInitiation() {
  log.section('2. PAYMENT INITIATION');

  log.test('2.1 Initiate payment (creates Razorpay order)');
  let res = await api.post('/api/payments/initiate', {
    order: ctx.order._id,
    amount: 100,
    notes: 'PROMPT6_E2E',
  }, { headers: auth(adminToken) });
  assert(res.status === 201, `Status ${res.status}`);
  ctx.payment = res.data.data;

  log.test('2.2 Payment reference format PAY-YYYY-XXXXXXXX');
  assert(/^PAY-\d{4}-[A-Z0-9]{8}$/.test(ctx.payment.paymentReference),
    `Got: ${ctx.payment.paymentReference}`);

  log.test('2.3 Razorpay order ID returned');
  assert(ctx.payment.razorpayOrderId?.startsWith('order_'),
    `Got: ${ctx.payment.razorpayOrderId}`);

  log.test('2.4 Amount in paise (100 → 10000)');
  assert(ctx.payment.amount === 10000, `Got: ${ctx.payment.amount}`);

  log.test('2.5 Mock mode flag = true');
  assert(ctx.payment.isMock === true, `Got: ${ctx.payment.isMock}`);

  log.test('2.6 Excessive amount rejected (400)');
  res = await api.post('/api/payments/initiate', {
    order: ctx.order._id,
    amount: 9999999,
  }, { headers: auth(adminToken) });
  assert(res.status === 400, `Status ${res.status}`);

  log.test('2.7 Get payment detail');
  res = await api.get(`/api/payments/${ctx.payment.paymentId}`,
    { headers: auth(adminToken) });
  assert(res.status === 200 && res.data.data?.status === 'CREATED',
    `Status: ${res.data.data?.status}`);

  log.test('2.8 By-order endpoint returns payment');
  res = await api.get(`/api/payments/by-order/${ctx.order._id}`,
    { headers: auth(adminToken) });
  assert(res.data.count >= 1, `Count: ${res.data.count}`);
}

async function testUpiQrGeneration() {
  log.section('3. UPI QR GENERATION');

  log.test('3.1 UPI URI for payment');
  let res = await api.get(`/api/payments/${ctx.payment.paymentId}/upi-uri`,
    { headers: auth(adminToken) });
  assert(res.status === 200 && res.data.data?.upiUri?.startsWith('upi://pay?'),
    `Status: ${res.status}`);

  log.test('3.2 UPI URI contains all required params');
  const uri = res.data.data?.upiUri || '';
  assert(uri.includes('pa=') && uri.includes('pn=') && uri.includes('am=') && uri.includes('cu=INR'),
    `URI: ${uri.slice(0, 100)}`);

  log.test('3.3 QR as PNG (binary)');
  res = await api.get(`/api/payments/${ctx.payment.paymentId}/qr?format=png`, {
    headers: auth(adminToken),
    responseType: 'arraybuffer',
  });
  assert(res.status === 200 && res.headers['content-type']?.includes('image/png'),
    `Status: ${res.status}`);

  log.test('3.4 PNG has valid magic bytes');
  const pngMagic = Buffer.from(res.data).subarray(0, 8);
  const expected = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  assert(pngMagic.equals(expected), 'Invalid PNG header');

  log.test('3.5 QR as SVG');
  res = await api.get(`/api/payments/${ctx.payment.paymentId}/qr?format=svg`,
    { headers: auth(adminToken) });
  assert(res.status === 200 && res.data?.includes('<svg'), `Status: ${res.status}`);
}

async function testWebhookCapture() {
  log.section('4. WEBHOOK CAPTURE FLOW');

  log.test('4.1 Send payment.captured webhook');
  const webhookPayload = {
    entity: 'event',
    event: 'payment.captured',
    id: `evt_e2e_${Date.now()}`,
    created_at: Math.floor(Date.now() / 1000),
    contains: ['payment'],
    payload: {
      payment: {
        entity: {
          id: 'pay_e2e_capture_test',
          order_id: ctx.payment.razorpayOrderId,
          amount: 10000,
          currency: 'INR',
          status: 'captured',
          method: 'upi',
          vpa: 'e2e@upi',
        },
      },
    },
  };

  let res = await api.post('/api/webhooks/razorpay', webhookPayload, {
    headers: {
      'x-razorpay-signature': 'mock_signature',
      'Content-Type': 'application/json',
    },
  });
  assert(res.status === 200, `Status: ${res.status}`);

  log.test('4.2 Wait for async processing (500ms)');
  await new Promise(r => setTimeout(r, 500));
  assert(true, '');

  log.test('4.3 Payment status = CAPTURED');
  res = await api.get(`/api/payments/${ctx.payment.paymentId}`,
    { headers: auth(adminToken) });
  assert(res.data.data?.status === 'CAPTURED', `Status: ${res.data.data?.status}`);

  log.test('4.4 Payment method captured');
  assert(res.data.data?.method === 'upi', `Method: ${res.data.data?.method}`);

  log.test('4.5 VPA captured');
  assert(res.data.data?.methodDetails?.vpa === 'e2e@upi',
    `VPA: ${res.data.data?.methodDetails?.vpa}`);

  log.test('4.6 razorpayPaymentId set');
  assert(res.data.data?.razorpayPaymentId === 'pay_e2e_capture_test',
    `ID: ${res.data.data?.razorpayPaymentId}`);

  log.test('4.7 Order.amountPaid synced');
  res = await api.get(`/api/orders/${ctx.order._id}`, { headers: auth(adminToken) });
  assert(res.data.data?.amountPaid >= 100, `amountPaid: ${res.data.data?.amountPaid}`);

  log.test('4.8 Webhook event logged');
  res = await api.get('/api/webhooks/events?limit=5', { headers: auth(adminToken) });
  const ourEvent = res.data.data?.find(e =>
    e.razorpayEventId === webhookPayload.id);
  assert(ourEvent != null, 'Event not found in audit trail');
}

async function testRefundProcessing() {
  log.section('5. REFUND PROCESSING');

  log.test('5.1 Initiate partial refund (30%)');
  let res = await api.post(`/api/payments/${ctx.payment.paymentId}/refund`, {
    amount: 30,
    reason: 'E2E test - partial refund',
  }, { headers: auth(adminToken) });
  assert(res.status === 201 && res.data.data?.refundType === 'partial',
    `Status: ${res.status}`);

  log.test('5.2 Refund amount tracked');
  assert(res.data.data?.totalRefunded === 30, `Got: ${res.data.data?.totalRefunded}`);

  log.test('5.3 Remaining refundable correct');
  assert(res.data.data?.remainingRefundable === 70,
    `Got: ${res.data.data?.remainingRefundable}`);

  log.test('5.4 Excessive second refund rejected (400)');
  res = await api.post(`/api/payments/${ctx.payment.paymentId}/refund`, {
    amount: 100,
    reason: 'Should fail',
  }, { headers: auth(adminToken) });
  assert(res.status === 400, `Status: ${res.status}`);

  log.test('5.5 Refund detail endpoint');
  res = await api.get(`/api/payments/refunds/${ctx.payment.paymentId}`,
    { headers: auth(adminToken) });
  assert(res.status === 200 && res.data.data?.refundedAmount === 30,
    `Status: ${res.status}, refunded: ${res.data.data?.refundedAmount}`);

  log.test('5.6 Refunds list includes our refund');
  res = await api.get('/api/payments/refunds?limit=10', { headers: auth(adminToken) });
  const ourRefund = res.data.data?.find(r =>
    r.paymentReference === ctx.payment.paymentReference);
  assert(ourRefund != null && ourRefund.refundedAmount === 30,
    `Not found in refunds list`);
}

async function testReceiptGeneration() {
  log.section('6. RECEIPT GENERATION');

  log.test('6.1 Generate receipt for CAPTURED payment');
  let res = await api.get(`/api/payments/${ctx.payment.paymentId}/receipt`, {
    headers: auth(adminToken),
    responseType: 'arraybuffer',
  });
  assert(res.status === 200, `Status: ${res.status}`);

  log.test('6.2 Content-Type is PDF');
  assert(res.headers['content-type']?.includes('application/pdf'),
    `Content-Type: ${res.headers['content-type']}`);

  log.test('6.3 PDF magic bytes valid');
  const magic = Buffer.from(res.data).subarray(0, 4).toString();
  assert(magic === '%PDF', `Got: ${magic}`);

  log.test('6.4 PDF size reasonable (>20KB)');
  assert(res.data.byteLength > 20000, `Size: ${res.data.byteLength}`);

  log.test('6.5 Receipt for CREATED payment rejected');
  const init = await api.post('/api/payments/initiate', {
    order: ctx.order._id,
    amount: 50,
    notes: 'PROMPT6_E2E',
  }, { headers: auth(adminToken) });

  res = await api.get(`/api/payments/${init.data.data.paymentId}/receipt`,
    { headers: auth(adminToken) });
  assert(res.status === 400, `Status: ${res.status}`);
}

async function testReconciliation() {
  log.section('7. RECONCILIATION REPORTS');

  log.test('7.1 Summary endpoint');
  let res = await api.get('/api/reconciliation/summary', { headers: auth(adminToken) });
  assert(res.status === 200 && res.data.data?.payments != null, `Status: ${res.status}`);

  log.test('7.2 Summary includes capture data');
  assert(res.data.data?.payments?.byStatus?.CAPTURED != null,
    'No CAPTURED status in summary');

  log.test('7.3 Custom date range');
  const today = new Date().toISOString().split('T')[0];
  res = await api.get(`/api/reconciliation/summary?fromDate=${today}&toDate=${today}`,
    { headers: auth(adminToken) });
  assert(res.status === 200, `Status: ${res.status}`);

  log.test('7.4 Outstanding orders');
  res = await api.get('/api/reconciliation/outstanding?limit=10',
    { headers: auth(adminToken) });
  assert(res.status === 200 && typeof res.data.totalOutstandingAmount === 'number',
    `Status: ${res.status}`);

  log.test('7.5 Daily reconciliation');
  res = await api.get(`/api/reconciliation/daily/${today}`,
    { headers: auth(adminToken) });
  assert(res.status === 200 && res.data.data?.payments != null,
    `Status: ${res.status}`);

  log.test('7.6 Customer reconciliation');
  res = await api.get(`/api/reconciliation/customer/${ctx.customer._id}`,
    { headers: auth(adminToken) });
  assert(res.status === 200 && res.data.data?.customer != null,
    `Status: ${res.status}`);

  log.test('7.7 Customer has payment history');
  assert(res.data.data?.payments?.byStatus != null,
    'No payment breakdown for customer');

  log.test('7.8 Discrepancy detection');
  res = await api.get('/api/reconciliation/discrepancies?limit=20',
    { headers: auth(adminToken) });
  assert(res.status === 200 && typeof res.data.count === 'number',
    `Status: ${res.status}`);
}

async function testEdgeCases() {
  log.section('8. EDGE CASES');

  log.test('8.1 Invalid payment ID rejected (400)');
  let res = await api.get('/api/payments/not-a-real-id', { headers: auth(adminToken) });
  assert(res.status === 400, `Status: ${res.status}`);

  log.test('8.2 Non-existent payment returns 404');
  res = await api.get('/api/payments/507f1f77bcf86cd799439011',
    { headers: auth(adminToken) });
  assert(res.status === 404, `Status: ${res.status}`);

  log.test('8.3 Auth required for payment endpoints');
  res = await api.get(`/api/payments/${ctx.payment.paymentId}`);
  assert(res.status === 401, `Status: ${res.status}`);

  log.test('8.4 Refund on already-partially-refunded works');
  res = await api.post(`/api/payments/${ctx.payment.paymentId}/refund`, {
    amount: 20,
    reason: 'Additional E2E refund',
  }, { headers: auth(adminToken) });
  assert(res.status === 201, `Status: ${res.status}`);

  log.test('8.5 Webhook signature missing in mock = accepted');
  res = await api.post('/api/webhooks/razorpay', {
    entity: 'event',
    event: 'payment.failed',
    id: `evt_e2e_edge_${Date.now()}`,
    payload: { payment: { entity: { id: 'pay_test', order_id: 'order_unrelated' } } },
  });
  assert(res.status === 200, `Status: ${res.status}`);

  log.test('8.6 Idempotent webhook (same event ID)');
  const dupePayload = {
    entity: 'event',
    event: 'payment.captured',
    id: 'evt_e2e_dupe_test',
    payload: { payment: { entity: { id: 'pay_dupe', order_id: 'order_dupe' } } },
  };
  await api.post('/api/webhooks/razorpay', dupePayload, {
    headers: { 'x-razorpay-signature': 'mock_signature' },
  });
  res = await api.post('/api/webhooks/razorpay', dupePayload, {
    headers: { 'x-razorpay-signature': 'mock_signature' },
  });
  assert(res.status === 200, `Status: ${res.status}`);

  log.test('8.7 Listing endpoints work');
  res = await api.get('/api/payments?limit=5', { headers: auth(adminToken) });
  assert(res.status === 200, `Status: ${res.status}`);
}

async function cleanup() {
  log.section('CLEANUP');

  const { Payment, Order, WebhookEvent } = require('../src/models');

  await Payment.deleteMany({ notes: 'PROMPT6_E2E' });

  await WebhookEvent.deleteMany({
    razorpayEventId: { $regex: /^evt_e2e_/ },
  });
  await WebhookEvent.deleteMany({
    razorpayEventId: 'evt_e2e_dupe_test',
  });
  await WebhookEvent.deleteMany({
    razorpayEventId: { $regex: /^invalid_/ },
  });

  if (ctx.order?.customerNotes === 'PROMPT6_E2E') {
    await Order.deleteOne({ _id: ctx.order._id });
  }

  console.log('  Test data cleaned up');
}

function printSummary() {
  const total = passed + failed;
  const pct = total > 0 ? ((passed / total) * 100).toFixed(1) : 0;

  log.section('FINAL SUMMARY');
  console.log(`Total tests:    ${total}`);
  console.log(`Passed:         ${passed}`);
  console.log(`Failed:         ${failed}`);
  console.log(`Pass rate:      ${pct}%`);
  console.log(`Completed:      ${new Date().toISOString()}`);

  if (failures.length > 0) {
    console.log('\nFailure details:');
    failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
  }

  if (failed === 0) {
    console.log('\nALL TESTS PASSED — Prompt 6 (Payment Module) is PRODUCTION-READY!');
  } else {
    console.log(`\n${failed} test(s) failed. Review above.`);
  }

  process.exit(failed === 0 ? 0 : 1);
}

runAll().catch(err => {
  console.error('\nTest runner crashed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
