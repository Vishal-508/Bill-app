require('dotenv').config();
if (process.env.NODE_ENV !== 'production') {
  const dns = require('dns');
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
}

const axios = require('axios');
const mongoose = require('mongoose');
const logger = require('../src/config/logger');
const { StockMovement, Product, User } = require('../src/models');

const BASE_URL = process.env.API_URL || 'http://localhost:5000';
const BYPASS = process.env.TEST_BYPASS_SECRET;

const api = axios.create({
  baseURL: BASE_URL,
  headers: { 'x-test-bypass-ratelimit': BYPASS },
  validateStatus: () => true,
});

const TAG = 'INVENTORY_ANALYTICS_TEST';
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

  let cuttingUserId;
  const seededMovementIds = [];

  const cleanup = async () => {
    await StockMovement.deleteMany({ reason: { $regex: TAG } });
    if (cuttingUserId) await User.deleteOne({ _id: cuttingUserId });
  };

  try {
    // ─── Setup: Auth ───
    logger.info('\n═══ SECTION B — Inventory Analytics Smoke Test ═══');
    logger.info('\nSetup: Auth + fixtures');
    const loginRes = await api.post('/api/auth/login', {
      email: 'testadmin@shreegopal.com',
      password: 'TestAdmin@123',
    });
    assert('Admin login (200)', loginRes.status === 200);
    const h = { Authorization: `Bearer ${loginRes.data.accessToken}` };

    // Find admin User document for performedBy
    const adminUser = await User.findOne({ email: 'testadmin@shreegopal.com' }).select('_id').lean();
    assert('Admin user resolved', adminUser != null);

    // Create CUTTING user for RBAC test
    const cuttingEmail = `cutting-inv-b@analytics.test`;
    await User.deleteMany({ email: cuttingEmail });
    const cuttingUser = await User.create({
      name: 'CUTTING Analytics Test',
      email: cuttingEmail,
      password: 'CuttingB@123',
      role: 'CUTTING',
      isActive: true,
    });
    cuttingUserId = cuttingUser._id;
    const cuttingLogin = await api.post('/api/auth/login', {
      email: cuttingEmail,
      password: 'CuttingB@123',
    });
    assert('CUTTING login (200)', cuttingLogin.status === 200);
    const ch = { Authorization: `Bearer ${cuttingLogin.data.accessToken}` };

    // Find 3 RAW_SHEET products with different grades (for /by-grade coverage)
    const products = await Product.find({
      productType: 'RAW_SHEET',
      isDeleted: false,
    }).populate('grade', 'code label').limit(5).lean();
    assert('At least 2 products available', products.length >= 2,
      `Got ${products.length}`);
    if (products.length < 2) throw new Error('Need at least 2 products');

    const [productA, productB] = products;
    const productC = products[2] || productA;

    // ─── Seed historical StockMovements ───
    logger.info('\nSeed: historical StockMovements');
    const now = new Date();
    const moves = [];

    // Period definitions: current = last 30 days, previous = 30-60 days ago
    // For trend tests, product A doubles consumption (up), B halves (down), C stable
    const tagReason = (suffix) => `${TAG}_${suffix}`;

    // Product A: current 100 sheets (10 movements × 10), prev 50 (5 × 10) → up
    for (let i = 0; i < 10; i++) {
      moves.push({
        product: productA._id,
        productSnapshot: { sku: productA.sku, name: productA.name, productType: 'RAW_SHEET' },
        movementType: 'DEDUCTION',
        quantityBefore: 1000, quantityChange: -10, quantityAfter: 990,
        reason: tagReason('A_current'),
        performedBy: adminUser._id,
        performedAt: new Date(now - (i * 2 + 1) * MS_DAY), // 1-19 days ago
        createdAt: new Date(now - (i * 2 + 1) * MS_DAY),
        updatedAt: new Date(now - (i * 2 + 1) * MS_DAY),
      });
    }
    for (let i = 0; i < 5; i++) {
      moves.push({
        product: productA._id,
        productSnapshot: { sku: productA.sku, name: productA.name, productType: 'RAW_SHEET' },
        movementType: 'DEDUCTION',
        quantityBefore: 1000, quantityChange: -10, quantityAfter: 990,
        reason: tagReason('A_previous'),
        performedBy: adminUser._id,
        performedAt: new Date(now - (35 + i * 3) * MS_DAY),
        createdAt: new Date(now - (35 + i * 3) * MS_DAY),
        updatedAt: new Date(now - (35 + i * 3) * MS_DAY),
      });
    }

    // Product B: current 30 (3 × 10), prev 100 (10 × 10) → down
    for (let i = 0; i < 3; i++) {
      moves.push({
        product: productB._id,
        productSnapshot: { sku: productB.sku, name: productB.name, productType: 'RAW_SHEET' },
        movementType: 'DEDUCTION',
        quantityBefore: 500, quantityChange: -10, quantityAfter: 490,
        reason: tagReason('B_current'),
        performedBy: adminUser._id,
        performedAt: new Date(now - (5 + i * 4) * MS_DAY),
        createdAt: new Date(now - (5 + i * 4) * MS_DAY),
        updatedAt: new Date(now - (5 + i * 4) * MS_DAY),
      });
    }
    for (let i = 0; i < 10; i++) {
      moves.push({
        product: productB._id,
        productSnapshot: { sku: productB.sku, name: productB.name, productType: 'RAW_SHEET' },
        movementType: 'DEDUCTION',
        quantityBefore: 500, quantityChange: -10, quantityAfter: 490,
        reason: tagReason('B_previous'),
        performedBy: adminUser._id,
        performedAt: new Date(now - (40 + i * 2) * MS_DAY),
        createdAt: new Date(now - (40 + i * 2) * MS_DAY),
        updatedAt: new Date(now - (40 + i * 2) * MS_DAY),
      });
    }

    // Product C: 5 × 10 in current, 5 × 10 in previous → stable
    for (let i = 0; i < 5; i++) {
      moves.push({
        product: productC._id,
        productSnapshot: { sku: productC.sku, name: productC.name, productType: 'RAW_SHEET' },
        movementType: 'DEDUCTION',
        quantityBefore: 800, quantityChange: -10, quantityAfter: 790,
        reason: tagReason('C_current'),
        performedBy: adminUser._id,
        performedAt: new Date(now - (i * 5 + 1) * MS_DAY),
        createdAt: new Date(now - (i * 5 + 1) * MS_DAY),
        updatedAt: new Date(now - (i * 5 + 1) * MS_DAY),
      });
      moves.push({
        product: productC._id,
        productSnapshot: { sku: productC.sku, name: productC.name, productType: 'RAW_SHEET' },
        movementType: 'DEDUCTION',
        quantityBefore: 800, quantityChange: -10, quantityAfter: 790,
        reason: tagReason('C_previous'),
        performedBy: adminUser._id,
        performedAt: new Date(now - (35 + i * 4) * MS_DAY),
        createdAt: new Date(now - (35 + i * 4) * MS_DAY),
        updatedAt: new Date(now - (35 + i * 4) * MS_DAY),
      });
    }

    // Add 1 RESTOCK for completeness (should NOT appear in DEDUCTION aggregates)
    moves.push({
      product: productA._id,
      productSnapshot: { sku: productA.sku, name: productA.name, productType: 'RAW_SHEET' },
      movementType: 'RESTOCK',
      quantityBefore: 500, quantityChange: 200, quantityAfter: 700,
      reason: tagReason('restock'),
      performedBy: adminUser._id,
      performedAt: new Date(now - 7 * MS_DAY),
      createdAt: new Date(now - 7 * MS_DAY),
      updatedAt: new Date(now - 7 * MS_DAY),
    });

    // Use raw driver to bypass Mongoose timestamps (so createdAt sticks)
    const insertResult = await StockMovement.collection.insertMany(moves);
    seededMovementIds.push(...Object.values(insertResult.insertedIds));
    assert('Seeded movements inserted',
      insertResult.insertedCount === moves.length,
      `Inserted ${insertResult.insertedCount}/${moves.length}`);

    // ─── Test 1: Auth required ───
    logger.info('\nTest 1: Auth required');
    let res = await api.get('/api/inventory/analytics/consumption');
    assert('Unauthed → 401', res.status === 401, `Got ${res.status}`);

    // ─── Test 2: RBAC CUTTING blocked ───
    logger.info('\nTest 2: RBAC — CUTTING blocked on all analytics endpoints');
    for (const path of ['/consumption', '/by-product', '/by-size', '/by-grade', '/bundles', '/dashboard']) {
      res = await api.get(`/api/inventory/analytics${path}`, { headers: ch });
      assert(`CUTTING → ${path} → 403`, res.status === 403, `Got ${res.status}`);
    }

    // ─── Test 3: /consumption default range ───
    logger.info('\nTest 3: GET /consumption');
    res = await api.get('/api/inventory/analytics/consumption?groupBy=day', { headers: h });
    assert('Consumption 200', res.status === 200, `Got ${res.status}`);
    assert('Has period { from, to, groupBy }',
      res.data.period?.from && res.data.period?.to && res.data.period?.groupBy === 'day');
    assert('data is array of {period, sheets, value, movements}',
      Array.isArray(res.data.data) && res.data.data.every(d =>
        typeof d.period === 'string' && typeof d.sheets === 'number'));
    const totalSheets = res.data.data.reduce((s, d) => s + d.sheets, 0);
    // Test-seeded DEDUCTION in last 90 days: 100+50 (A) + 30+100 (B) + 50+50 (C) = 380.
    // Use >= because pre-existing DEDUCTION movements from other test runs may exist.
    assert('Total sheets in default range >= 380 (our seeded amount)',
      totalSheets >= 380, `Got ${totalSheets}`);

    // ─── Test 4: groupBy=day ───
    logger.info('\nTest 4: groupBy=day');
    const dayBuckets = res.data.data;
    assert('Day buckets have YYYY-MM-DD format',
      dayBuckets.every(d => /^\d{4}-\d{2}-\d{2}$/.test(d.period)));

    // ─── Test 5: groupBy=month ───
    logger.info('\nTest 5: groupBy=month');
    res = await api.get('/api/inventory/analytics/consumption?groupBy=month', { headers: h });
    assert('Month buckets 200', res.status === 200);
    assert('Month buckets have YYYY-MM format',
      res.data.data.every(d => /^\d{4}-\d{2}$/.test(d.period)));

    // ─── Test 6: filtered by productId ───
    logger.info('\nTest 6: productId filter');
    res = await api.get(`/api/inventory/analytics/consumption?productId=${productA._id}&groupBy=month`,
      { headers: h });
    const productAOnlyTotal = res.data.data.reduce((s, d) => s + d.sheets, 0);
    // Product A: 100 current + 50 previous = 150
    assert('Single-product filter total = 150', productAOnlyTotal === 150,
      `Got ${productAOnlyTotal}`);

    // ─── Test 7: explicit date range ───
    logger.info('\nTest 7: dateFrom/dateTo filter');
    const from = new Date(now - 25 * MS_DAY).toISOString();
    const to = new Date(now - 1 * MS_DAY).toISOString();
    res = await api.get(
      `/api/inventory/analytics/consumption?dateFrom=${from}&dateTo=${to}&groupBy=day`,
      { headers: h }
    );
    const inRange = res.data.data.reduce((s, d) => s + d.sheets, 0);
    // Should only include current-period rows: A=100, B=30, C=50 = 180
    assert('Date range total = 180 (current-period only)', inRange === 180,
      `Got ${inRange}`);

    // ─── Test 8-11: /by-product ───
    // Use a 30-day window so the test seeds align correctly with previous-period
    // detection: current=last 30 days, previous=30-60 days ago. Product A seeds
    // 100 (current) vs 50 (previous) → up; B 30 vs 100 → down; C 50 vs 50 → stable.
    logger.info('\nTest 8-11: /by-product (30-day window)');
    const byProductFrom = new Date(now - 30 * MS_DAY).toISOString();
    const byProductTo = new Date(now).toISOString();
    res = await api.get(`/api/inventory/analytics/by-product?dateFrom=${byProductFrom}&dateTo=${byProductTo}`,
      { headers: h });
    assert('by-product 200', res.status === 200);
    assert('Data sorted descending by totalSheetsConsumed',
      res.data.data.length >= 1 &&
      res.data.data.every((d, i, arr) => i === 0 || arr[i - 1].totalSheetsConsumed >= d.totalSheetsConsumed));

    const productAEntry = res.data.data.find(d => String(d.productId) === String(productA._id));
    const productBEntry = res.data.data.find(d => String(d.productId) === String(productB._id));
    assert('Product A trend = "up"', productAEntry?.trend === 'up',
      `Got ${productAEntry?.trend} pctChange=${productAEntry?.pctChange}`);
    assert('Product B trend = "down"', productBEntry?.trend === 'down',
      `Got ${productBEntry?.trend} pctChange=${productBEntry?.pctChange}`);

    const pctSum = res.data.data.reduce((s, d) => s + d.pctOfTotal, 0);
    assert('Sum of pctOfTotal ≈ 100', Math.abs(pctSum - 100) < 0.5,
      `Got ${pctSum.toFixed(2)}`);

    // limit param
    res = await api.get('/api/inventory/analytics/by-product?limit=1', { headers: h });
    assert('limit=1 respected', res.data.data.length === 1, `Got ${res.data.data.length}`);

    // ─── Test 12: /by-size ───
    logger.info('\nTest 12: /by-size');
    res = await api.get('/api/inventory/analytics/by-size', { headers: h });
    assert('by-size 200', res.status === 200);
    assert('Has thicknessMM + sizeDisplay fields',
      res.data.data.every(d =>
        ('thicknessMM' in d) && ('sizeDisplay' in d) && typeof d.sheets === 'number'));

    // ─── Test 13-14: /by-grade ───
    logger.info('\nTest 13-14: /by-grade');
    res = await api.get('/api/inventory/analytics/by-grade', { headers: h });
    assert('by-grade 200', res.status === 200);
    assert('Returns all active grades (even zero-consumption)',
      res.data.data.length >= 1 &&
      res.data.data.every(g => g.code && g.label && ('sheets' in g)));
    const gradePctSum = res.data.data.reduce((s, g) => s + g.pctOfTotal, 0);
    // pctOfTotal sums to ~100 across grades that have consumption — zero-consumption grades contribute 0
    assert('Sum of grade pctOfTotal ≈ 100', Math.abs(gradePctSum - 100) < 0.5,
      `Got ${gradePctSum.toFixed(2)}`);

    // ─── Test 15-16: /bundles ───
    logger.info('\nTest 15-16: /bundles');
    res = await api.get('/api/inventory/analytics/bundles', { headers: h });
    assert('bundles 200', res.status === 200);
    assert('Each entry has expected shape',
      res.data.data.every(d =>
        ('productId' in d) && ('currentBundles' in d) && ('avgBundlesPerMonth' in d) &&
        ('projectedDepletion' in d)));
    const zeroBundlesEntries = res.data.data.filter(d => d.avgBundlesPerMonth === 0);
    assert('projectedDepletion = null when avgBundlesPerMonth = 0',
      zeroBundlesEntries.every(d => d.projectedDepletion === null));

    // ─── Test 17-20: /dashboard ───
    logger.info('\nTest 17-20: /dashboard');
    // Use explicit date range so cache key is deterministic
    const dashFrom = new Date(now - 60 * MS_DAY).toISOString();
    const dashTo = new Date(now - 1 * MS_DAY).toISOString();
    const dashUrl = `/api/inventory/analytics/dashboard?dateFrom=${dashFrom}&dateTo=${dashTo}`;

    // First clear cache so we start fresh
    const ctrl = require('../src/controllers/inventoryAnalytics.controller');
    ctrl._clearCache();

    res = await api.get(dashUrl, { headers: h });
    assert('dashboard 200', res.status === 200);
    assert('Dashboard has composite shape (summary + top5 + recentTrend + monthlyTrend)',
      res.data.summary && res.data.top5Products && res.data.recentTrend && res.data.monthlyTrend);
    assert('summary.totalSheetsConsumed populated',
      typeof res.data.summary?.totalSheetsConsumed === 'number' &&
      res.data.summary.totalSheetsConsumed >= 300);
    assert('top5Products limited to 5 max',
      res.data.top5Products.length <= 5);
    assert('monthlyTrend has 12 entries',
      Array.isArray(res.data.monthlyTrend) && res.data.monthlyTrend.length === 12);
    assert('First call NOT cached', res.data.cached === false);

    // Test 21: caching
    logger.info('\nTest 21: /dashboard caching (second call → cached:true)');
    res = await api.get(dashUrl, { headers: h });
    assert('Second call cached=true', res.data.cached === true);

    // ─── Test 22: empty date range returns empty arrays (not error) ───
    logger.info('\nTest 22: empty data range');
    const ancientFrom = new Date('2020-01-01').toISOString();
    const ancientTo = new Date('2020-01-31').toISOString();
    res = await api.get(
      `/api/inventory/analytics/consumption?dateFrom=${ancientFrom}&dateTo=${ancientTo}`,
      { headers: h }
    );
    assert('Empty range → 200 + empty array',
      res.status === 200 && Array.isArray(res.data.data) && res.data.data.length === 0);

    // ─── Test 23: from > to → 400 ───
    logger.info('\nTest 23: invalid date range (from > to)');
    res = await api.get(
      `/api/inventory/analytics/consumption?dateFrom=${dashTo}&dateTo=${dashFrom}`,
      { headers: h }
    );
    assert('from>to → 400', res.status === 400, `Got ${res.status}`);

    // ─── Test 24: cleanup count matches ───
    logger.info('\nCleanup');
    const beforeCleanup = await StockMovement.countDocuments({ reason: { $regex: TAG } });
    await cleanup();
    const afterCleanup = await StockMovement.countDocuments({ reason: { $regex: TAG } });
    assert('All seeded movements deleted',
      beforeCleanup === moves.length && afterCleanup === 0,
      `Before=${beforeCleanup} After=${afterCleanup} Seeded=${moves.length}`);

    await mongoose.disconnect();

    logger.info('\n═══════════════════════════════════════');
    logger.info(`📊 Inventory Analytics (Section B): ${pass}/${pass + fail} passed`);
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
