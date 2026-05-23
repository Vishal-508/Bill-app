require('dotenv').config();

if (process.env.NODE_ENV !== 'production') {
  const dns = require('dns');
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
}

const axios = require('axios');
const mongoose = require('mongoose');

// ═══ Config ═══
const BASE_URL = process.env.API_URL || 'http://localhost:5000';
const ADMIN_EMAIL = 'testadmin@shreegopal.com';
const ADMIN_PASSWORD = 'TestAdmin@123';
const SUPER_EMAIL = process.env.SEED_ADMIN_EMAIL;
const SUPER_PASSWORD = process.env.SEED_ADMIN_PASSWORD;
const BYPASS_SECRET = process.env.TEST_BYPASS_SECRET;

if (!BYPASS_SECRET) {
  console.error('TEST_BYPASS_SECRET not set in .env');
  process.exit(1);
}

// ═══ Test state ═══
let passed = 0;
let failed = 0;
const failures = [];
let adminToken = null;
let superToken = null;
const ctx = {};

// ═══ HTTP client with bypass header ═══
const api = axios.create({
  baseURL: BASE_URL,
  headers: { 'x-test-bypass-ratelimit': BYPASS_SECRET },
  validateStatus: () => true,
});

// ═══ Helpers ═══
const log = {
  section: (title) => console.log(`\n${'═'.repeat(70)}\n${title}\n${'═'.repeat(70)}`),
  test: (name) => process.stdout.write(`  ${name.padEnd(60)} `),
  pass: () => { passed++; console.log('✅'); },
  fail: (reason) => {
    failed++;
    console.log('❌');
    console.log(`    └─ ${reason}`);
    failures.push(reason);
  },
};

const assert = (condition, failMsg) => {
  if (condition) log.pass();
  else log.fail(failMsg);
};

const authHeader = (token) => ({ Authorization: `Bearer ${token}` });

// ═══ Main test runner ═══
async function runAll() {
  log.section('🧪 PROMPT 3 — FINAL E2E TEST SUITE');
  console.log(`Target: ${BASE_URL}`);
  console.log(`Started: ${new Date().toISOString()}\n`);

  await mongoose.connect(process.env.MONGODB_URI);

  try {
    await testAuth();
    await testBusinessSegments();
    await testCustomers();
    await testProductGrades();
    await testProductAttributes();
    await testBundleSizes();
    await testShapeRates();
    await testCuttingRules();
    await testRawSheets();
    await testPreCutBundles();
    await testCrossModule();
  } finally {
    await mongoose.disconnect();
    printSummary();
  }
}

// ═══ 1. Auth Tests ═══
async function testAuth() {
  log.section('1️⃣  AUTHENTICATION & AUTHORIZATION (8 tests)');

  log.test('1.1 Admin login successful');
  let res = await api.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  assert(res.status === 200 && res.data.accessToken, `Got status ${res.status}: ${JSON.stringify(res.data)}`);
  adminToken = res.data.accessToken;

  log.test('1.2 Super-admin login successful');
  res = await api.post('/api/auth/login', { email: SUPER_EMAIL, password: SUPER_PASSWORD });
  assert(res.status === 200 && res.data.accessToken, `Status ${res.status}`);
  superToken = res.data.accessToken;

  log.test('1.3 GET /me returns ADMIN role');
  res = await api.get('/api/auth/me', { headers: authHeader(adminToken) });
  assert(res.status === 200 && res.data.user?.role === 'ADMIN', `Role: ${res.data.user?.role}`);

  log.test('1.4 Invalid token rejected with 401');
  res = await api.get('/api/auth/me', { headers: { Authorization: 'Bearer invalid.token.here' } });
  assert(res.status === 401, `Got ${res.status}`);

  log.test('1.5 Missing token rejected with 401');
  res = await api.get('/api/customers');
  assert(res.status === 401, `Got ${res.status}`);

  log.test('1.6 ADMIN can list customers');
  res = await api.get('/api/customers', { headers: authHeader(adminToken) });
  assert(res.status === 200, `Got ${res.status}`);

  log.test('1.7 ADMIN denied hard-delete (403)');
  res = await api.delete('/api/customers/507f1f77bcf86cd799439011/hard-delete', { headers: authHeader(adminToken) });
  assert(res.status === 403, `Got ${res.status}`);

  log.test('1.8 Wrong password returns 401');
  res = await api.post('/api/auth/login', { email: ADMIN_EMAIL, password: 'WrongPassword123' });
  assert(res.status === 401, `Got ${res.status}`);
}

// ═══ 2. Business Segments ═══
async function testBusinessSegments() {
  log.section('2️⃣  BUSINESS SEGMENTS (6 tests)');

  log.test('2.1 List all segments');
  let res = await api.get('/api/business-segments', { headers: authHeader(adminToken) });
  assert(res.status === 200 && res.data.data.length >= 15, `Count: ${res.data.data?.length}`);
  ctx.segments = res.data.data;
  ctx.photoStudioSegment = ctx.segments.find(s => s.code === 'PHOTO_STUDIO');

  log.test('2.2 PHOTO_STUDIO segment exists');
  assert(ctx.photoStudioSegment, 'Not found in seed data');

  log.test('2.3 Get segment by ID');
  res = await api.get(`/api/business-segments/${ctx.photoStudioSegment._id}`, { headers: authHeader(adminToken) });
  assert(res.status === 200 && res.data.data.code === 'PHOTO_STUDIO', `Code: ${res.data.data?.code}`);

  log.test('2.4 Create custom segment');
  res = await api.post('/api/business-segments', {
    code: 'TEST_SEGMENT_E2E',
    label: 'Test Segment for E2E',
    description: 'Should be deleted at end',
  }, { headers: authHeader(adminToken) });
  assert(res.status === 201, `Status ${res.status}`);
  ctx.tempSegmentId = res.data.data?._id;

  log.test('2.5 System-default segment delete blocked');
  res = await api.delete(`/api/business-segments/${ctx.photoStudioSegment._id}`, { headers: authHeader(adminToken) });
  assert(res.status === 403, `Got ${res.status}`);

  log.test('2.6 Custom segment can be deleted');
  res = await api.delete(`/api/business-segments/${ctx.tempSegmentId}`, { headers: authHeader(adminToken) });
  assert(res.status === 200, `Status ${res.status}`);
}

// ═══ 3. Customers ═══
async function testCustomers() {
  log.section('3️⃣  CUSTOMERS (15 tests)');

  log.test('3.1 List customers with pagination');
  let res = await api.get('/api/customers?page=1&limit=10', { headers: authHeader(adminToken) });
  assert(res.status === 200 && res.data.pagination?.totalRecords >= 15, `Total: ${res.data.pagination?.totalRecords}`);

  log.test('3.2 Text search by name');
  res = await api.get('/api/customers?search=Sharma', { headers: authHeader(adminToken) });
  assert(res.status === 200 && res.data.data.length >= 1, `Found: ${res.data.data?.length}`);

  log.test('3.3 Filter by segment code');
  res = await api.get('/api/customers?segmentCode=PHOTO_STUDIO', { headers: authHeader(adminToken) });
  assert(res.status === 200 && res.data.data.length >= 2, `Found: ${res.data.data?.length}`);

  log.test('3.4 Filter by tags');
  res = await api.get('/api/customers?tags=VIP', { headers: authHeader(adminToken) });
  assert(res.status === 200 && res.data.data.length >= 4, `Found: ${res.data.data?.length}`);

  log.test('3.5 Filter by hasGST=true');
  res = await api.get('/api/customers?hasGST=true', { headers: authHeader(adminToken) });
  assert(res.status === 200 && res.data.data.length >= 5, `Found: ${res.data.data?.length}`);

  log.test('3.6 Sort by lifetimeValue desc');
  res = await api.get('/api/customers?sort=-purchaseInsights.lifetimeValue&limit=3', { headers: authHeader(adminToken) });
  const lifetimes = res.data.data.map(c => c.purchaseInsights?.lifetimeValue || 0);
  assert(lifetimes[0] >= lifetimes[1] && lifetimes[1] >= lifetimes[2], `Sort order: ${lifetimes.join(',')}`);

  log.test('3.7 Create new customer');
  res = await api.post('/api/customers', {
    customerName: 'E2E Test Customer',
    phone: '9999000001',
    businessSegment: ctx.photoStudioSegment._id,
    billingAddress: {
      addressLine1: 'Test Address',
      city: 'Indore',
      state: 'Madhya Pradesh',
      pincode: '452001',
    },
  }, { headers: authHeader(adminToken) });
  assert(res.status === 201, `Status ${res.status}: ${JSON.stringify(res.data).substring(0,200)}`);
  ctx.testCustomerId = res.data.data?._id;

  log.test('3.8 Duplicate phone rejected');
  res = await api.post('/api/customers', {
    customerName: 'Duplicate',
    phone: '9999000001',
    businessSegment: ctx.photoStudioSegment._id,
    billingAddress: { addressLine1: 'X', city: 'X', state: 'Madhya Pradesh', pincode: '452001' },
  }, { headers: authHeader(adminToken) });
  assert(res.status === 409, `Got ${res.status}`);

  log.test('3.9 Update customer');
  res = await api.put(`/api/customers/${ctx.testCustomerId}`, {
    creditLimit: 50000,
    notes: 'E2E test update',
  }, { headers: authHeader(adminToken) });
  assert(res.status === 200 && res.data.data?.creditLimit === 50000, `Credit: ${res.data.data?.creditLimit}`);

  log.test('3.10 Bulk add tag');
  res = await api.post('/api/customers/bulk-add-tag', {
    customerIds: [ctx.testCustomerId],
    tag: 'E2E-Test',
  }, { headers: authHeader(adminToken) });
  assert(res.status === 200 && res.data.data?.modified === 1, `Modified: ${res.data.data?.modified}`);

  log.test('3.11 Analytics summary');
  res = await api.get('/api/customers/analytics/summary', { headers: authHeader(adminToken) });
  assert(res.status === 200 && res.data.data?.counts?.total >= 15, `Total: ${res.data.data?.counts?.total}`);

  log.test('3.12 Analytics by segment');
  res = await api.get('/api/customers/analytics/by-segment', { headers: authHeader(adminToken) });
  assert(res.status === 200 && Array.isArray(res.data.data) && res.data.data.length >= 5, `Segments: ${res.data.data?.length}`);

  log.test('3.13 Top customers');
  res = await api.get('/api/customers/analytics/top-customers?limit=5', { headers: authHeader(adminToken) });
  assert(res.status === 200 && res.data.data.length === 5, `Got: ${res.data.data?.length}`);

  log.test('3.14 CSV export');
  res = await api.get('/api/customers/export/csv', { headers: authHeader(adminToken) });
  assert(res.status === 200 && typeof res.data === 'string' && res.data.includes('Customer Name'), `Type: ${typeof res.data}`);

  log.test('3.15 Soft delete test customer');
  res = await api.delete(`/api/customers/${ctx.testCustomerId}`, {
    headers: authHeader(adminToken),
    data: { reason: 'E2E cleanup' },
  });
  assert(res.status === 200, `Got ${res.status}`);
}

// ═══ 4. Product Grades ═══
async function testProductGrades() {
  log.section('4️⃣  PRODUCT GRADES (4 tests)');

  log.test('4.1 List active grades');
  let res = await api.get('/api/product-grades', { headers: authHeader(adminToken) });
  assert(res.status === 200 && res.data.data.length >= 6, `Got: ${res.data.data?.length}`);
  ctx.grades = res.data.data;
  ctx.interiorGrade = ctx.grades.find(g => g.code === 'INTERIOR');
  ctx.mrGrade = ctx.grades.find(g => g.code === 'MR');

  log.test('4.2 INTERIOR and MR grades exist');
  assert(ctx.interiorGrade && ctx.mrGrade, 'One or both missing');

  log.test('4.3 System-default grade delete blocked');
  res = await api.delete(`/api/product-grades/${ctx.interiorGrade._id}`, { headers: authHeader(adminToken) });
  assert(res.status === 403, `Got ${res.status}`);

  log.test('4.4 Get grade by ID');
  res = await api.get(`/api/product-grades/${ctx.interiorGrade._id}`, { headers: authHeader(adminToken) });
  assert(res.status === 200 && res.data.data?.code === 'INTERIOR', `Code: ${res.data.data?.code}`);
}

// ═══ 5. Product Attributes ═══
async function testProductAttributes() {
  log.section('5️⃣  PRODUCT ATTRIBUTES (4 tests)');

  log.test('5.1 List attributes');
  let res = await api.get('/api/product-attributes', { headers: authHeader(adminToken) });
  assert(res.status === 200 && res.data.data.length >= 8, `Count: ${res.data.data?.length}`);

  log.test('5.2 Color attribute is enum type');
  const color = res.data.data.find(a => a.name === 'color');
  assert(color && color.type === 'enum' && color.options?.length > 0, `Color: ${JSON.stringify(color)}`);

  log.test('5.3 Create custom attribute');
  res = await api.post('/api/product-attributes', {
    name: 'e2e-test-attr',
    label: 'E2E Test Attribute',
    type: 'string',
  }, { headers: authHeader(adminToken) });
  assert(res.status === 201, `Got ${res.status}: ${JSON.stringify(res.data).substring(0,200)}`);
  ctx.tempAttrId = res.data.data?._id;

  log.test('5.4 Delete custom attribute');
  res = await api.delete(`/api/product-attributes/${ctx.tempAttrId}`, { headers: authHeader(adminToken) });
  assert(res.status === 200, `Got ${res.status}`);
}

// ═══ 6. Bundle Sizes ═══
async function testBundleSizes() {
  log.section('6️⃣  STANDARD BUNDLE SIZES (3 tests)');

  log.test('6.1 List bundle sizes via direct DB');
  const { StandardBundleSize } = require('../src/models');
  const sizes = await StandardBundleSize.find({ isActive: true });
  assert(sizes.length >= 20, `Count: ${sizes.length}`);
  ctx.bundleSizes = sizes;

  log.test('6.2 18×36 inch size exists');
  const size18x36 = sizes.find(s => s.lengthInches === 18 && s.widthInches === 36);
  assert(size18x36, 'Not found');

  log.test('6.3 Size has auto-computed area');
  assert(size18x36 && Math.abs(size18x36.areaSqInches - 648) < 1, `Area: ${size18x36?.areaSqInches}`);
}

// ═══ 7. Shape Rates ═══
async function testShapeRates() {
  log.section('7️⃣  SHAPE CUTTING RATES (3 tests)');

  const { ShapeCuttingRate } = require('../src/models');

  log.test('7.1 4 default shapes exist');
  const shapes = await ShapeCuttingRate.find();
  assert(shapes.length >= 4, `Count: ${shapes.length}`);

  log.test('7.2 RECTANGLE has multiplier 1.0');
  const rect = shapes.find(s => s.code === 'RECTANGLE');
  assert(rect && rect.baseMultiplier === 1.0, `Multiplier: ${rect?.baseMultiplier}`);

  log.test('7.3 ROUND has multiplier 2.5');
  const round = shapes.find(s => s.code === 'ROUND');
  assert(round && round.baseMultiplier === 2.5, `Multiplier: ${round?.baseMultiplier}`);
}

// ═══ 8. Cutting Rules ═══
async function testCuttingRules() {
  log.section('8️⃣  CUTTING CHARGE RULES (3 tests)');

  const { CuttingChargeRule } = require('../src/models');

  log.test('8.1 5 default rules exist');
  const rules = await CuttingChargeRule.find();
  assert(rules.length >= 5, `Count: ${rules.length}`);

  log.test('8.2 Default rule is per-piece');
  const defaultRule = rules.find(r => r.isDefault);
  assert(defaultRule && defaultRule.mode === 'per-piece', `Default: ${defaultRule?.code} mode: ${defaultRule?.mode}`);

  log.test('8.3 INCLUDED rule has zero rate');
  const included = rules.find(r => r.code === 'INCLUDED');
  assert(included && included.mode === 'included' && included.perPieceRate === 0, `Rate: ${included?.perPieceRate}`);
}

// ═══ 9. Raw Sheets ═══
async function testRawSheets() {
  log.section('9️⃣  RAW SHEET PRODUCTS (10 tests)');

  log.test('9.1 List all raw sheets');
  let res = await api.get('/api/products?productType=RAW_SHEET&limit=50', { headers: authHeader(adminToken) });
  assert(res.status === 200 && res.data.pagination?.totalRecords >= 14, `Total: ${res.data.pagination?.totalRecords}`);
  ctx.rawSheets = res.data.data;

  log.test('9.2 Filter 18mm thickness');
  res = await api.get('/api/products?productType=RAW_SHEET&thicknessMM=18', { headers: authHeader(adminToken) });
  assert(res.status === 200 && res.data.pagination?.totalRecords >= 5, `Got: ${res.data.pagination?.totalRecords}`);

  log.test('9.3 Filter by grade code INTERIOR');
  res = await api.get('/api/products?productType=RAW_SHEET&gradeCode=INTERIOR', { headers: authHeader(adminToken) });
  assert(res.status === 200 && res.data.pagination?.totalRecords >= 7, `Got: ${res.data.pagination?.totalRecords}`);

  log.test('9.4 Filter by brand Greenply');
  res = await api.get('/api/products?productType=RAW_SHEET&brand=Greenply', { headers: authHeader(adminToken) });
  assert(res.status === 200 && res.data.pagination?.totalRecords >= 6, `Got: ${res.data.pagination?.totalRecords}`);

  log.test('9.5 Get single product details');
  const sample = ctx.rawSheets[0];
  res = await api.get(`/api/products/${sample._id}`, { headers: authHeader(adminToken) });
  assert(res.status === 200 && res.data.data?.sku === sample.sku, `SKU: ${res.data.data?.sku}`);

  log.test('9.6 Price calculation 100 units');
  res = await api.post(`/api/products/${sample._id}/calculate-price`, { quantity: 100 }, { headers: authHeader(adminToken) });
  assert(res.status === 200 && res.data.data?.calculation?.finalPrice > 0, `Price: ${res.data.data?.calculation?.finalPrice}`);

  log.test('9.7 Stock adjustment (deduct)');
  res = await api.post(`/api/products/${sample._id}/adjust-stock`, { delta: -5, reason: 'E2E test deduction' }, { headers: authHeader(adminToken) });
  assert(res.status === 200 && res.data.data?.delta === -5, `Delta: ${res.data.data?.delta}`);

  log.test('9.8 Restock');
  res = await api.post(`/api/products/${sample._id}/adjust-stock`, { delta: 5, reason: 'E2E restock' }, { headers: authHeader(adminToken) });
  assert(res.status === 200, `Got ${res.status}`);

  log.test('9.9 Update price via dedicated endpoint');
  const oldPrice = sample.basePrice;
  const newPrice = oldPrice + 5;
  res = await api.post(`/api/products/${sample._id}/update-price`, { newPrice, reason: 'E2E test' }, { headers: authHeader(adminToken) });
  assert(res.status === 200 && res.data.data?.newPrice === newPrice, `New price: ${res.data.data?.newPrice}`);

  log.test('9.10 Revert price');
  res = await api.post(`/api/products/${sample._id}/update-price`, { newPrice: oldPrice, reason: 'E2E revert' }, { headers: authHeader(adminToken) });
  assert(res.status === 200, `Got ${res.status}`);
}

// ═══ 10. Pre-Cut Bundles ═══
async function testPreCutBundles() {
  log.section('🔟 PRE-CUT BUNDLE PRODUCTS (8 tests)');

  log.test('10.1 List all bundles');
  let res = await api.get('/api/products?productType=PRE_CUT_BUNDLE&limit=50', { headers: authHeader(adminToken) });
  assert(res.status === 200 && res.data.pagination?.totalRecords >= 11, `Total: ${res.data.pagination?.totalRecords}`);
  ctx.bundles = res.data.data;

  log.test('10.2 Bundle has bundle subdocument');
  const sample = ctx.bundles[0];
  assert(sample.bundle && sample.bundle.piecesPerBundle > 0, `Bundle: ${JSON.stringify(sample.bundle).substring(0,100)}`);

  log.test('10.3 Bundle has standardSize reference');
  assert(sample.bundle.standardSize, `Missing standardSize`);

  log.test('10.4 Bundle has fromRawSheetType reference');
  assert(sample.bundle.fromRawSheetType, `Missing fromRawSheetType`);

  log.test('10.5 MR grade bundles exist');
  res = await api.get('/api/products?productType=PRE_CUT_BUNDLE&gradeCode=MR', { headers: authHeader(adminToken) });
  assert(res.status === 200 && res.data.pagination?.totalRecords >= 2, `MR bundles: ${res.data.pagination?.totalRecords}`);

  log.test('10.6 Bundle pricing modes set');
  const withPricing = ctx.bundles.filter(b => b.bundle?.pricePerBundle > 0 && b.bundle?.pricePerPiece > 0);
  assert(withPricing.length >= 5, `With pricing: ${withPricing.length}`);

  log.test('10.7 Bundle stock tracking');
  const withStock = ctx.bundles.filter(b => b.bundle?.currentBundles > 0);
  assert(withStock.length >= 5, `With stock: ${withStock.length}`);

  log.test('10.8 Get bundle details with population');
  res = await api.get(`/api/products/${sample._id}`, { headers: authHeader(adminToken) });
  assert(res.status === 200 && res.data.data?.bundle?.standardSize, `Got: ${JSON.stringify(res.data.data?.bundle).substring(0,100)}`);
}

// ═══ 11. Cross-Module ═══
async function testCrossModule() {
  log.section('1️⃣1️⃣ CROSS-MODULE INTEGRATION (6 tests)');

  log.test('11.1 Inventory value analytics');
  let res = await api.get('/api/products/analytics/inventory-value', { headers: authHeader(adminToken) });
  assert(res.status === 200 && res.data.data?.totals?.totalInventoryValueRs > 1000000, `Value: ${res.data.data?.totals?.totalInventoryValueRs}`);

  log.test('11.2 Analytics by grade');
  res = await api.get('/api/products/analytics/by-grade', { headers: authHeader(adminToken) });
  assert(res.status === 200 && res.data.data.length >= 3, `Grades: ${res.data.data?.length}`);

  log.test('11.3 Low stock products query');
  res = await api.get('/api/products/low-stock', { headers: authHeader(adminToken) });
  assert(res.status === 200, `Got ${res.status}`);

  log.test('11.4 Customer analytics by source');
  res = await api.get('/api/customers/analytics/by-source', { headers: authHeader(adminToken) });
  assert(res.status === 200 && res.data.data.length >= 5, `Sources: ${res.data.data?.length}`);

  log.test('11.5 Multi-filter customer query');
  res = await api.get('/api/customers?segmentCode=PHOTO_STUDIO&hasDues=false&sort=customerName', { headers: authHeader(adminToken) });
  assert(res.status === 200, `Got ${res.status}`);

  log.test('11.6 Field selection works');
  res = await api.get('/api/customers?fields=customerName,phone&limit=3', { headers: authHeader(adminToken) });
  assert(res.status === 200 && res.data.data[0].customerName && !res.data.data[0].purchaseInsights, `Got: ${JSON.stringify(res.data.data[0]).substring(0,100)}`);
}

// ═══ Final Summary ═══
function printSummary() {
  const total = passed + failed;
  const pct = total > 0 ? ((passed / total) * 100).toFixed(1) : 0;

  log.section('📊 FINAL SUMMARY');
  console.log(`Total tests:    ${total}`);
  console.log(`Passed:         ${passed} ✅`);
  console.log(`Failed:         ${failed} ${failed > 0 ? '❌' : ''}`);
  console.log(`Pass rate:      ${pct}%`);
  console.log(`Completed:      ${new Date().toISOString()}`);

  if (failures.length > 0) {
    console.log('\nFailure details:');
    failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
  }

  if (failed === 0) {
    console.log('\n🎉 ALL TESTS PASSED — Prompt 3 is PRODUCTION-READY!');
  } else {
    console.log(`\n⚠️  ${failed} test(s) failed. Review above for details.`);
  }

  process.exit(failed === 0 ? 0 : 1);
}

runAll().catch(err => {
  console.error('\n💥 Test runner crashed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
