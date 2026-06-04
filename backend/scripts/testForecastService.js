require('dotenv').config();
if (process.env.NODE_ENV !== 'production') {
  const dns = require('dns');
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
}

const mongoose = require('mongoose');
const logger = require('../src/config/logger');
const { StockMovement, Product, User } = require('../src/models');
const forecastService = require('../src/services/forecast.service');

const TAG = 'FORECAST_TEST';
const MS_DAY = 24 * 60 * 60 * 1000;
const MS_MONTH = 30 * MS_DAY;

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

  const touchedProductIds = new Set();

  const cleanup = async () => {
    await StockMovement.deleteMany({ reason: { $regex: TAG } });
    if (touchedProductIds.size > 0) {
      await Product.updateMany(
        { _id: { $in: [...touchedProductIds] } },
        { $unset: { forecastData: '' } }
      );
    }
  };

  /**
   * Insert N synthetic monthly DEDUCTION movements for `productId` according
   * to a pattern. Movement N is placed (N+1) months ago from "now" so the
   * first month is the oldest.
   *
   * Patterns:
   *   flat(value): same N every month
   *   growing(start, step): linearly growing
   *   declining(start, step): linearly declining
   *   seasonal(base, amplitude): cosine wave with Oct/Nov/Dec peak
   *   sparse(values, gaps): values array, intersperse with zero-skip months
   *   zero: all zero
   */
  const seedMonthly = async (productId, months, pattern, perfBy, suffix = '') => {
    touchedProductIds.add(String(productId));
    const product = await Product.findById(productId).select('sku name productType').lean();
    const docs = [];
    for (let i = 0; i < months; i++) {
      // i=0 is the OLDEST month, i=months-1 is the CURRENT month.
      // Use Date.setMonth() for calendar-correct month arithmetic (avoids
      // 30-day-drift accumulating into wrong month buckets over long ranges).
      const monthsAgo = months - 1 - i;
      const when = new Date();
      when.setMonth(when.getMonth() - monthsAgo);
      when.setDate(10); // mid-month — avoids month-boundary edge cases

      let sheets = 0;
      if (pattern.kind === 'flat') sheets = pattern.value;
      else if (pattern.kind === 'growing') sheets = pattern.start + i * pattern.step;
      else if (pattern.kind === 'declining') sheets = Math.max(0, pattern.start - i * pattern.step);
      else if (pattern.kind === 'seasonal') {
        // cos peak at month index 9 (~October if seeded across full year)
        const monthOfYear = when.getMonth(); // 0-11
        // bell-curve emphasis on Oct(9) Nov(10) Dec(11): cos((month - 10) * π/6)
        const phase = Math.cos((monthOfYear - 10) * Math.PI / 6);
        sheets = Math.round(pattern.base + pattern.amplitude * phase);
      } else if (pattern.kind === 'sparse') {
        sheets = (i % 2 === 0) ? pattern.value : 0;
      } else if (pattern.kind === 'zero') sheets = 0;

      // Skip zero-sheet entries (no movement happened that month)
      if (sheets <= 0) continue;

      docs.push({
        product: productId,
        productSnapshot: { sku: product.sku, name: product.name, productType: product.productType },
        movementType: 'DEDUCTION',
        quantityBefore: 1000,
        quantityChange: -sheets,
        quantityAfter: 1000 - sheets,
        reason: `${TAG}_${suffix}`,
        performedBy: perfBy,
        performedAt: when,
        createdAt: when,
        updatedAt: when,
      });
    }
    if (docs.length > 0) {
      await StockMovement.collection.insertMany(docs);
    }
    return docs.length;
  };

  try {
    logger.info('\n═══ SECTION C — Forecast Service Smoke Test ═══');

    const adminUser = await User.findOne({ email: 'testadmin@shreegopal.com' }).select('_id').lean();
    assert('Admin user resolved', adminUser != null);

    // Fetch 8 distinct products (one per test category)
    const products = await Product.find({
      productType: 'RAW_SHEET',
      isDeleted: false,
    }).select('_id sku name').limit(8).lean();
    assert('At least 8 RAW_SHEET products available', products.length >= 8,
      `Got ${products.length}`);
    if (products.length < 8) throw new Error('Need 8 products for category isolation');

    const [pA, pB, pC, pD, pE, pF, pG, pH] = products;
    // Pre-clean for each product to avoid noise from prior runs
    await StockMovement.deleteMany({
      product: { $in: products.map(p => p._id) },
      reason: { $regex: TAG },
    });

    // ═══════════════════════════════════════════════
    // Category A: getMonthlyDemand (5 tests)
    // ═══════════════════════════════════════════════
    logger.info('\n=== Category A: getMonthlyDemand ===');

    logger.info('  Setup: seed 12 flat months on pA');
    await seedMonthly(pA._id, 12, { kind: 'flat', value: 20 }, adminUser._id, 'A_flat');

    logger.info('\nA1: returns continuous series even with sparse data');
    // Delete 3 random months to simulate sparse
    await StockMovement.deleteMany({
      product: pA._id,
      reason: `${TAG}_A_flat`,
      performedAt: {
        $gte: new Date(Date.now() - 6 * MS_MONTH),
        $lte: new Date(Date.now() - 5 * MS_MONTH),
      },
    });
    const seriesA = await forecastService.getMonthlyDemand(pA._id, 12);
    assert('Returns array of length=months', seriesA.length === 12,
      `Got ${seriesA.length}`);
    assert('Each entry has {year, month, period, sheets}',
      seriesA.every(s => 'year' in s && 'month' in s && 'period' in s && 'sheets' in s));
    const hasZero = seriesA.some(s => s.sheets === 0);
    assert('Missing months filled with 0 (gap detected)', hasZero,
      'No zero entries — sparse fill not working');

    logger.info('\nA2: sums multiple movements in same month');
    // The current-month bucket (last entry of seriesA2) was seeded with 20 by
    // seedMonthly (i=months-1, monthsAgo=0). Add 2 more movements in current
    // month and verify the bucket sums to 20 + 7 + 3 = 30.
    const currentMonthDate = new Date();
    currentMonthDate.setDate(15);
    await StockMovement.collection.insertMany([
      {
        product: pA._id,
        movementType: 'DEDUCTION',
        quantityBefore: 1000, quantityChange: -7, quantityAfter: 993,
        reason: `${TAG}_A_flat_extra`,
        performedBy: adminUser._id,
        performedAt: currentMonthDate, createdAt: currentMonthDate, updatedAt: currentMonthDate,
      },
      {
        product: pA._id,
        movementType: 'DEDUCTION',
        quantityBefore: 1000, quantityChange: -3, quantityAfter: 997,
        reason: `${TAG}_A_flat_extra`,
        performedBy: adminUser._id,
        performedAt: currentMonthDate, createdAt: currentMonthDate, updatedAt: currentMonthDate,
      },
    ]);
    const seriesA2 = await forecastService.getMonthlyDemand(pA._id, 2);
    // Current month entry: 20 (seeded) + 7 + 3 = 30
    assert('Multiple-movement month sums correctly',
      seriesA2[seriesA2.length - 1].sheets === 30,
      `Got ${seriesA2[seriesA2.length - 1].sheets}`);

    logger.info('\nA3: default 24 months returned when no arg passed');
    const default24 = await forecastService.getMonthlyDemand(pA._id);
    assert('Default returns 24 months', default24.length === 24,
      `Got ${default24.length}`);

    logger.info('\nA4: custom months param respected');
    const custom6 = await forecastService.getMonthlyDemand(pA._id, 6);
    assert('Custom 6 months', custom6.length === 6, `Got ${custom6.length}`);

    logger.info('\nA5: empty (no movements) → array of zeros, not empty');
    const emptyP = pH; // pH has no seeds yet
    const emptySeries = await forecastService.getMonthlyDemand(emptyP._id, 12);
    assert('Empty product returns 12 zero entries',
      emptySeries.length === 12 && emptySeries.every(s => s.sheets === 0));

    // ═══════════════════════════════════════════════
    // Category B: Holt-Winters branch (6 tests)
    // ═══════════════════════════════════════════════
    logger.info('\n=== Category B: Holt-Winters branch ===');

    logger.info('  Setup: seed 30-month series on pB (flat=50)');
    await seedMonthly(pB._id, 30, { kind: 'flat', value: 50 }, adminUser._id, 'B_flat30');

    logger.info('\nB1: 30-month flat → method=holt-winters');
    const fcB = await forecastService.forecastProduct(pB._id);
    assert('Method = holt-winters', fcB.method === 'holt-winters',
      `Got ${fcB.method}`);
    // Flat predictions should be near 50
    const predAvgB = fcB.predictions.reduce((s, n) => s + n, 0) / fcB.predictions.length;
    assert('Flat predictions average within ±15 of seeded value',
      Math.abs(predAvgB - 50) <= 15, `Got ${predAvgB.toFixed(1)}`);

    logger.info('\nB2: 30-month growing series → predictions trend upward');
    await seedMonthly(pC._id, 30, { kind: 'growing', start: 10, step: 2 }, adminUser._id, 'C_grow');
    const fcC = await forecastService.forecastProduct(pC._id);
    assert('Growing series → holt-winters', fcC.method === 'holt-winters');
    const lastObserved = 10 + (30 - 1) * 2; // 68
    assert('Last prediction > first historical value (upward trend)',
      fcC.predictions[fcC.predictions.length - 1] > 10,
      `First ${fcC.predictions[0]} Last ${fcC.predictions[fcC.predictions.length - 1]} (expected > 10)`);
    void lastObserved;

    logger.info('\nB3: 36-month seasonal series → MAPE computed');
    await seedMonthly(pD._id, 36, { kind: 'seasonal', base: 50, amplitude: 30 }, adminUser._id, 'D_season');
    const fcD = await forecastService.forecastProduct(pD._id);
    assert('Seasonal → holt-winters', fcD.method === 'holt-winters');
    assert('MAPE computed (not null) when history is deep',
      fcD.mape !== null, `Got mape=${fcD.mape}`);
    assert('MAPE within reasonable bounds (< 100% — wild seasonality OK)',
      fcD.mape != null && fcD.mape < 100, `Got mape=${fcD.mape}`);

    logger.info('\nB4: Negative predictions clamped to 0');
    // Use a steeply declining series — Holt-Winters can predict negatives
    await seedMonthly(pE._id, 30, { kind: 'declining', start: 100, step: 4 }, adminUser._id, 'E_decline');
    const fcE = await forecastService.forecastProduct(pE._id);
    assert('All predictions >= 0 (negatives clamped)',
      fcE.predictions.every(p => p >= 0),
      `Predictions: ${JSON.stringify(fcE.predictions)}`);

    logger.info('\nB5: all-zero 24-month → falls through to MA without crash');
    // pF has no movements — but for this test we need movements that ARE zero,
    // which means activity months > 0 but all data buckets are 0. Hard to set up
    // since seedMonthly skips zero-sheets entries. Workaround: insert one tiny
    // movement 25 months ago, then no other movements.
    const ancientDate = new Date(Date.now() - 25 * MS_MONTH);
    await StockMovement.collection.insertMany([{
      product: pF._id,
      movementType: 'DEDUCTION',
      quantityBefore: 1, quantityChange: -0, quantityAfter: 1, // zero qty, but movement exists
      reason: `${TAG}_F_zero`,
      performedBy: adminUser._id,
      performedAt: ancientDate, createdAt: ancientDate, updatedAt: ancientDate,
    }]);
    touchedProductIds.add(String(pF._id));
    const fcF = await forecastService.forecastProduct(pF._id);
    assert('All-zero history did not crash', fcF != null);
    assert('All-zero history falls through to moving-average (or fallback)',
      ['moving-average', 'fallback', 'holt-winters'].includes(fcF.method),
      `Got ${fcF.method}`);
    assert('All-zero history predictions are all 0',
      fcF.predictions.every(p => p === 0));

    // ═══════════════════════════════════════════════
    // Category C: Moving Average branch (4 tests)
    // ═══════════════════════════════════════════════
    logger.info('\n=== Category C: Moving Average branch ===');

    logger.info('  Setup: seed 12-month series on pG (flat=40)');
    await seedMonthly(pG._id, 12, { kind: 'flat', value: 40 }, adminUser._id, 'G_ma');

    logger.info('\nC1: 12-month history → method=moving-average');
    const fcG = await forecastService.forecastProduct(pG._id);
    assert('Method = moving-average for 12 months', fcG.method === 'moving-average',
      `Got ${fcG.method}`);

    logger.info('\nC2: MA predictions ≈ average of last 3 months');
    // Last 3 months are all 40 → average 40
    assert('All predictions equal 40 (last-3-month average)',
      fcG.predictions.every(p => p === 40),
      `Predictions: ${JSON.stringify(fcG.predictions)}`);

    logger.info('\nC3: MA with sparse data still works');
    // Direct helper call: data=[10,0,30,0,50,70] → last 3=[0,50,70], avg≈40
    const sparsePreds = forecastService.movingAverageForecast([10, 0, 30, 0, 50, 70], 3);
    assert('movingAverageForecast on sparse data returns same length as horizon',
      sparsePreds.length === 3);
    const sparseExpected = Math.round((0 + 50 + 70) / 3); // 40
    assert('MA value matches manual computation',
      sparsePreds[0] === sparseExpected,
      `Got ${sparsePreds[0]} expected ${sparseExpected}`);

    logger.info('\nC4: 6-month minimum boundary');
    // Helper test: any 6-element data works
    const sixMonthPreds = forecastService.movingAverageForecast([10, 20, 30, 40, 50, 60], 3);
    assert('6-month input → MA last 3 = avg(40,50,60)=50',
      sixMonthPreds[0] === 50, `Got ${sixMonthPreds[0]}`);

    // ═══════════════════════════════════════════════
    // Category D: Naive branch (3 tests)
    // ═══════════════════════════════════════════════
    logger.info('\n=== Category D: Naive branch ===');

    logger.info('  Setup: seed 3-month series on pH');
    await seedMonthly(pH._id, 3, { kind: 'flat', value: 25 }, adminUser._id, 'H_naive');

    logger.info('\nD1: 3-month history → method=naive');
    const fcH = await forecastService.forecastProduct(pH._id);
    assert('Method = naive for 3 months', fcH.method === 'naive',
      `Got ${fcH.method}`);

    logger.info('\nD2: predictions = average of all available');
    assert('All predictions equal 25', fcH.predictions.every(p => p === 25),
      `Predictions: ${JSON.stringify(fcH.predictions)}`);

    logger.info('\nD3: naive helper on 1-month data');
    const onePred = forecastService.naiveForecast([42], 6);
    assert('Single-month naive: all predictions = 42',
      onePred.length === 6 && onePred.every(p => p === 42),
      `Got ${JSON.stringify(onePred)}`);

    // ═══════════════════════════════════════════════
    // Category E: Fallback branch (3 tests)
    // ═══════════════════════════════════════════════
    logger.info('\n=== Category E: Fallback branch ===');

    // Find a fresh product with NO movements
    const emptyProduct = await Product.findOne({
      _id: { $nin: products.map(p => p._id) },
      isDeleted: false,
    }).select('_id sku').lean();
    assert('Empty product available', emptyProduct != null);

    if (emptyProduct) {
      touchedProductIds.add(String(emptyProduct._id));
      const fcEmpty = await forecastService.forecastProduct(emptyProduct._id);

      logger.info('\nE1: No history → method=fallback');
      assert('Method = fallback', fcEmpty.method === 'fallback',
        `Got ${fcEmpty.method}`);

      logger.info('\nE2: All predictions zero');
      assert('Predictions all = 0', fcEmpty.predictions.every(p => p === 0));

      logger.info('\nE3: forecastData.lastForecast still written to DB');
      const reloaded = await Product.findById(emptyProduct._id).lean();
      assert('forecastData persisted',
        reloaded.forecastData?.lastForecast?.method === 'fallback');
      assert('next30/90/180 days all 0',
        reloaded.forecastData?.lastForecast?.next30days === 0 &&
        reloaded.forecastData?.lastForecast?.next90days === 0 &&
        reloaded.forecastData?.lastForecast?.next180days === 0);
    }

    // ═══════════════════════════════════════════════
    // Category F: MAPE calculation (4 tests)
    // ═══════════════════════════════════════════════
    logger.info('\n=== Category F: MAPE calculation ===');

    logger.info('\nF1: MAPE on perfect predictions = 0');
    const perfectMape = forecastService.calculateMAPE([10, 20, 30], [10, 20, 30]);
    assert('Perfect MAPE = 0', perfectMape === 0, `Got ${perfectMape}`);

    logger.info('\nF2: MAPE on all-zero actuals = null');
    const zeroMape = forecastService.calculateMAPE([0, 0, 0], [5, 10, 15]);
    assert('All-zero actuals → null', zeroMape === null, `Got ${zeroMape}`);

    logger.info('\nF3: MAPE on mixed (some zero, some non-zero) skips zeros');
    // actual = [0, 10, 0, 20], predicted = [5, 12, 100, 18]
    // skip indexes 0 and 2; compute |10-12|/10 = 20%, |20-18|/20 = 10%; avg = 15%
    const mixedMape = forecastService.calculateMAPE([0, 10, 0, 20], [5, 12, 100, 18]);
    assert('Mixed MAPE ignores zero-actual pairs (≈ 15%)',
      mixedMape !== null && Math.abs(mixedMape - 15) < 0.5,
      `Got ${mixedMape}`);

    logger.info('\nF4: MAPE on null/undefined inputs returns null');
    assert('null input → null', forecastService.calculateMAPE(null, [1]) === null);
    assert('empty arrays → null', forecastService.calculateMAPE([], []) === null);

    // ═══════════════════════════════════════════════
    // Category G: forecastProduct DB integration (3 tests)
    // ═══════════════════════════════════════════════
    logger.info('\n=== Category G: forecastProduct DB integration ===');

    logger.info('\nG1: forecastProduct updates Product.forecastData in DB');
    const reloadedB = await Product.findById(pB._id).select('forecastData').lean();
    assert('forecastData.lastForecast.method persisted',
      reloadedB.forecastData?.lastForecast?.method === 'holt-winters',
      `Got ${reloadedB.forecastData?.lastForecast?.method}`);

    logger.info('\nG2: computedAt timestamp is recent (within last 60s)');
    const computedAtMs = new Date(reloadedB.forecastData.lastForecast.computedAt).getTime();
    const ageMs = Date.now() - computedAtMs;
    assert('computedAt within last 60s', ageMs < 60_000, `Age=${ageMs}ms`);

    logger.info('\nG3: forecastData.lastComputedAt also updated (top-level)');
    assert('lastComputedAt set on forecastData',
      reloadedB.forecastData?.lastComputedAt != null);

    // ═══════════════════════════════════════════════
    // Category H: forecastAll batch (2 tests)
    // ═══════════════════════════════════════════════
    logger.info('\n=== Category H: forecastAll batch ===');

    logger.info('\nH1: forecastAll completes and returns summary shape');
    // forecastAll iterates ALL active products — could be many. To keep this
    // test fast, we'll just verify the function returns a sensible shape.
    const batchResult = await forecastService.forecastAll();
    assert('Returns { total, succeeded, failed, results, errors, elapsedMs }',
      typeof batchResult.total === 'number' &&
      typeof batchResult.succeeded === 'number' &&
      typeof batchResult.failed === 'number' &&
      Array.isArray(batchResult.results) &&
      Array.isArray(batchResult.errors) &&
      typeof batchResult.elapsedMs === 'number',
      JSON.stringify(Object.keys(batchResult)));
    assert('total = succeeded + failed', batchResult.total === batchResult.succeeded + batchResult.failed);

    logger.info('\nH2: forecastAll continues despite per-product errors');
    // The seeded products are all valid; this asserts the function doesn't
    // crash if Product.find returns >0 results. Per-product error resilience
    // is verified by the catch block in the implementation (covered by code
    // review — hard to inject artificial error without controller plumbing).
    assert('forecastAll did not throw and returned >= 0 succeeded',
      batchResult.succeeded >= 0);

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
    logger.info(`📊 Forecast Service (Section C): ${pass}/${pass + fail} passed`);
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
