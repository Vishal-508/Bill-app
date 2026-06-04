require('dotenv').config();
if (process.env.NODE_ENV !== 'production') {
  const dns = require('dns');
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
}

const axios = require('axios');
const mongoose = require('mongoose');
const logger = require('../src/config/logger');
const { StockMovement, Product, User } = require('../src/models');
const forecastController = require('../src/controllers/forecast.controller');

const BASE_URL = process.env.API_URL || 'http://localhost:5000';
const BYPASS = process.env.TEST_BYPASS_SECRET;

const api = axios.create({
  baseURL: BASE_URL,
  headers: { 'x-test-bypass-ratelimit': BYPASS },
  validateStatus: () => true,
});

const TAG = 'FORECAST_ENDPOINTS_TEST';
const MS_DAY = 24 * 60 * 60 * 1000;

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

  let billingUserId;
  const touchedProductIds = new Set();

  const cleanup = async () => {
    await StockMovement.deleteMany({ reason: { $regex: TAG } });
    if (touchedProductIds.size > 0) {
      await Product.updateMany(
        { _id: { $in: [...touchedProductIds] } },
        { $unset: { forecastData: '' } }
      );
    }
    if (billingUserId) await User.deleteOne({ _id: billingUserId });
    forecastController._clearRateLimits();
  };

  // Seed N synthetic monthly movements where i=0 is oldest, i=months-1 is current
  const seedMonthly = async (productId, months, value, suffix, adminId) => {
    touchedProductIds.add(String(productId));
    const product = await Product.findById(productId).select('sku name productType').lean();
    const docs = [];
    for (let i = 0; i < months; i++) {
      const monthsAgo = months - 1 - i;
      const when = new Date();
      when.setMonth(when.getMonth() - monthsAgo);
      when.setDate(10);
      docs.push({
        product: productId,
        productSnapshot: { sku: product.sku, name: product.name, productType: product.productType },
        movementType: 'DEDUCTION',
        quantityBefore: 1000, quantityChange: -value, quantityAfter: 1000 - value,
        reason: `${TAG}_${suffix}`,
        performedBy: adminId,
        performedAt: when, createdAt: when, updatedAt: when,
      });
    }
    await StockMovement.collection.insertMany(docs);
  };

  try {
    logger.info('\n═══ SECTION D — Forecast Endpoints Smoke Test ═══');

    // ─── Setup: Auth ───
    logger.info('\nSetup: Auth');
    const loginRes = await api.post('/api/auth/login', {
      email: 'testadmin@shreegopal.com',
      password: 'TestAdmin@123',
    });
    assert('Admin login (200)', loginRes.status === 200);
    const h = { Authorization: `Bearer ${loginRes.data.accessToken}` };
    const adminUser = await User.findOne({ email: 'testadmin@shreegopal.com' }).select('_id').lean();

    // Create BILLING user
    const billingEmail = `billing-${TAG.toLowerCase()}@d.test`;
    await User.deleteMany({ email: billingEmail });
    const billing = await User.create({
      name: 'BILLING Forecast Test',
      email: billingEmail,
      password: 'BillingD@123',
      role: 'BILLING',
      isActive: true,
    });
    billingUserId = billing._id;
    const bLogin = await api.post('/api/auth/login', {
      email: billingEmail,
      password: 'BillingD@123',
    });
    assert('BILLING login (200)', bLogin.status === 200);
    const bh = { Authorization: `Bearer ${bLogin.data.accessToken}` };

    // Find 4 distinct products
    const products = await Product.find({
      productType: 'RAW_SHEET',
      isDeleted: false,
    }).select('_id sku name').limit(4).lean();
    assert('At least 4 RAW_SHEET products available', products.length >= 4);
    if (products.length < 4) throw new Error('Need 4 products');

    const [pA, pB, pC, pD] = products;
    // Pre-clean any prior runs
    await StockMovement.deleteMany({
      product: { $in: products.map(p => p._id) },
      reason: { $regex: TAG },
    });
    await Product.updateMany(
      { _id: { $in: products.map(p => p._id) } },
      { $unset: { forecastData: '' } }
    );
    products.forEach(p => touchedProductIds.add(String(p._id)));

    // Seed:
    //   A: 30 months flat=50 → Holt-Winters
    //   B: 12 months flat=40 → Moving Average
    //   C: 2 months flat=25 → Naive (under 6-month MA threshold)
    //   D: no movements → never forecasted
    logger.info('\nSetup: Seed historical movements (A=30mo, B=12mo, C=2mo, D=none)');
    await seedMonthly(pA._id, 30, 50, 'A_HW', adminUser._id);
    await seedMonthly(pB._id, 12, 40, 'B_MA', adminUser._id);
    await seedMonthly(pC._id, 2, 25, 'C_naive', adminUser._id);

    // Ensure rate-limit slot is empty before any /run-all
    forecastController._clearRateLimits();

    // ═══════════════════════════════════════════════
    // Auth & RBAC (4 tests)
    // ═══════════════════════════════════════════════
    logger.info('\n--- Auth & RBAC ---');

    logger.info('\nT1: Unauthenticated → 401 on all endpoints');
    const noAuth = [
      ['post', `/api/forecast/run/${pA._id}`],
      ['post', `/api/forecast/run-all`],
      ['get', `/api/forecast/${pA._id}`],
      ['get', `/api/forecast`],
      ['get', `/api/forecast/health`],
    ];
    let all401 = true;
    for (const [m, p] of noAuth) {
      const r = m === 'post' ? await api.post(p, {}) : await api.get(p);
      if (r.status !== 401) { all401 = false; logger.error(`    ${m} ${p} got ${r.status}`); }
    }
    assert('All 5 endpoints → 401 without auth', all401);

    logger.info('\nT2: BILLING → 403 on /run/:id and /run-all');
    let r = await api.post(`/api/forecast/run/${pA._id}`, {}, { headers: bh });
    assert('BILLING → POST /run/:id → 403', r.status === 403, `Got ${r.status}`);
    r = await api.post(`/api/forecast/run-all`, {}, { headers: bh });
    assert('BILLING → POST /run-all → 403', r.status === 403, `Got ${r.status}`);

    logger.info('\nT3: BILLING → 200 on GET /:id and GET /');
    r = await api.get(`/api/forecast/${pA._id}`, { headers: bh });
    assert('BILLING → GET /:id → 200', r.status === 200, `Got ${r.status}`);
    r = await api.get(`/api/forecast`, { headers: bh });
    assert('BILLING → GET / → 200', r.status === 200, `Got ${r.status}`);

    logger.info('\nT4: BILLING → 403 on /health (admin-only)');
    r = await api.get(`/api/forecast/health`, { headers: bh });
    assert('BILLING → GET /health → 403', r.status === 403, `Got ${r.status}`);

    // ═══════════════════════════════════════════════
    // POST /run/:productId (3 tests)
    // ═══════════════════════════════════════════════
    logger.info('\n--- POST /run/:productId ---');

    logger.info('\nT5: Valid product → 200 with forecast result');
    r = await api.post(`/api/forecast/run/${pA._id}`, {}, { headers: h });
    assert('Run A → 200', r.status === 200, `Got ${r.status}`);
    assert('Result.method = holt-winters', r.data.data?.method === 'holt-winters',
      `Got ${r.data.data?.method}`);

    logger.info('\nT6: Result has predictions + mape + computedAt');
    const dA = r.data.data;
    assert('Has predictions array', Array.isArray(dA?.predictions) && dA.predictions.length > 0);
    assert('Has computedAt field', dA?.computedAt != null);
    assert('Has historicalSeries array',
      Array.isArray(dA?.historicalSeries) && dA.historicalSeries.length > 0);

    // Run B + C to populate forecasts
    await api.post(`/api/forecast/run/${pB._id}`, {}, { headers: h });
    await api.post(`/api/forecast/run/${pC._id}`, {}, { headers: h });

    logger.info('\nT7: Non-existent productId → 404');
    const fakeId = new mongoose.Types.ObjectId();
    r = await api.post(`/api/forecast/run/${fakeId}`, {}, { headers: h });
    assert('Non-existent → 404', r.status === 404, `Got ${r.status}`);

    // ═══════════════════════════════════════════════
    // POST /run-all + rate limit (3 tests)
    // ═══════════════════════════════════════════════
    logger.info('\n--- POST /run-all + rate limit ---');

    // Clear so this admin can take the slot cleanly
    forecastController._clearRateLimits();

    logger.info('\nT8: Returns 202 with batch summary');
    r = await api.post(`/api/forecast/run-all`, {}, { headers: h });
    assert('Run-all → 202', r.status === 202, `Got ${r.status}`);

    logger.info('\nT9: Summary shape { total, succeeded, failed, errors }');
    const s = r.data.data;
    assert('Summary has total/succeeded/failed/errors keys',
      typeof s?.total === 'number' &&
      typeof s?.succeeded === 'number' &&
      typeof s?.failed === 'number' &&
      Array.isArray(s?.errors),
      JSON.stringify(Object.keys(s || {})));

    logger.info('\nT10: Rate limit — second call within 5min → 429 + retryAfter');
    r = await api.post(`/api/forecast/run-all`, {}, { headers: h });
    assert('Second /run-all → 429', r.status === 429, `Got ${r.status}`);
    assert('Response has retryAfter (seconds)',
      typeof r.data?.retryAfter === 'number' && r.data.retryAfter > 0,
      `Got ${r.data?.retryAfter}`);

    // ═══════════════════════════════════════════════
    // GET /:productId (3 tests)
    // ═══════════════════════════════════════════════
    logger.info('\n--- GET /:productId ---');

    logger.info('\nT11: Returns cached lastForecast after /run');
    r = await api.get(`/api/forecast/${pA._id}`, { headers: h });
    assert('Get A → 200', r.status === 200);
    assert('lastForecast populated (just-computed)',
      r.data.data?.lastForecast?.method === 'holt-winters');
    assert('historicalSeries returned (12 entries)',
      Array.isArray(r.data.data?.historicalSeries) &&
      r.data.data.historicalSeries.length === 12);

    logger.info('\nT12: isStale = false for just-computed forecast');
    assert('isStale = false', r.data.data?.isStale === false,
      `Got ${r.data.data?.isStale}`);

    logger.info('\nT13: Never-forecasted product → 200 with lastForecast=null');
    // T8's /run-all gave pD a fallback forecast — unset it to recreate the
    // "never forecasted" state for this assertion.
    await Product.updateOne({ _id: pD._id }, { $unset: { forecastData: '' } });
    r = await api.get(`/api/forecast/${pD._id}`, { headers: h });
    assert('Get D (never forecasted) → 200', r.status === 200);
    assert('lastForecast = null', r.data.data?.lastForecast === null,
      `Got ${JSON.stringify(r.data.data?.lastForecast)}`);
    assert('isStale = true for never-forecasted', r.data.data?.isStale === true);

    // ═══════════════════════════════════════════════
    // GET / summary list (4 tests)
    // ═══════════════════════════════════════════════
    logger.info('\n--- GET / summary list ---');

    logger.info('\nT14: Returns paginated list with summary');
    r = await api.get(`/api/forecast?limit=50`, { headers: h });
    assert('List → 200', r.status === 200);
    assert('Has data array', Array.isArray(r.data.data));
    assert('Has pagination', r.data.pagination?.total != null);
    assert('Has summary', r.data.summary?.totalProducts != null);

    logger.info('\nT15: summary.byMethod counts by method');
    assert('summary.byMethod is object', typeof r.data.summary?.byMethod === 'object');
    // We seeded at least 1 HW (pA) — should show in byMethod
    assert('byMethod includes holt-winters >= 1',
      (r.data.summary?.byMethod?.['holt-winters'] || 0) >= 1,
      JSON.stringify(r.data.summary?.byMethod));

    logger.info('\nT16: summary.avgMape excludes null MAPEs');
    // avgMape should be a number (HW has mape) or null
    const am = r.data.summary?.avgMape;
    assert('avgMape is number or null', am === null || typeof am === 'number',
      `Got ${typeof am}: ${am}`);

    logger.info('\nT17: Filter method=holt-winters returns only HW products');
    r = await api.get(`/api/forecast?method=holt-winters&limit=50`, { headers: h });
    assert('Filter HW → 200', r.status === 200);
    assert('All page entries have method=holt-winters',
      r.data.data.every(d => d.lastForecast?.method === 'holt-winters'),
      `Got methods: ${[...new Set(r.data.data.map(d => d.lastForecast?.method))].join(',')}`);

    // ═══════════════════════════════════════════════
    // GET /health (3 tests)
    // ═══════════════════════════════════════════════
    logger.info('\n--- GET /health ---');

    logger.info('\nT18: Returns health shape');
    r = await api.get(`/api/forecast/health`, { headers: h });
    assert('Health → 200', r.status === 200);
    const hd = r.data.data;
    assert('Has status field',
      ['ok', 'degraded', 'no-data'].includes(hd?.status), `Got ${hd?.status}`);

    logger.info('\nT19: settings reflects SystemSettings');
    assert('settings.horizonMonths is number',
      typeof hd?.settings?.horizonMonths === 'number');
    assert('settings.hwAlpha is number',
      typeof hd?.settings?.hwAlpha === 'number');

    logger.info('\nT20: nostradamusInstalled = true');
    assert('nostradamusInstalled = true', hd?.nostradamusInstalled === true);

    // ═══════════════════════════════════════════════
    // Route ordering sanity check
    // ═══════════════════════════════════════════════
    logger.info('\n--- Route ordering check ---');
    logger.info('\nT21: GET /forecast/health does NOT match /:productId param');
    // If route order is wrong, /health would be parsed as productId 'health'
    // and 400 (CastError) returned instead of the health response
    r = await api.get(`/api/forecast/health`, { headers: h });
    assert('health route reached (not param-matched)',
      r.status === 200 && r.data.data?.nostradamusInstalled !== undefined,
      `Got status=${r.status}`);

    // ═══════════════════════════════════════════════
    // Cleanup
    // ═══════════════════════════════════════════════
    logger.info('\nCleanup');
    const beforeCleanup = await StockMovement.countDocuments({ reason: { $regex: TAG } });
    await cleanup();
    const afterCleanup = await StockMovement.countDocuments({ reason: { $regex: TAG } });
    assert('All test movements deleted',
      afterCleanup === 0, `Before=${beforeCleanup} After=${afterCleanup}`);

    await mongoose.disconnect();

    logger.info('\n═══════════════════════════════════════');
    logger.info(`📊 Forecast Endpoints (Section D): ${pass}/${pass + fail} passed`);
    if (failures.length > 0) {
      logger.info('\nFailures:');
      failures.forEach((f, i) => logger.info(`  ${i + 1}. ${f}`));
    }
    process.exit(fail === 0 ? 0 : 1);
  } catch (error) {
    logger.error('Test crashed:', error);
    try { await cleanup(); } catch {}
    try { await mongoose.disconnect(); } catch {}
    process.exit(1);
  }
};

test();
