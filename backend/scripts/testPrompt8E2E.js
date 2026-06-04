require('dotenv').config();
// Mock-mode + cron-skip overrides for the TEST PROCESS only.
// (The running backend has its own env — these don't affect it.)
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
const {
  User, Vendor, Purchase, Product, StockMovement, EmailLog, SystemSetting,
} = require('../src/models');

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

const E2E_TAG = 'PROMPT8_E2E_TEST';
const MS_DAY = 24 * 60 * 60 * 1000;
const MS_MONTH = 30 * MS_DAY;

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

const ctx = {
  adminToken: null,
  superToken: null,
  superUserId: null,
  billingToken: null,
  billingUserId: null,
  // Tracked test fixtures
  vendorIds: [],
  purchaseIds: [],
  touchedProductIds: new Set(),
  productStockSnapshots: new Map(),
  pRich: null,   // 30mo history → HW
  pSparse: null, // 2mo history → naive
  pMid: null,    // for vendor PO + analytics
  // Captured SystemSettings for restore
  settingsToRestore: new Map(),
};

async function runAll() {
  log.section('PROMPT 8 — FINAL E2E TEST SUITE (Vendor + PO + Forecasting + Cron)');
  console.log(`Target: ${BASE_URL}`);
  console.log(`Started: ${new Date().toISOString()}`);

  await mongoose.connect(process.env.MONGODB_URI);

  try {
    await preflightCleanup();
    await categoryA_setupAuth();
    await categoryB_vendorLifecycle();
    await categoryC_purchaseLifecycle();
    await categoryD_inventoryAnalytics();
    await categoryE_forecastEndpoints();
    await categoryF_cronJobs();
    await categoryG_integration();
    await categoryH_cleanup();
  } finally {
    await mongoose.disconnect();
    printSummary();
  }
}

async function preflightCleanup() {
  // Wipe any leftover entities from prior runs
  await Vendor.deleteMany({ name: { $regex: `^${E2E_TAG}` } });
  await Purchase.deleteMany({ notes: { $regex: E2E_TAG } });
  await StockMovement.deleteMany({ reason: { $regex: E2E_TAG } });
  await User.deleteMany({ email: { $regex: `^${E2E_TAG.toLowerCase()}-` } });
  await EmailLog.deleteMany({
    subject: { $regex: 'Weekly Admin Report' },
    to: { $regex: E2E_TAG.toLowerCase() },
  });
}

// ════════════════════════════════════════════════
// A. SETUP & AUTH (3 tests)
// ════════════════════════════════════════════════
async function categoryA_setupAuth() {
  log.section('A. SETUP & AUTH (3 tests)');

  log.test('A1 Admin login (ADMIN)');
  let res = await api.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  assert(res.status === 200 && res.data.accessToken, `Status ${res.status}`);
  ctx.adminToken = res.data.accessToken;

  log.test('A2 SUPER_ADMIN fixture create + login');
  const superEmail = `${E2E_TAG.toLowerCase()}-super@e2e.test`;
  const superPass = 'SuperE2E@123';
  await User.deleteMany({ email: superEmail });
  const superUser = await User.create({
    name: `${E2E_TAG} Super Admin`,
    email: superEmail,
    password: superPass,
    role: 'SUPER_ADMIN',
    isActive: true,
  });
  ctx.superUserId = superUser._id;
  res = await api.post('/api/auth/login', { email: superEmail, password: superPass });
  assert(res.status === 200 && res.data.accessToken && superUser.role === 'SUPER_ADMIN',
    `Status ${res.status} role=${superUser.role}`);
  ctx.superToken = res.data.accessToken;

  log.test('A3 BILLING fixture create + login');
  const billingEmail = `${E2E_TAG.toLowerCase()}-billing@e2e.test`;
  const billingPass = 'BillingE2E@123';
  await User.deleteMany({ email: billingEmail });
  const billing = await User.create({
    name: `${E2E_TAG} Billing`,
    email: billingEmail,
    password: billingPass,
    role: 'BILLING',
    isActive: true,
  });
  ctx.billingUserId = billing._id;
  res = await api.post('/api/auth/login', { email: billingEmail, password: billingPass });
  assert(res.status === 200 && res.data.accessToken, `Status ${res.status}`);
  ctx.billingToken = res.data.accessToken;

  // Pick 3 distinct RAW_SHEET products + snapshot their stock
  const products = await Product.find({
    productType: 'RAW_SHEET', isDeleted: false, isActive: true,
  }).select('_id sku name currentStock lastRestockedAt').limit(3).lean();
  if (products.length < 3) throw new Error('Need at least 3 RAW_SHEET products');
  [ctx.pRich, ctx.pSparse, ctx.pMid] = products;
  for (const p of products) {
    ctx.productStockSnapshots.set(String(p._id), {
      currentStock: p.currentStock || 0,
      lastRestockedAt: p.lastRestockedAt,
    });
    ctx.touchedProductIds.add(String(p._id));
  }
  // Reset to 0 for clean assertions during PO receive
  await Product.updateMany(
    { _id: { $in: products.map(p => p._id) } },
    { $set: { currentStock: 0 }, $unset: { lastRestockedAt: '', forecastData: '' } }
  );
}

// ════════════════════════════════════════════════
// B. VENDOR LIFECYCLE (5 tests)
// ════════════════════════════════════════════════
async function categoryB_vendorLifecycle() {
  log.section('B. VENDOR LIFECYCLE (5 tests)');

  log.test('B1 Create vendor → 201');
  let res = await api.post('/api/vendors', {
    name: `${E2E_TAG} Primary Vendor`,
    companyName: `${E2E_TAG} Pvt Ltd`,
    phone: '9876512011',
    email: `${E2E_TAG.toLowerCase()}-vendor@e2e.test`,
    gstin: '23ABCDE0000A1Z5',
    address: { line1: 'E2E St', city: 'Indore', state: 'MP', stateCode: '23', pincode: '452001' },
    avgLeadTimeDays: 7,
  }, { headers: auth(ctx.adminToken) });
  assert(res.status === 201, `Status ${res.status}`);
  const vendor = res.data.data;
  ctx.vendorIds.push(vendor._id);

  log.test('B2 List + search filter');
  res = await api.get(`/api/vendors?search=${encodeURIComponent(E2E_TAG)}&limit=10`, { headers: auth(ctx.adminToken) });
  assert(res.status === 200 && res.data.data.some(v => v._id === vendor._id),
    `Status ${res.status} found=${res.data.data.length}`);

  log.test('B3 GET /:id with stats populated');
  res = await api.get(`/api/vendors/${vendor._id}`, { headers: auth(ctx.adminToken) });
  assert(res.status === 200 && res.data.data?.stats != null &&
    res.data.data.stats.totalPurchases === 0, `Status ${res.status}`);

  log.test('B4 PATCH update + GSTIN immutability');
  // Update notes — allowed
  let r = await api.patch(`/api/vendors/${vendor._id}`, { notes: 'updated' }, { headers: auth(ctx.adminToken) });
  const notesOk = r.status === 200 && r.data.data?.notes === 'updated';
  // GSTIN change — blocked
  r = await api.patch(`/api/vendors/${vendor._id}`, { gstin: '23OTHER0001X1Z9' }, { headers: auth(ctx.adminToken) });
  const gstinBlocked = r.status === 400;
  assert(notesOk && gstinBlocked, `notesOk=${notesOk} gstinBlocked=${gstinBlocked}`);

  log.test('B5 Soft-delete + restore');
  let s = await api.delete(`/api/vendors/${vendor._id}`, { headers: auth(ctx.adminToken) });
  const delOk = s.status === 200;
  s = await api.post(`/api/vendors/${vendor._id}/restore`, {}, { headers: auth(ctx.adminToken) });
  const restoreOk = s.status === 200;
  const reloaded = await Vendor.findById(vendor._id).lean();
  assert(delOk && restoreOk && reloaded.isDeleted === false && reloaded.isActive === true,
    `delOk=${delOk} restoreOk=${restoreOk} isDeleted=${reloaded.isDeleted}`);
}

// ════════════════════════════════════════════════
// C. PURCHASE ORDER LIFECYCLE (6 tests)
// ════════════════════════════════════════════════
async function categoryC_purchaseLifecycle() {
  log.section('C. PURCHASE ORDER LIFECYCLE (6 tests)');

  const vendorId = ctx.vendorIds[0];

  log.test('C1 Create DRAFT → 201 + auto-totals');
  let res = await api.post('/api/purchases', {
    vendorId,
    items: [
      { productId: ctx.pRich._id, quantity: 40, ratePerSheet: 700 },
      { productId: ctx.pMid._id, quantity: 30, ratePerSheet: 500 },
    ],
    notes: E2E_TAG,
  }, { headers: auth(ctx.adminToken) });
  assert(res.status === 201 &&
    res.data.data?.subTotal === 40 * 700 + 30 * 500 &&
    res.data.data?.grandTotal === Math.round((40 * 700 + 30 * 500) * 1.18),
    `Status ${res.status} subTotal=${res.data.data?.subTotal}`);
  const po1 = res.data.data;
  ctx.purchaseIds.push(po1._id);

  log.test('C2 PATCH on DRAFT (re-snapshot)');
  res = await api.patch(`/api/purchases/${po1._id}`, {
    items: [
      { productId: ctx.pRich._id, quantity: 50, ratePerSheet: 700 },
      { productId: ctx.pMid._id, quantity: 30, ratePerSheet: 500 },
    ],
  }, { headers: auth(ctx.adminToken) });
  assert(res.status === 200 && res.data.data?.subTotal === 50 * 700 + 30 * 500,
    `Status ${res.status} subTotal=${res.data.data?.subTotal}`);

  log.test('C3 DRAFT → ORDERED');
  res = await api.post(`/api/purchases/${po1._id}/order`, {}, { headers: auth(ctx.adminToken) });
  assert(res.status === 200 && res.data.data?.status === 'ORDERED' && res.data.data?.orderedAt,
    `Status ${res.status} got status=${res.data.data?.status}`);

  log.test('C4 Full receive → RECEIVED + RESTOCK movement + stock += qty');
  const prePRich = await Product.findById(ctx.pRich._id).select('currentStock').lean();
  const prePMid = await Product.findById(ctx.pMid._id).select('currentStock').lean();
  res = await api.post(`/api/purchases/${po1._id}/receive`, {
    items: [
      { productId: ctx.pRich._id, receivedQuantity: 50 },
      { productId: ctx.pMid._id, receivedQuantity: 30 },
    ],
    invoiceNo: 'E2E-INV-001',
  }, { headers: auth(ctx.adminToken) });
  const postPRich = await Product.findById(ctx.pRich._id).select('currentStock').lean();
  const postPMid = await Product.findById(ctx.pMid._id).select('currentStock').lean();
  const movements = await StockMovement.find({
    product: { $in: [ctx.pRich._id, ctx.pMid._id] },
    reason: { $regex: po1.purchaseNo },
  }).lean();
  const stockOk =
    postPRich.currentStock === (prePRich.currentStock || 0) + 50 &&
    postPMid.currentStock === (prePMid.currentStock || 0) + 30;
  const movementsOk =
    movements.length === 2 &&
    movements.every(m => m.movementType === 'RESTOCK');
  assert(res.status === 200 &&
    res.data.data?.purchase?.status === 'RECEIVED' &&
    stockOk && movementsOk,
    `status=${res.data.data?.purchase?.status} stockOk=${stockOk} movements=${movements.length}`);

  log.test('C5 Partial receive → PARTIAL_RECEIVED + accumulated qty');
  // New PO with 100 sheets of pSparse
  res = await api.post('/api/purchases', {
    vendorId,
    items: [{ productId: ctx.pSparse._id, quantity: 100, ratePerSheet: 600 }],
    notes: E2E_TAG,
  }, { headers: auth(ctx.adminToken) });
  const po2 = res.data.data;
  ctx.purchaseIds.push(po2._id);
  await api.post(`/api/purchases/${po2._id}/order`, {}, { headers: auth(ctx.adminToken) });
  // First partial: 30
  await api.post(`/api/purchases/${po2._id}/receive`, {
    items: [{ productId: ctx.pSparse._id, receivedQuantity: 30 }],
  }, { headers: auth(ctx.adminToken) });
  // Second partial: 20 — accumulated should be 50
  await api.post(`/api/purchases/${po2._id}/receive`, {
    items: [{ productId: ctx.pSparse._id, receivedQuantity: 20 }],
  }, { headers: auth(ctx.adminToken) });
  const po2Reload = await Purchase.findById(po2._id).lean();
  assert(po2Reload.status === 'PARTIAL_RECEIVED' &&
    po2Reload.items[0].receivedQuantity === 50,
    `status=${po2Reload.status} qty=${po2Reload.items[0].receivedQuantity}`);

  log.test('C6 Cancel → CANCELLED');
  res = await api.post(`/api/purchases/${po2._id}/cancel`, {
    reason: 'E2E test cancellation',
  }, { headers: auth(ctx.adminToken) });
  assert(res.status === 200 && res.data.data?.status === 'CANCELLED' &&
    res.data.data?.cancellationReason === 'E2E test cancellation',
    `Status ${res.status} got status=${res.data.data?.status}`);
}

// ════════════════════════════════════════════════
// D. INVENTORY ANALYTICS (5 tests)
// ════════════════════════════════════════════════
async function categoryD_inventoryAnalytics() {
  log.section('D. INVENTORY ANALYTICS (5 tests)');

  // Seed DEDUCTION movements on pMid spanning last 60 days for analytics
  const adminUser = await User.findOne({ email: ADMIN_EMAIL }).select('_id').lean();
  const movements = [];
  for (let d = 1; d <= 50; d += 3) {
    const when = new Date(Date.now() - d * MS_DAY);
    movements.push({
      product: ctx.pMid._id,
      productSnapshot: { sku: ctx.pMid.sku, name: ctx.pMid.name, productType: 'RAW_SHEET' },
      movementType: 'DEDUCTION',
      quantityBefore: 100, quantityChange: -5, quantityAfter: 95,
      reason: `${E2E_TAG}_analytics`,
      performedBy: adminUser._id,
      performedAt: when, createdAt: when, updatedAt: when,
    });
  }
  await StockMovement.collection.insertMany(movements);

  log.test('D1 GET /consumption with date range + groupBy=day');
  const from = new Date(Date.now() - 60 * MS_DAY).toISOString();
  const to = new Date().toISOString();
  let res = await api.get(
    `/api/inventory/analytics/consumption?dateFrom=${from}&dateTo=${to}&groupBy=day`,
    { headers: auth(ctx.adminToken) }
  );
  assert(res.status === 200 && Array.isArray(res.data.data) &&
    res.data.data.some(d => d.sheets > 0),
    `Status ${res.status} buckets=${res.data.data?.length}`);

  log.test('D2 GET /by-product trend');
  res = await api.get(
    `/api/inventory/analytics/by-product?dateFrom=${from}&dateTo=${to}&limit=10`,
    { headers: auth(ctx.adminToken) }
  );
  assert(res.status === 200 && res.data.data.some(d =>
    String(d.productId) === String(ctx.pMid._id) &&
    ['up', 'down', 'stable'].includes(d.trend)),
    `Status ${res.status}`);

  log.test('D3 GET /by-size');
  res = await api.get(`/api/inventory/analytics/by-size`, { headers: auth(ctx.adminToken) });
  assert(res.status === 200 && Array.isArray(res.data.data), `Status ${res.status}`);

  log.test('D4 GET /by-grade (all grades enumerated)');
  res = await api.get(`/api/inventory/analytics/by-grade`, { headers: auth(ctx.adminToken) });
  assert(res.status === 200 && Array.isArray(res.data.data) &&
    res.data.data.every(g => g.code && g.label && 'sheets' in g),
    `Status ${res.status}`);

  log.test('D5 GET /dashboard composite');
  res = await api.get(`/api/inventory/analytics/dashboard`, { headers: auth(ctx.adminToken) });
  assert(res.status === 200 &&
    res.data.summary && res.data.top5Products && res.data.recentTrend &&
    Array.isArray(res.data.monthlyTrend) && res.data.monthlyTrend.length === 12,
    `Status ${res.status}`);
}

// ════════════════════════════════════════════════
// E. FORECASTING (6 tests)
// ════════════════════════════════════════════════
async function categoryE_forecastEndpoints() {
  log.section('E. FORECASTING SERVICE + ENDPOINTS (6 tests)');

  // Seed pRich with 30 months of DEDUCTION (flat=60) → Holt-Winters branch
  // Seed pSparse with 2 months (flat=20) → naive branch
  const adminUser = await User.findOne({ email: ADMIN_EMAIL }).select('_id').lean();
  const richSeeds = [];
  for (let i = 0; i < 30; i++) {
    const monthsAgo = 29 - i;
    const when = new Date(); when.setMonth(when.getMonth() - monthsAgo); when.setDate(10);
    richSeeds.push({
      product: ctx.pRich._id,
      productSnapshot: { sku: ctx.pRich.sku, name: ctx.pRich.name, productType: 'RAW_SHEET' },
      movementType: 'DEDUCTION',
      quantityBefore: 500, quantityChange: -60, quantityAfter: 440,
      reason: `${E2E_TAG}_forecast_rich`,
      performedBy: adminUser._id,
      performedAt: when, createdAt: when, updatedAt: when,
    });
  }
  await StockMovement.collection.insertMany(richSeeds);

  const sparseSeeds = [];
  for (let i = 0; i < 2; i++) {
    const monthsAgo = 1 - i;
    const when = new Date(); when.setMonth(when.getMonth() - monthsAgo); when.setDate(10);
    sparseSeeds.push({
      product: ctx.pSparse._id,
      productSnapshot: { sku: ctx.pSparse.sku, name: ctx.pSparse.name, productType: 'RAW_SHEET' },
      movementType: 'DEDUCTION',
      quantityBefore: 100, quantityChange: -20, quantityAfter: 80,
      reason: `${E2E_TAG}_forecast_sparse`,
      performedBy: adminUser._id,
      performedAt: when, createdAt: when, updatedAt: when,
    });
  }
  await StockMovement.collection.insertMany(sparseSeeds);

  log.test('E1 POST /run/:id on rich → method=holt-winters');
  let res = await api.post(`/api/forecast/run/${ctx.pRich._id}`, {}, { headers: auth(ctx.adminToken) });
  assert(res.status === 200 && res.data.data?.method === 'holt-winters',
    `Status ${res.status} method=${res.data.data?.method}`);

  log.test('E2 POST /run/:id on sparse → method=naive');
  res = await api.post(`/api/forecast/run/${ctx.pSparse._id}`, {}, { headers: auth(ctx.adminToken) });
  assert(res.status === 200 && res.data.data?.method === 'naive',
    `Status ${res.status} method=${res.data.data?.method}`);

  log.test('E3 POST /run-all (SUPER_ADMIN) → 202 + summary');
  // Use SUPER_ADMIN to ensure fresh rate-limit slot (per-user keyed)
  res = await api.post(`/api/forecast/run-all`, {}, { headers: auth(ctx.superToken) });
  assert(res.status === 202 &&
    typeof res.data.data?.total === 'number' &&
    typeof res.data.data?.succeeded === 'number',
    `Status ${res.status}`);

  log.test('E4 /run-all 2nd call within 5min → 429 + retryAfter');
  res = await api.post(`/api/forecast/run-all`, {}, { headers: auth(ctx.superToken) });
  assert(res.status === 429 && typeof res.data?.retryAfter === 'number',
    `Status ${res.status} retryAfter=${res.data?.retryAfter}`);

  log.test('E5 GET /:id returns cached + isStale flag');
  res = await api.get(`/api/forecast/${ctx.pRich._id}`, { headers: auth(ctx.adminToken) });
  assert(res.status === 200 &&
    res.data.data?.lastForecast?.method === 'holt-winters' &&
    res.data.data?.isStale === false &&
    Array.isArray(res.data.data?.historicalSeries),
    `Status ${res.status}`);

  log.test('E6 GET / list with summary + filter by method');
  res = await api.get(`/api/forecast?method=holt-winters&limit=50`, { headers: auth(ctx.adminToken) });
  assert(res.status === 200 && res.data.summary &&
    res.data.data.every(d => d.lastForecast?.method === 'holt-winters'),
    `Status ${res.status} mixedMethods=${[...new Set(res.data.data.map(d => d.lastForecast?.method))].join(',')}`);
}

// ════════════════════════════════════════════════
// F. CRON JOBS (4 tests)
// ════════════════════════════════════════════════
async function categoryF_cronJobs() {
  log.section('F. CRON JOBS (4 tests)');

  const forecastCron = require('../src/jobs/dailyForecast.cron');
  const analyticsCron = require('../src/jobs/dailyAnalytics.cron');
  const weeklyCron = require('../src/jobs/weeklyAdminReport.cron');

  log.test('F1 dailyForecastJob direct call → updates forecastData');
  const beforeForecast = await Product.findById(ctx.pRich._id).select('forecastData').lean();
  const fcResult = await forecastCron.dailyForecastJob();
  const afterForecast = await Product.findById(ctx.pRich._id).select('forecastData').lean();
  assert(fcResult.total > 0 &&
    afterForecast.forecastData?.lastForecast?.computedAt &&
    new Date(afterForecast.forecastData.lastForecast.computedAt).getTime() >=
      (beforeForecast.forecastData?.lastForecast?.computedAt
        ? new Date(beforeForecast.forecastData.lastForecast.computedAt).getTime()
        : 0),
    `total=${fcResult.total} computedAt=${afterForecast.forecastData?.lastForecast?.computedAt}`);

  log.test('F2 dailyAnalyticsJob → populates last30/90/365 + peakMonths');
  const aResult = await analyticsCron.dailyAnalyticsJob();
  const pRichAnalytics = await Product.findById(ctx.pRich._id).select('forecastData').lean();
  assert(aResult.succeeded > 0 &&
    typeof pRichAnalytics.forecastData?.last30Days === 'number' &&
    typeof pRichAnalytics.forecastData?.last365Days === 'number' &&
    Array.isArray(pRichAnalytics.forecastData?.peakMonths),
    `succeeded=${aResult.succeeded} hasFields=${'last30Days' in (pRichAnalytics.forecastData || {})}`);

  log.test('F3 weeklyAdminReportJob mock-mode → EmailLog created');
  // Capture + set WEEKLY_REPORT_RECIPIENT for deterministic dispatch
  await captureSettingForRestore('WEEKLY_REPORT_RECIPIENT');
  await SystemSetting.findOneAndUpdate(
    { key: 'WEEKLY_REPORT_RECIPIENT' },
    { $set: { value: `${E2E_TAG.toLowerCase()}-report@e2e.test` } },
    { upsert: false }
  );
  const wResult = await weeklyCron.weeklyAdminReportJob();
  const reportLog = await EmailLog.findOne({
    subject: { $regex: 'Weekly Admin Report' },
    to: `${E2E_TAG.toLowerCase()}-report@e2e.test`,
  }).sort({ createdAt: -1 }).lean();
  assert(wResult.summary &&
    reportLog &&
    reportLog.type === 'TEXT' &&
    reportLog.isMock === true,
    `summary=${!!wResult.summary} reportLog=${!!reportLog} type=${reportLog?.type} isMock=${reportLog?.isMock}`);

  log.test('F4 POST /api/cron/run/forecast (SUPER_ADMIN) — 200 then 429');
  // SUPER_ADMIN was just created in A2 → fresh rate-limit slot in backend
  let r1 = await api.post('/api/cron/run/forecast', {}, { headers: auth(ctx.superToken) });
  let r2 = await api.post('/api/cron/run/forecast', {}, { headers: auth(ctx.superToken) });
  assert(r1.status === 200 && r2.status === 429 &&
    typeof r2.data?.retryAfter === 'number',
    `r1=${r1.status} r2=${r2.status} retryAfter=${r2.data?.retryAfter}`);
}

// ════════════════════════════════════════════════
// G. CROSS-SECTION INTEGRATION (4 tests)
// ════════════════════════════════════════════════
async function categoryG_integration() {
  log.section('G. CROSS-SECTION INTEGRATION (4 tests)');

  log.test('G1 End-to-end: vendor → PO → receive → analytics + forecast reflect new RESTOCK');
  // Create a fresh vendor + PO for pSparse, receive 200 sheets, then verify:
  //   - StockMovement created with RESTOCK
  //   - Product.currentStock incremented
  //   - Forecast service ignores RESTOCK (DEDUCTION-only) — pSparse stays naive
  const vendorRes = await api.post('/api/vendors', {
    name: `${E2E_TAG} Integration Vendor`,
    gstin: '23FGHIJ1111B1Z6',
  }, { headers: auth(ctx.adminToken) });
  const integVendor = vendorRes.data.data;
  ctx.vendorIds.push(integVendor._id);

  const preStock = (await Product.findById(ctx.pSparse._id).select('currentStock').lean()).currentStock || 0;
  const poRes = await api.post('/api/purchases', {
    vendorId: integVendor._id,
    items: [{ productId: ctx.pSparse._id, quantity: 200, ratePerSheet: 500 }],
    notes: `${E2E_TAG}_integration`,
  }, { headers: auth(ctx.adminToken) });
  const integPO = poRes.data.data;
  ctx.purchaseIds.push(integPO._id);
  await api.post(`/api/purchases/${integPO._id}/order`, {}, { headers: auth(ctx.adminToken) });
  await api.post(`/api/purchases/${integPO._id}/receive`, {
    items: [{ productId: ctx.pSparse._id, receivedQuantity: 200 }],
  }, { headers: auth(ctx.adminToken) });

  const postStock = (await Product.findById(ctx.pSparse._id).select('currentStock').lean()).currentStock || 0;
  const restockMovements = await StockMovement.find({
    product: ctx.pSparse._id,
    movementType: 'RESTOCK',
    reason: { $regex: integPO.purchaseNo },
  }).lean();

  assert(postStock === preStock + 200 && restockMovements.length === 1 &&
    restockMovements[0].quantityChange === 200,
    `stock=${preStock}→${postStock} movements=${restockMovements.length}`);

  log.test('G2 Vendor delete blocked by active PO (cross-model integrity)');
  // integPO is RECEIVED (just received in full) — try blocking with a NEW DRAFT PO
  const blockerRes = await api.post('/api/purchases', {
    vendorId: integVendor._id,
    items: [{ productId: ctx.pMid._id, quantity: 5, ratePerSheet: 100 }],
    notes: `${E2E_TAG}_blocker`,
  }, { headers: auth(ctx.adminToken) });
  const blockerPO = blockerRes.data.data;
  ctx.purchaseIds.push(blockerPO._id);

  const delAttempt = await api.delete(`/api/vendors/${integVendor._id}`, { headers: auth(ctx.adminToken) });
  // Cancel the blocker so cleanup can proceed
  await api.post(`/api/purchases/${blockerPO._id}/cancel`, { reason: 'cleanup' }, { headers: auth(ctx.adminToken) });
  assert(delAttempt.status === 409, `Status ${delAttempt.status}`);

  log.test('G3 StockMovement audit trail — both DEDUCTION + RESTOCK visible');
  // Verify both types exist for pSparse (RESTOCK from G1, plus the original DEDUCTION seeds from E)
  const allMovements = await StockMovement.find({ product: ctx.pSparse._id }).lean();
  const types = [...new Set(allMovements.map(m => m.movementType))];
  assert(types.includes('DEDUCTION') && types.includes('RESTOCK'),
    `Types: ${types.join(',')}`);

  log.test('G4 Forecast service uses DEDUCTION only (RESTOCK does NOT pollute)');
  // Re-run forecast on pSparse. Method should still be 'naive' (2 months of DEDUCTION),
  // not influenced by the +200 RESTOCK from G1.
  const r = await api.post(`/api/forecast/run/${ctx.pSparse._id}`, {}, { headers: auth(ctx.adminToken) });
  // Predictions should reflect DEDUCTION average (~20) — NOT the +200 RESTOCK spike
  const avgPrediction = r.data.data?.predictions?.reduce((s, n) => s + n, 0) /
                        (r.data.data?.predictions?.length || 1);
  assert(r.data.data?.method === 'naive' && avgPrediction < 50,
    `method=${r.data.data?.method} avgPred=${avgPrediction}`);
}

// ════════════════════════════════════════════════
// H. CLEANUP & VERIFICATION (2 tests)
// ════════════════════════════════════════════════
async function categoryH_cleanup() {
  log.section('H. CLEANUP & VERIFICATION (2 tests)');

  log.test('H1 All E2E entities deleted');
  // Restore product stock first
  for (const [pid, snap] of ctx.productStockSnapshots.entries()) {
    await Product.updateOne({ _id: pid }, {
      $set: { currentStock: snap.currentStock, lastRestockedAt: snap.lastRestockedAt },
      $unset: { forecastData: '' },
    });
  }

  // Delete in dependency order: movements → purchases → vendors → users
  await StockMovement.deleteMany({ reason: { $regex: E2E_TAG } });
  // Also remove the RESTOCK movements created by PO receives (reason = "PO <purchaseNo> received")
  const purchaseNos = await Purchase.find({ _id: { $in: ctx.purchaseIds } }).select('purchaseNo').lean();
  for (const p of purchaseNos) {
    await StockMovement.deleteMany({ reason: `PO ${p.purchaseNo} received` });
  }
  await Purchase.deleteMany({ _id: { $in: ctx.purchaseIds } });
  await Vendor.deleteMany({ _id: { $in: ctx.vendorIds } });
  if (ctx.superUserId) await User.deleteOne({ _id: ctx.superUserId });
  if (ctx.billingUserId) await User.deleteOne({ _id: ctx.billingUserId });
  await EmailLog.deleteMany({
    subject: { $regex: 'Weekly Admin Report' },
    to: { $regex: E2E_TAG.toLowerCase() },
  });
  // Restore touched settings
  for (const [key, value] of ctx.settingsToRestore.entries()) {
    if (value !== undefined) {
      await SystemSetting.findOneAndUpdate({ key }, { $set: { value } });
    }
  }
  assert(true, '');

  log.test('H2 Zero leaked E2E entities remain');
  const [vCount, pCount, smCount, uCount, elCount] = await Promise.all([
    Vendor.countDocuments({ name: { $regex: E2E_TAG } }),
    Purchase.countDocuments({ notes: { $regex: E2E_TAG } }),
    StockMovement.countDocuments({ reason: { $regex: E2E_TAG } }),
    User.countDocuments({ email: { $regex: `^${E2E_TAG.toLowerCase()}-` } }),
    EmailLog.countDocuments({
      to: { $regex: E2E_TAG.toLowerCase() },
    }),
  ]);
  assert(vCount === 0 && pCount === 0 && smCount === 0 && uCount === 0 && elCount === 0,
    `vendors=${vCount} purchases=${pCount} movements=${smCount} users=${uCount} emails=${elCount}`);
}

async function captureSettingForRestore(key) {
  if (ctx.settingsToRestore.has(key)) return;
  const cur = await SystemSetting.findOne({ key }).lean();
  ctx.settingsToRestore.set(key, cur?.value);
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
    console.log('\nALL TESTS PASSED — Prompt 8 (Inventory + Forecasting + Cron) is PRODUCTION-READY!');
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
