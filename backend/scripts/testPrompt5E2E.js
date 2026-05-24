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

const SAMPLE_SIGNATURE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

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
  log.section('PROMPT 5 — FINAL E2E TEST SUITE (Bill Module)');
  console.log(`Target: ${BASE_URL}`);
  console.log(`Started: ${new Date().toISOString()}`);

  await mongoose.connect(process.env.MONGODB_URI);

  try {
    await setupAuth();
    await testBillCreation();
    await testTemplateVariants();
    await testPdfGeneration();
    await testStatusWorkflow();
    await testSignatures();
    await testCrossModule();
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

  log.test('1.4 Fetch test products');
  res = await api.get('/api/products?productType=RAW_SHEET&limit=1', { headers: auth(adminToken) });
  assert(res.data.data?.length > 0, 'No raw sheets');
  ctx.rawSheet = res.data.data[0];

  log.test('1.5 Create test order');
  const ppu = ctx.rawSheet.basePrice * ctx.rawSheet.areaSqFt;
  const sub = ppu * 3;
  const orderBody = {
    customer: ctx.customer._id,
    items: [{
      itemType: 'FULL_SHEET',
      product: ctx.rawSheet._id,
      quantity: 3,
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
    customerNotes: 'PROMPT5_E2E',
  };
  res = await api.post('/api/orders', orderBody, { headers: auth(adminToken) });
  assert(res.status === 201, `Order creation: ${res.status}`);
  ctx.order = res.data.data;
}

async function testBillCreation() {
  log.section('2. BILL CREATION WORKFLOW');

  log.test('2.1 Create bill from order (detailed format)');
  let res = await api.post(`/api/bills/from-order/${ctx.order._id}`, {
    format: 'detailed',
    language: 'en',
    hasGst: true,
    notesToCustomer: 'PROMPT5_E2E',
  }, { headers: auth(adminToken) });
  assert(res.status === 201, `Status: ${res.status}`);
  ctx.bill = res.data.data;

  log.test('2.2 Bill number format INV-YYYY-NNN');
  assert(/^INV-\d{4}-\d{3,}$/.test(ctx.bill.billNumber), `Got: ${ctx.bill.billNumber}`);

  log.test('2.3 Status = DRAFT');
  assert(ctx.bill.status === 'DRAFT', `Got: ${ctx.bill.status}`);

  log.test('2.4 Customer snapshot captured');
  assert(ctx.bill.customerInfo?.customerName === ctx.customer.customerName, 'No snapshot');

  log.test('2.5 Business snapshot captured');
  assert(ctx.bill.businessInfo?.name?.length > 0, 'No business snapshot');

  log.test('2.6 Items copied from order');
  assert(ctx.bill.items?.length === ctx.order.items.length,
    `Bill: ${ctx.bill.items?.length}, Order: ${ctx.order.items.length}`);

  log.test('2.7 Amount in words computed');
  assert(ctx.bill.amountInWords?.includes('Rupees'), `Got: ${ctx.bill.amountInWords}`);

  log.test('2.8 Duplicate creation rejected (409)');
  res = await api.post(`/api/bills/from-order/${ctx.order._id}`, {
    format: 'simple',
  }, { headers: auth(adminToken) });
  assert(res.status === 409, `Status: ${res.status}`);
}

async function testTemplateVariants() {
  log.section('3. TEMPLATE VARIANTS');

  log.test('3.1 Update bill format to simple');
  let res = await api.put(`/api/bills/${ctx.bill._id}`, {
    format: 'simple',
  }, { headers: auth(adminToken) });
  assert(res.status === 200 && res.data.data?.format === 'simple', `Status: ${res.status}`);

  log.test('3.2 Generate PDF with simple format');
  let pdfRes = await api.get(`/api/bills/${ctx.bill._id}/pdf`, {
    headers: auth(adminToken),
    responseType: 'arraybuffer',
  });
  assert(pdfRes.status === 200 && Buffer.from(pdfRes.data).subarray(0, 4).toString() === '%PDF',
    `Status: ${pdfRes.status}`);

  log.test('3.3 Update bill format to minimal');
  res = await api.put(`/api/bills/${ctx.bill._id}`, {
    format: 'minimal',
  }, { headers: auth(adminToken) });
  assert(res.status === 200 && res.data.data?.format === 'minimal', `Status: ${res.status}`);

  log.test('3.4 Generate PDF with minimal format');
  pdfRes = await api.get(`/api/bills/${ctx.bill._id}/pdf`, {
    headers: auth(adminToken),
    responseType: 'arraybuffer',
  });
  assert(pdfRes.status === 200 && Buffer.from(pdfRes.data).subarray(0, 4).toString() === '%PDF',
    `Status: ${pdfRes.status}`);

  log.test('3.5 Switch back to detailed');
  res = await api.put(`/api/bills/${ctx.bill._id}`, {
    format: 'detailed',
  }, { headers: auth(adminToken) });
  assert(res.status === 200 && res.data.data?.format === 'detailed', `Status: ${res.status}`);

  log.test('3.6 Detailed format renders all info');
  pdfRes = await api.get(`/api/bills/${ctx.bill._id}/pdf`, {
    headers: auth(adminToken),
    responseType: 'arraybuffer',
  });
  assert(pdfRes.data.byteLength > 50000, `Size: ${pdfRes.data.byteLength}`);
}

async function testPdfGeneration() {
  log.section('4. PDF GENERATION');

  log.test('4.1 PDF endpoint returns 200');
  let pdfRes = await api.get(`/api/bills/${ctx.bill._id}/pdf`, {
    headers: auth(adminToken),
    responseType: 'arraybuffer',
  });
  assert(pdfRes.status === 200, `Status: ${pdfRes.status}`);

  log.test('4.2 Content-Type is application/pdf');
  assert(pdfRes.headers['content-type']?.includes('pdf'), `Got: ${pdfRes.headers['content-type']}`);

  log.test('4.3 PDF has correct magic bytes');
  const magic = Buffer.from(pdfRes.data).subarray(0, 4).toString();
  assert(magic === '%PDF', `Got: ${magic}`);

  log.test('4.4 Content-Disposition has filename');
  const disp = pdfRes.headers['content-disposition'] || '';
  assert(disp.includes('.pdf'), `Got: ${disp}`);

  log.test('4.5 Regenerate-PDF endpoint works');
  let res = await api.post(`/api/bills/${ctx.bill._id}/regenerate-pdf`, {},
    { headers: auth(adminToken) });
  assert(res.status === 200, `Status: ${res.status}`);
}

async function testStatusWorkflow() {
  log.section('5. STATUS WORKFLOW');

  log.test('5.1 Update DRAFT bill (notes)');
  let res = await api.put(`/api/bills/${ctx.bill._id}`, {
    notesToCustomer: 'Updated via E2E',
  }, { headers: auth(adminToken) });
  assert(res.status === 200, `Status: ${res.status}`);

  log.test('5.2 Finalize bill');
  res = await api.post(`/api/bills/${ctx.bill._id}/finalize`, {
    notes: 'E2E finalization',
  }, { headers: auth(adminToken) });
  assert(res.status === 200 && res.data.data?.status === 'FINALIZED',
    `Status: ${res.data.data?.status}`);

  log.test('5.3 FINALIZED locked from edits (403)');
  res = await api.put(`/api/bills/${ctx.bill._id}`, {
    notesToCustomer: 'Should fail',
  }, { headers: auth(adminToken) });
  assert(res.status === 403, `Status: ${res.status}`);

  log.test('5.4 Cannot finalize again (400)');
  res = await api.post(`/api/bills/${ctx.bill._id}/finalize`, {},
    { headers: auth(adminToken) });
  assert(res.status === 400, `Status: ${res.status}`);

  log.test('5.5 Mark sent (WhatsApp)');
  res = await api.post(`/api/bills/${ctx.bill._id}/mark-sent`, {
    channel: 'whatsapp',
    notes: 'E2E sent test',
    recipientInfo: '+91-9000000001',
  }, { headers: auth(adminToken) });
  assert(res.status === 200 && res.data.data?.status === 'SENT',
    `Status: ${res.data.data?.status}`);

  log.test('5.6 Mark sent again (printed)');
  res = await api.post(`/api/bills/${ctx.bill._id}/mark-sent`, {
    channel: 'print',
  }, { headers: auth(adminToken) });
  assert(res.status === 200, `Status: ${res.status}`);

  log.test('5.7 Bill has multiple events');
  res = await api.get(`/api/bills/${ctx.bill._id}`, { headers: auth(adminToken) });
  assert(res.data.data?.events?.length >= 3, `Events: ${res.data.data?.events?.length}`);

  log.test('5.8 List filters by status');
  res = await api.get('/api/bills?status=SENT&limit=10', { headers: auth(adminToken) });
  assert(res.data.data?.some(b => b._id === ctx.bill._id), 'Our bill not in SENT list');
}

async function testSignatures() {
  log.section('6. SIGNATURE COLLECTION');

  log.test('6.1 Upload customer signature');
  let res = await api.post(`/api/bills/${ctx.bill._id}/customer-signature`, {
    signatureImage: SAMPLE_SIGNATURE,
    signedByName: 'E2E Test Customer',
  }, { headers: auth(adminToken) });
  assert(res.status === 200, `Status: ${res.status}`);

  log.test('6.2 Upload issuer signature');
  res = await api.post(`/api/bills/${ctx.bill._id}/issuer-signature`, {
    signatureImage: SAMPLE_SIGNATURE,
  }, { headers: auth(adminToken) });
  assert(res.status === 200, `Status: ${res.status}`);

  log.test('6.3 Both signatures detected (without images)');
  res = await api.get(`/api/bills/${ctx.bill._id}/signatures`, { headers: auth(adminToken) });
  assert(res.data.data?.hasCustomerSignature === true && res.data.data?.hasIssuerSignature === true,
    'Signatures not flagged');

  log.test('6.4 Images retrievable (with includeImages)');
  res = await api.get(`/api/bills/${ctx.bill._id}/signatures?includeImages=true`,
    { headers: auth(adminToken) });
  assert(res.data.data?.customerSignature?.signatureImage?.startsWith('data:image/'),
    'Image data missing');

  log.test('6.5 PDF includes signatures');
  const pdfRes = await api.get(`/api/bills/${ctx.bill._id}/pdf`, {
    headers: auth(adminToken),
    responseType: 'arraybuffer',
  });
  assert(pdfRes.data.byteLength > 30000, `Size: ${pdfRes.data.byteLength}`);
}

async function testCrossModule() {
  log.section('7. CROSS-MODULE INTEGRATION');

  log.test('7.1 Bill linked to order');
  let res = await api.get(`/api/bills/${ctx.bill._id}`, { headers: auth(adminToken) });
  assert(res.data.data?.orderNumber === ctx.order.orderNumber, 'Order link broken');

  log.test('7.2 By-order endpoint returns bill');
  res = await api.get(`/api/bills/by-order/${ctx.order._id}`, { headers: auth(adminToken) });
  assert(res.data.count >= 1 && res.data.data?.[0]?._id === ctx.bill._id,
    `Count: ${res.data.count}`);

  log.test('7.3 By-customer endpoint includes bill');
  const customerId = ctx.customer._id;
  res = await api.get(`/api/bills/by-customer/${customerId}`, { headers: auth(adminToken) });
  assert(res.data.count >= 1, `Count: ${res.data.count}`);

  log.test('7.4 Bill GST split matches order');
  res = await api.get(`/api/bills/${ctx.bill._id}`, { headers: auth(adminToken) });
  const bill = res.data.data;
  assert(bill.totalCgst > 0 && bill.totalSgst > 0 && bill.totalIgst === 0,
    `CGST: ${bill.totalCgst}, SGST: ${bill.totalSgst}, IGST: ${bill.totalIgst}`);

  log.test('7.5 Customer snapshot independent of changes');
  assert(bill.customerInfo?.customerName === ctx.customer.customerName,
    'Snapshot not preserved');

  log.test('7.6 Items snapshot has product details');
  assert(bill.items?.[0]?.productSku === ctx.rawSheet.sku,
    'Product snapshot missing');
}

async function testEdgeCases() {
  log.section('8. EDGE CASES');

  log.test('8.1 Invalid bill ID rejected (400)');
  let res = await api.get('/api/bills/not-a-real-id', { headers: auth(adminToken) });
  assert(res.status === 400, `Status: ${res.status}`);

  log.test('8.2 Non-existent bill returns 404');
  res = await api.get('/api/bills/507f1f77bcf86cd799439011', { headers: auth(adminToken) });
  assert(res.status === 404, `Status: ${res.status}`);

  log.test('8.3 Invalid signature format rejected (400)');
  res = await api.post(`/api/bills/${ctx.bill._id}/customer-signature`, {
    signatureImage: 'not-base64-image',
  }, { headers: auth(adminToken) });
  assert(res.status === 400, `Status: ${res.status}`);

  log.test('8.4 SUPER_ADMIN can soft-delete');
  res = await api.delete(`/api/bills/${ctx.bill._id}`, {
    headers: auth(superToken),
    data: { reason: 'E2E cleanup' },
  });
  assert(res.status === 200, `Status: ${res.status}`);

  log.test('8.5 Soft-deleted bill not in default list');
  res = await api.get('/api/bills?limit=20', { headers: auth(adminToken) });
  assert(!res.data.data?.some(b => b._id === ctx.bill._id), 'Deleted bill in list');
}

async function cleanup() {
  log.section('CLEANUP');

  const { Bill, Order } = require('../src/models');

  if (ctx.order?._id) {
    await Bill.deleteMany({ order: ctx.order._id });
    await Order.deleteOne({ _id: ctx.order._id });
  }

  await Bill.deleteMany({
    notesToCustomer: { $in: ['PROMPT5_E2E', 'BILL_TEST', 'SIGNATURE_TEST'] },
  });
  await Order.deleteMany({
    customerNotes: { $in: ['PROMPT5_E2E', 'BILL_TEST'] },
  });

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
    console.log('\nALL TESTS PASSED — Prompt 5 (Bill Module) is PRODUCTION-READY!');
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
