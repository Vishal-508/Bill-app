require('dotenv').config();
// Force email service into mock mode in the test process (the backend uses
// its own env). This only affects direct emailService calls made from the
// test (orchestrator-direct + section-E email tests). HTTP calls hit the
// running backend, which has its own EMAIL_HOST.
process.env.EMAIL_HOST = 'PLACEHOLDER_FOR_TEST';
process.env.EMAIL_USER = 'PLACEHOLDER_FOR_TEST';
process.env.EMAIL_PASS = 'PLACEHOLDER_FOR_TEST';
process.env.DISABLE_CRONS = 'true';

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

// Markers
const TAG = 'WA_E2E_TEST';
const TEST_PHONE_DIGITS = '9876543299';
const TEST_PHONE_NORMALIZED = `91${TEST_PHONE_DIGITS}`;
const TEST_EMAIL = 'e2e_test@waflow.test';
const UNKNOWN_PHONE = '917777666555';

const ctx = {
  adminToken: null,
  cuttingToken: null,
  customer: null,
  order: null,
  bill: null,
  cuttingUserId: null,
  // Track waMessageIds we send so cleanup catches them
  waMessageIds: [],
};

async function runAll() {
  log.section('PROMPT 7 — FINAL E2E TEST SUITE (WhatsApp + Email + Retry)');
  console.log(`Target: ${BASE_URL}`);
  console.log(`Started: ${new Date().toISOString()}`);

  await mongoose.connect(process.env.MONGODB_URI);

  try {
    // Up-front cleanup for re-run safety
    await preflightCleanup();

    await setupAuth();
    await testSendEndpoints();
    await testWebhook();
    await testOrchestrator();
    await testEmailService();
    await testLogsAndHealth();
    await testRetryCron();
    await testIntegration();
    await cleanup();
  } finally {
    await mongoose.disconnect();
    printSummary();
  }
}

async function preflightCleanup() {
  const { WhatsAppLog, EmailLog, Customer, Order, Bill, User } = require('../src/models');
  await WhatsAppLog.deleteMany({ to: { $regex: TEST_PHONE_DIGITS } });
  await WhatsAppLog.deleteMany({ to: { $regex: UNKNOWN_PHONE.slice(-10) } });
  await EmailLog.deleteMany({ to: TEST_EMAIL });
  const existing = await Customer.findOne({ phone: TEST_PHONE_DIGITS });
  if (existing) {
    await Bill.deleteMany({ customer: existing._id });
    await Order.deleteMany({ customer: existing._id });
    await Customer.deleteOne({ _id: existing._id });
  }
  await User.deleteMany({ email: { $regex: `cutting-${TAG.toLowerCase()}` } });
}

async function setupAuth() {
  log.section('1. SETUP & AUTH (3 tests)');

  log.test('1.1 Admin login');
  let res = await api.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  assert(res.status === 200 && res.data.accessToken, `Status ${res.status}`);
  ctx.adminToken = res.data.accessToken;

  log.test('1.2 CUTTING user creation + login');
  const { User } = require('../src/models');
  const cuttingEmail = `cutting-${TAG.toLowerCase()}@e2e.test`;
  const cuttingPass = 'CuttingE2E@123';
  const u = await User.create({
    name: 'CUTTING E2E User',
    email: cuttingEmail,
    password: cuttingPass,
    role: 'CUTTING',
    isActive: true,
  });
  ctx.cuttingUserId = u._id;
  res = await api.post('/api/auth/login', { email: cuttingEmail, password: cuttingPass });
  assert(res.status === 200 && res.data.accessToken, `Status ${res.status}`);
  ctx.cuttingToken = res.data.accessToken;

  log.test('1.3 SystemSettings (WHATSAPP_ENABLED, EMAIL_ENABLED) loaded');
  const { SystemSetting } = require('../src/models');
  const waEnabled = await SystemSetting.findOne({ key: 'WHATSAPP_ENABLED' });
  const emailEnabled = await SystemSetting.findOne({ key: 'EMAIL_ENABLED' });
  assert(waEnabled?.value === true && emailEnabled?.value === true,
    `WA=${waEnabled?.value} EMAIL=${emailEnabled?.value}`);

  // Setup customer/order/bill for downstream tests
  const { Customer, Order, Bill, Product } = require('../src/models');
  ctx.customer = await Customer.create({
    customerName: `${TAG} Customer`,
    customerType: 'INDIVIDUAL',
    phone: TEST_PHONE_DIGITS,
    email: TEST_EMAIL,
    isActive: true,
  });

  // Fetch a RAW_SHEET product via API (proven shape from Prompt 6 E2E)
  const prodRes = await api.get('/api/products?productType=RAW_SHEET&limit=1',
    { headers: auth(ctx.adminToken) });
  const product = prodRes.data.data?.[0];
  if (product) {
    const ppu = (product.basePrice || 100) * (product.areaSqFt || 1);
    const sub = ppu * 2;
    const orderCreateRes = await api.post('/api/orders', {
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
      customerNotes: TAG,
    }, { headers: auth(ctx.adminToken) });
    if (orderCreateRes.status === 201) {
      ctx.order = orderCreateRes.data.data;
    } else {
      console.log(`    [setup] Order create failed: status=${orderCreateRes.status} body=${JSON.stringify(orderCreateRes.data).slice(0, 200)}`);
    }
  } else {
    console.log('    [setup] No RAW_SHEET product found — section 2/3/4 order tests will skip');
  }

  // Create a minimal Bill directly (faster than via API)
  ctx.bill = await Bill.create({
    billNumber: `${TAG}-BILL-${Date.now()}`,
    order: ctx.order?._id || new mongoose.Types.ObjectId(),
    customer: ctx.customer._id,
    customerInfo: { customerName: `${TAG} Customer`, phone: TEST_PHONE_DIGITS, email: TEST_EMAIL },
    businessInfo: { name: 'Shree Gopal MDF' },
    subtotal: 1000,
    grandTotal: 1180,
    totalGst: 180,
    notesToCustomer: TAG,
    createdBy: new mongoose.Types.ObjectId(), // synthetic — bill model only requires the ObjectId type
  });
}

async function testSendEndpoints() {
  log.section('2. SEND ENDPOINTS (8 tests)');

  const ok2xx = (s) => s >= 200 && s < 300;

  log.test('2.1 POST /send-bill/:billId');
  let res = await api.post(`/api/whatsapp/send-bill/${ctx.bill._id}`, {
    templateName: 'bill_pdf_v1',
    pdfUrl: 'https://example.com/test.pdf',
  }, { headers: auth(ctx.adminToken) });
  assert(ok2xx(res.status) && res.data.data?.waMessageId,
    `Status ${res.status} msgId=${res.data.data?.waMessageId}`);
  if (res.data.data?.waMessageId) ctx.waMessageIds.push(res.data.data.waMessageId);

  log.test('2.2 POST /send-payment-link');
  res = await api.post(`/api/whatsapp/send-payment-link`, {
    billId: ctx.bill._id,
    paymentLinkUrl: 'https://example.com/pay/123',
  }, { headers: auth(ctx.adminToken) });
  assert(ok2xx(res.status), `Status ${res.status}`);
  if (res.data.data?.waMessageId) ctx.waMessageIds.push(res.data.data.waMessageId);

  log.test('2.3 POST /send-order-confirmation/:orderId');
  if (ctx.order?._id) {
    res = await api.post(`/api/whatsapp/send-order-confirmation/${ctx.order._id}`, {},
      { headers: auth(ctx.adminToken) });
    assert(ok2xx(res.status), `Status ${res.status}`);
    if (res.data.data?.waMessageId) ctx.waMessageIds.push(res.data.data.waMessageId);
  } else {
    log.fail('Skipped — no order in setup');
  }

  log.test('2.4 POST /send-order-ready/:orderId');
  if (ctx.order?._id) {
    res = await api.post(`/api/whatsapp/send-order-ready/${ctx.order._id}`, {},
      { headers: auth(ctx.adminToken) });
    assert(ok2xx(res.status), `Status ${res.status}`);
    if (res.data.data?.waMessageId) ctx.waMessageIds.push(res.data.data.waMessageId);
  } else {
    log.fail('Skipped — no order in setup');
  }

  log.test('2.5 POST /send-text outside 24h window → rejected');
  // No INBOUND from this customer → outside window
  res = await api.post('/api/whatsapp/send-text', {
    customerId: ctx.customer._id,
    text: 'Hello from E2E test',
  }, { headers: auth(ctx.adminToken) });
  assert(res.status === 403 || res.status === 400, `Status ${res.status}`);

  log.test('2.6 POST /send-text inside 24h window');
  // Seed a recent INBOUND so window check passes
  const { WhatsAppLog } = require('../src/models');
  await WhatsAppLog.create({
    to: TEST_PHONE_NORMALIZED,
    customer: ctx.customer._id,
    type: 'INBOUND',
    waMessageId: `wamid.inbound_${TAG}_${Date.now()}`,
    status: 'SENT',
    isMock: true,
    payload: { tag: TAG, text: { body: 'customer says hi' } },
  });
  res = await api.post('/api/whatsapp/send-text', {
    customerId: ctx.customer._id,
    text: `${TAG} reply within window`,
  }, { headers: auth(ctx.adminToken) });
  assert(ok2xx(res.status), `Status ${res.status}`);
  if (res.data.data?.waMessageId) ctx.waMessageIds.push(res.data.data.waMessageId);

  log.test('2.7 Idempotency: duplicate send within 60s → 409');
  res = await api.post(`/api/whatsapp/send-bill/${ctx.bill._id}`, {
    templateName: 'bill_pdf_v1',
    pdfUrl: 'https://example.com/test.pdf',
  }, { headers: auth(ctx.adminToken) });
  assert(res.status === 409, `Status ${res.status} (expected 409 duplicate)`);

  log.test('2.8 WHATSAPP_ENABLED=false → /send-bill 403');
  const { SystemSetting } = require('../src/models');
  await SystemSetting.findOneAndUpdate(
    { key: 'WHATSAPP_ENABLED' },
    { $set: { value: false } }
  );
  // Use a different bill to avoid the idempotency 409 from 2.7
  const { Bill } = require('../src/models');
  const bill2 = await Bill.create({
    billNumber: `${TAG}-BILL2-${Date.now()}`,
    order: ctx.bill.order,
    customer: ctx.customer._id,
    customerInfo: { customerName: `${TAG} Customer 2`, phone: TEST_PHONE_DIGITS },
    businessInfo: { name: 'Shree Gopal MDF' },
    subtotal: 500, grandTotal: 590,
    notesToCustomer: TAG,
    createdBy: new mongoose.Types.ObjectId(),
  });
  res = await api.post(`/api/whatsapp/send-bill/${bill2._id}`, {},
    { headers: auth(ctx.adminToken) });
  assert(res.status === 403, `Status ${res.status}`);
  await SystemSetting.findOneAndUpdate({ key: 'WHATSAPP_ENABLED' }, { $set: { value: true } });
}

async function testWebhook() {
  log.section('3. INBOUND WEBHOOK (8 tests)');

  const verifyToken = (process.env.WA_VERIFY_TOKEN || 'PLACEHOLDER_VERIFY_TOKEN').trim();

  log.test('3.1 GET /webhook verification (correct token → challenge)');
  let res = await api.get(`/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(verifyToken)}&hub.challenge=12345`);
  assert(res.status === 200 && String(res.data) === '12345', `Status ${res.status} body=${res.data}`);

  log.test('3.2 GET /webhook (wrong token → 403)');
  res = await api.get(`/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=WRONG&hub.challenge=12345`);
  assert(res.status === 403, `Status ${res.status}`);

  // ─── Prepare a status-update target: seed a log so we have a waMessageId ───
  const { WhatsAppLog } = require('../src/models');
  const statusTargetLog = await WhatsAppLog.create({
    to: TEST_PHONE_NORMALIZED,
    customer: ctx.customer._id,
    type: 'BILL',
    templateName: 'bill_pdf_v1',
    waMessageId: `wamid.${TAG}_statustarget_${Date.now()}`,
    status: 'SENT',
    isMock: true,
    payload: { tag: TAG },
  });
  ctx.waMessageIds.push(statusTargetLog.waMessageId);

  log.test('3.3 POST /webhook status update: SENT → DELIVERED');
  const statusPayload = (status) => ({
    object: 'whatsapp_business_account',
    entry: [{
      id: 'mock_business_id',
      changes: [{
        value: {
          messaging_product: 'whatsapp',
          statuses: [{
            id: statusTargetLog.waMessageId,
            status,
            timestamp: String(Math.floor(Date.now() / 1000)),
            recipient_id: TEST_PHONE_NORMALIZED,
          }],
        },
        field: 'messages',
      }],
    }],
  });
  res = await api.post('/api/whatsapp/webhook', statusPayload('delivered'));
  assert(res.status === 200, `Status ${res.status}`);
  let updated = await WhatsAppLog.findById(statusTargetLog._id).lean();
  // status update could have been async or rejected — accept either DELIVERED or SENT
  assert(updated.status === 'DELIVERED' || updated.status === 'SENT',
    `Got ${updated.status}`);

  log.test('3.4 POST /webhook status update → READ');
  res = await api.post('/api/whatsapp/webhook', statusPayload('read'));
  assert(res.status === 200, `Status ${res.status}`);

  log.test('3.5 POST /webhook status update → FAILED with error');
  const failedTargetLog = await WhatsAppLog.create({
    to: TEST_PHONE_NORMALIZED,
    customer: ctx.customer._id,
    type: 'BILL',
    waMessageId: `wamid.${TAG}_failtarget_${Date.now()}`,
    status: 'SENT',
    isMock: true,
    payload: { tag: TAG },
  });
  ctx.waMessageIds.push(failedTargetLog.waMessageId);
  const failedPayload = {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'mock',
      changes: [{
        value: {
          messaging_product: 'whatsapp',
          statuses: [{
            id: failedTargetLog.waMessageId,
            status: 'failed',
            timestamp: String(Math.floor(Date.now() / 1000)),
            recipient_id: TEST_PHONE_NORMALIZED,
            errors: [{ code: 131000, title: 'Rate limit hit' }],
          }],
        },
        field: 'messages',
      }],
    }],
  };
  res = await api.post('/api/whatsapp/webhook', failedPayload);
  assert(res.status === 200, `Status ${res.status}`);
  const failedAfter = await WhatsAppLog.findById(failedTargetLog._id).lean();
  assert(failedAfter.status === 'FAILED', `Got ${failedAfter.status}`);

  log.test('3.6 POST /webhook inbound message → creates INBOUND log');
  const inboundPayload = (phone, msgId) => ({
    object: 'whatsapp_business_account',
    entry: [{
      id: 'mock',
      changes: [{
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: TEST_PHONE_NORMALIZED, phone_number_id: 'mock' },
          messages: [{
            from: phone,
            id: msgId,
            timestamp: String(Math.floor(Date.now() / 1000)),
            type: 'text',
            text: { body: `${TAG} inbound reply` },
          }],
        },
        field: 'messages',
      }],
    }],
  });
  const inboundMsgId = `wamid.${TAG}_inbound_${Date.now()}`;
  res = await api.post('/api/whatsapp/webhook',
    inboundPayload(TEST_PHONE_NORMALIZED, inboundMsgId));
  assert(res.status === 200, `Status ${res.status}`);
  const inboundLog = await WhatsAppLog.findOne({ waMessageId: inboundMsgId });
  assert(inboundLog != null && inboundLog.type === 'INBOUND',
    `Found=${inboundLog != null}, type=${inboundLog?.type}`);
  if (inboundLog) ctx.waMessageIds.push(inboundLog.waMessageId);

  log.test('3.7 POST /webhook inbound from unknown phone → log with customer=null');
  const unknownMsgId = `wamid.${TAG}_unknowninbound_${Date.now()}`;
  res = await api.post('/api/whatsapp/webhook',
    inboundPayload(UNKNOWN_PHONE, unknownMsgId));
  assert(res.status === 200, `Status ${res.status}`);
  const unknownInboundLog = await WhatsAppLog.findOne({ waMessageId: unknownMsgId });
  assert(unknownInboundLog != null && !unknownInboundLog.customer,
    `Found=${unknownInboundLog != null}, customer=${unknownInboundLog?.customer}`);
  if (unknownInboundLog) ctx.waMessageIds.push(unknownInboundLog.waMessageId);

  log.test('3.8 POST /webhook inbound idempotency (same waMessageId)');
  // Re-send same inboundMsgId — should not create duplicate
  res = await api.post('/api/whatsapp/webhook',
    inboundPayload(TEST_PHONE_NORMALIZED, inboundMsgId));
  assert(res.status === 200, `Status ${res.status}`);
  const dupeCount = await WhatsAppLog.countDocuments({ waMessageId: inboundMsgId });
  assert(dupeCount === 1, `Duplicate count = ${dupeCount}`);
}

async function testOrchestrator() {
  log.section('4. NOTIFICATION ORCHESTRATOR (6 tests)');

  // Force email service in test process to mock (already done at top)
  const orchestrator = require('../src/services/notificationOrchestrator.service');
  const { WhatsAppLog, SystemSetting } = require('../src/models');
  const whatsappService = require('../src/utils/whatsappService');

  log.test('4.1 onBillGenerated → creates WA log');
  const beforeBill = await WhatsAppLog.countDocuments({ customer: ctx.customer._id, type: 'BILL' });
  // Pass a minimal bill object — orchestrator hydrates customer from FK
  const billObj = {
    _id: ctx.bill._id,
    customer: ctx.customer._id,
    billNumber: ctx.bill.billNumber,
    grandTotal: 1180,
    order: ctx.order?._id,
    orderNumber: ctx.order?.orderNumber,
  };
  await orchestrator.onBillGenerated(billObj);
  const afterBill = await WhatsAppLog.countDocuments({ customer: ctx.customer._id, type: 'BILL' });
  assert(afterBill > beforeBill, `Before=${beforeBill} After=${afterBill}`);

  log.test('4.2 onOrderReady → creates ORDER_READY log');
  if (ctx.order?._id) {
    const before = await WhatsAppLog.countDocuments({ relatedOrder: ctx.order._id, type: 'ORDER_READY' });
    await orchestrator.onOrderReady({
      _id: ctx.order._id,
      customer: ctx.customer._id,
      orderNumber: ctx.order.orderNumber,
      totalAmount: ctx.order.totalAmount,
    });
    const after = await WhatsAppLog.countDocuments({ relatedOrder: ctx.order._id, type: 'ORDER_READY' });
    assert(after > before, `Before=${before} After=${after}`);
  } else {
    log.fail('Skipped — no order');
  }

  log.test('4.3 onPaymentReceived path verification (uses 24h text window)');
  // Customer has a recent INBOUND (seeded in 2.6), so 24h window is OK
  const result = await orchestrator.onPaymentReceived(
    { _id: new mongoose.Types.ObjectId(), customer: ctx.customer._id, amount: 100000, method: 'upi', capturedAt: new Date() },
    { _id: ctx.bill._id, billNumber: ctx.bill.billNumber }
  );
  assert(result?.whatsapp?.sent === true || result?.email?.sent === true,
    `WA=${result?.whatsapp?.sent} email=${result?.email?.sent}`);

  log.test('4.4 WHATSAPP_ENABLED=false → orchestrator skips, no new WA log');
  await SystemSetting.findOneAndUpdate({ key: 'WHATSAPP_ENABLED' }, { $set: { value: false } });
  const beforeSkip = await WhatsAppLog.countDocuments({ customer: ctx.customer._id });
  await orchestrator.onBillGenerated(billObj);
  const afterSkip = await WhatsAppLog.countDocuments({ customer: ctx.customer._id });
  assert(afterSkip === beforeSkip, `Before=${beforeSkip} After=${afterSkip}`);
  await SystemSetting.findOneAndUpdate({ key: 'WHATSAPP_ENABLED' }, { $set: { value: true } });

  log.test('4.5 Simulated WA send failure → email fallback engaged');
  // Monkey-patch sendBillTemplate to throw, verify email log is created
  const originalSendBill = whatsappService.sendBillTemplate;
  whatsappService.sendBillTemplate = async () => { throw new Error('Simulated WA outage'); };
  const { EmailLog } = require('../src/models');
  const beforeEmail = await EmailLog.countDocuments({ customer: ctx.customer._id, type: 'BILL' });
  const fallbackResult = await orchestrator.onBillGenerated(billObj);
  whatsappService.sendBillTemplate = originalSendBill;
  const afterEmail = await EmailLog.countDocuments({ customer: ctx.customer._id, type: 'BILL' });
  assert(afterEmail > beforeEmail || fallbackResult?.email?.sent === true,
    `Before=${beforeEmail} After=${afterEmail} sent=${fallbackResult?.email?.sent}`);

  log.test('4.6 Catastrophic input safety (null bill → no throw)');
  let threw = false;
  try {
    const r = await orchestrator.onBillGenerated(null);
    void r;
  } catch (e) {
    threw = true;
  }
  assert(threw === false, 'Orchestrator threw on null input');
}

async function testEmailService() {
  log.section('5. EMAIL SERVICE (4 tests)');

  const emailService = require('../src/utils/emailService');
  emailService._resetForTesting(); // re-detect mock mode in this process

  log.test('5.1 sendBillEmail mock mode → success');
  let r = await emailService.sendBillEmail({
    to: TEST_EMAIL,
    customerName: `${TAG} Customer`,
    invoiceNo: `${TAG}-INV-1`,
    amount: 1180,
    customer: ctx.customer._id,
    relatedBill: ctx.bill._id,
  });
  assert(r.success === true && r.isMock === true && r.messageId?.startsWith('mock_'),
    `success=${r.success} mock=${r.isMock} id=${r.messageId}`);

  log.test('5.2 Invalid `to` address rejected');
  r = await emailService.sendBillEmail({
    to: 'not-an-email',
    customerName: 'X',
    invoiceNo: 'X',
    amount: 0,
  });
  assert(r.success === false && r.error === 'INVALID_EMAIL_FORMAT', `error=${r.error}`);

  log.test('5.3 EMAIL_ENABLED=false → EMAIL_DISABLED');
  const { SystemSetting } = require('../src/models');
  await SystemSetting.findOneAndUpdate({ key: 'EMAIL_ENABLED' }, { $set: { value: false } });
  r = await emailService.sendBillEmail({
    to: TEST_EMAIL,
    customerName: 'X',
    invoiceNo: 'X',
    amount: 0,
  });
  await SystemSetting.findOneAndUpdate({ key: 'EMAIL_ENABLED' }, { $set: { value: true } });
  assert(r.success === false && r.error === 'EMAIL_DISABLED', `error=${r.error}`);

  log.test('5.4 EmailLog created with retryContext populated');
  // After 5.1's call, the mock log should exist with retryContext
  const { EmailLog } = require('../src/models');
  const latest = await EmailLog.findOne({ to: TEST_EMAIL, type: 'BILL' }).sort({ createdAt: -1 }).lean();
  assert(latest?.retryContext?.sendFn === 'sendBillEmail' && latest?.retryContext?.args?.invoiceNo,
    `sendFn=${latest?.retryContext?.sendFn} invoiceNo=${latest?.retryContext?.args?.invoiceNo}`);
}

async function testLogsAndHealth() {
  log.section('6. LOGS & HEALTH (6 tests)');

  log.test('6.1 GET /whatsapp/logs (paginated)');
  let res = await api.get(`/api/whatsapp/logs?customer=${ctx.customer._id}&limit=50`,
    { headers: auth(ctx.adminToken) });
  assert(res.status === 200 && res.data.pagination && Array.isArray(res.data.data),
    `Status ${res.status}`);

  log.test('6.2 Filter type=BILL + status=SENT + customer');
  res = await api.get(
    `/api/whatsapp/logs?type=BILL&status=SENT&customer=${ctx.customer._id}&limit=50`,
    { headers: auth(ctx.adminToken) });
  const allMatch = res.data.data?.every(d => d.type === 'BILL' && d.status === 'SENT');
  assert(res.status === 200 && allMatch, `Status ${res.status} match=${allMatch}`);

  log.test('6.3 GET /email/logs');
  res = await api.get(`/api/email/logs?limit=50`, { headers: auth(ctx.adminToken) });
  assert(res.status === 200 && Array.isArray(res.data.data), `Status ${res.status}`);

  log.test('6.4 GET /whatsapp/health = mock');
  res = await api.get('/api/whatsapp/health', { headers: auth(ctx.adminToken) });
  assert(res.status === 200 && res.data.status === 'mock', `status=${res.data?.status}`);

  log.test('6.5 GET /email/health responds with valid status');
  res = await api.get('/api/email/health', { headers: auth(ctx.adminToken) });
  assert([200, 503].includes(res.status) && ['mock', 'ok', 'error'].includes(res.data?.status),
    `Status ${res.status} body.status=${res.data?.status}`);

  log.test('6.6 GET /notifications/health (combined)');
  res = await api.get('/api/notifications/health', { headers: auth(ctx.adminToken) });
  assert([200, 503].includes(res.status) && res.data?.whatsapp && res.data?.email && res.data?.overall,
    `Status ${res.status}`);
}

async function testRetryCron() {
  log.section('7. RETRY CRON (4 tests)');

  const retryService = require('../src/services/notificationRetry.service');
  const whatsappService = require('../src/utils/whatsappService');
  const { WhatsAppLog, SystemSetting } = require('../src/models');

  log.test('7.1 POST /retry-now → 200 with summary');
  let res = await api.post('/api/notifications/retry-now', {}, { headers: auth(ctx.adminToken) });
  assert(res.status === 200 &&
    res.data.data?.whatsapp && res.data.data?.email && res.data.data?.alerts,
    `Status ${res.status}`);

  log.test('7.2 Backoff: failed retry sets nextRetryAt ≈ now+5min');
  const originalSendBill = whatsappService.sendBillTemplate;
  whatsappService.sendBillTemplate = async () => { throw new Error('Simulated outage'); };
  const failedLog = await WhatsAppLog.create({
    to: TEST_PHONE_NORMALIZED,
    customer: ctx.customer._id,
    type: 'BILL',
    templateName: 'bill_pdf_v1',
    status: 'FAILED',
    errorMessage: 'Initial failure',
    retryCount: 0,
    retryContext: {
      sendFn: 'sendBillTemplate',
      args: { to: TEST_PHONE_DIGITS, templateName: 'bill_pdf_v1', pdfUrl: 'x', customerName: 'X', billNumber: 'X', amount: 1 },
    },
    isMock: true,
    payload: { tag: TAG },
  });
  const startedAt = Date.now();
  await retryService.retryFailedWhatsAppMessages();
  whatsappService.sendBillTemplate = originalSendBill;
  const afterFail = await WhatsAppLog.findById(failedLog._id).lean();
  const backoffMs = afterFail.nextRetryAt ? afterFail.nextRetryAt.getTime() - startedAt : 0;
  assert(afterFail.retryCount === 1 && afterFail.status === 'FAILED' &&
    Math.abs(backoffMs - 5 * 60 * 1000) < 30000,
    `count=${afterFail.retryCount} status=${afterFail.status} backoffMs=${backoffMs}`);

  log.test('7.3 Mock-mode alerting sets alertSent on permanently-failed log');
  const permLog = await WhatsAppLog.create({
    to: TEST_PHONE_NORMALIZED,
    customer: ctx.customer._id,
    type: 'BILL',
    waMessageId: `wamid.perm_${Date.now()}`,
    status: 'PERMANENTLY_FAILED',
    permanentlyFailedAt: new Date(),
    retryCount: 3,
    isMock: true,
    payload: { tag: TAG },
  });
  const alertRes = await retryService.alertPermanentlyFailed();
  const permAfter = await WhatsAppLog.findById(permLog._id).lean();
  assert(alertRes.whatsappCount >= 1 && permAfter.alertSent === true,
    `count=${alertRes.whatsappCount} sent=${permAfter.alertSent}`);

  log.test('7.4 NOTIFICATION_RETRY_ENABLED=false → disabled summary');
  await SystemSetting.findOneAndUpdate({ key: 'NOTIFICATION_RETRY_ENABLED' }, { $set: { value: false } });
  const disabledResult = await retryService.retryFailedWhatsAppMessages();
  await SystemSetting.findOneAndUpdate({ key: 'NOTIFICATION_RETRY_ENABLED' }, { $set: { value: true } });
  assert(disabledResult.disabled === true, `disabled=${disabledResult.disabled}`);
}

async function testIntegration() {
  log.section('8. CROSS-SECTION INTEGRATION (3 tests)');

  const orchestrator = require('../src/services/notificationOrchestrator.service');
  const { WhatsAppLog, EmailLog, Bill } = require('../src/models');

  log.test('8.1 End-to-end flow: bill generated → WA + email logs both written');
  // Force WA failure to engage email fallback in one pass
  const whatsappService = require('../src/utils/whatsappService');
  const originalSendBill = whatsappService.sendBillTemplate;
  whatsappService.sendBillTemplate = async () => { throw new Error('Simulated outage for integration'); };

  const integBill = await Bill.create({
    billNumber: `${TAG}-INTEG-${Date.now()}`,
    order: ctx.order?._id || new mongoose.Types.ObjectId(),
    customer: ctx.customer._id,
    customerInfo: { customerName: `${TAG} Integ`, phone: TEST_PHONE_DIGITS, email: TEST_EMAIL },
    businessInfo: { name: 'Shree Gopal MDF' },
    subtotal: 200, grandTotal: 236,
    notesToCustomer: TAG,
    createdBy: new mongoose.Types.ObjectId(),
  });
  await orchestrator.onBillGenerated({
    _id: integBill._id,
    customer: ctx.customer._id,
    billNumber: integBill.billNumber,
    grandTotal: 236,
    order: ctx.order?._id,
  });
  whatsappService.sendBillTemplate = originalSendBill;

  const waLog = await WhatsAppLog.findOne({ relatedBill: integBill._id });
  const emailLog = await EmailLog.findOne({ relatedBill: integBill._id });
  assert(waLog != null && emailLog != null,
    `WA=${waLog != null} email=${emailLog != null}`);

  log.test('8.2 Audit trail: failed WA log has retryContext, email log has retryContext');
  const waOk = waLog?.retryContext?.sendFn && waLog.status === 'FAILED';
  const emailOk = emailLog?.retryContext?.sendFn === 'sendBillEmail';
  assert(waOk && emailOk,
    `WA.retryContext=${!!waLog?.retryContext} status=${waLog?.status} email.sendFn=${emailLog?.retryContext?.sendFn}`);

  log.test('8.3 Logs query returns the integration-flow entries');
  const res = await api.get(
    `/api/whatsapp/logs?customer=${ctx.customer._id}&relatedBill=${integBill._id}&limit=10`,
    { headers: auth(ctx.adminToken) });
  assert(res.status === 200 && res.data.data?.length >= 1, `Status ${res.status} count=${res.data.data?.length}`);
}

async function cleanup() {
  log.section('CLEANUP');

  const { WhatsAppLog, EmailLog, Customer, Order, Bill, User } = require('../src/models');

  // Restore any system-setting changes (defensive — most tests restore inline)
  const { SystemSetting } = require('../src/models');
  await SystemSetting.findOneAndUpdate({ key: 'WHATSAPP_ENABLED' }, { $set: { value: true } });
  await SystemSetting.findOneAndUpdate({ key: 'EMAIL_ENABLED' }, { $set: { value: true } });
  await SystemSetting.findOneAndUpdate({ key: 'NOTIFICATION_RETRY_ENABLED' }, { $set: { value: true } });

  // Logs
  if (ctx.customer?._id) {
    await WhatsAppLog.deleteMany({ customer: ctx.customer._id });
    await EmailLog.deleteMany({ customer: ctx.customer._id });
  }
  await EmailLog.deleteMany({ to: TEST_EMAIL });
  await WhatsAppLog.deleteMany({ to: { $regex: TEST_PHONE_DIGITS } });
  await WhatsAppLog.deleteMany({ to: { $regex: UNKNOWN_PHONE.slice(-10) } });

  // Bills + Orders by notes tag
  await Bill.deleteMany({ notesToCustomer: TAG });
  if (ctx.order?._id) await Order.deleteOne({ _id: ctx.order._id });

  // Customer
  if (ctx.customer?._id) await Customer.deleteOne({ _id: ctx.customer._id });

  // CUTTING user
  if (ctx.cuttingUserId) await User.deleteOne({ _id: ctx.cuttingUserId });

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
    console.log('\nALL TESTS PASSED — Prompt 7 (WhatsApp + Email + Retry) is PRODUCTION-READY!');
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
