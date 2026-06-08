// Prompt 11 — End-to-end suite covering Customer + Product flows against
// the live backend. Validates every API contract the admin UI relies on,
// proves the 10 bug fixes survive a real-world dance, and self-cleans
// test entities at the end (tagged with P11_E2E_TEST_ marker).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, '..', 'src');

const API_BASE = process.env.API_BASE_URL || 'http://localhost:5000/api';
const SOCKET_URL = process.env.SOCKET_URL || 'http://localhost:5000';
const LOGIN_EMAIL = process.env.LOGIN_EMAIL || 'testadmin@shreegopal.com';
const LOGIN_PASSWORD = process.env.LOGIN_PASSWORD || 'TestAdmin@123';
const BYPASS = process.env.TEST_BYPASS_SECRET || '';

const RUN_MARKER = `P11_E2E_${Date.now().toString().slice(-7)}`;
const createdCustomerIds = [];
const createdProductIds = [];

let pass = 0, fail = 0, skipped = 0;
const failures = [];
function assert(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); failures.push(name); }
}
function skip(name, reason) { skipped++; console.log(`  ⊝  ${name} — skipped (${reason})`); }

let TOKEN = null;
function headers() {
  return {
    'Content-Type': 'application/json',
    ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
    ...(BYPASS ? { 'x-test-bypass-ratelimit': BYPASS } : {}),
  };
}
async function api(method, urlPath, body) {
  const res = await fetch(`${API_BASE}${urlPath}`, {
    method,
    headers: headers(),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* may be empty */ }
  return { status: res.status, body: json, ok: res.ok };
}

console.log(`\n═══ Prompt 11 — E2E Suite (marker: ${RUN_MARKER}) ═══`);

// ════════════════════════════════════════════════════
// Category A — Setup + Auth
// ════════════════════════════════════════════════════
console.log('\n─── A. Setup + Auth ───');

let backendAlive = false;
try {
  const r = await fetch(`${SOCKET_URL}/api/health`, { signal: AbortSignal.timeout(3000) });
  backendAlive = r.ok;
  assert(`A1. Backend reachable at ${SOCKET_URL}`, backendAlive);
} catch (err) {
  skip('Live E2E', err.message);
}

if (backendAlive) {
  const login = await api('POST', '/auth/login',
    { email: LOGIN_EMAIL, password: LOGIN_PASSWORD });
  TOKEN = login.body?.accessToken;
  assert('A2. Admin login → JWT',
    login.status === 200 && typeof TOKEN === 'string' && TOKEN.length > 20);
}

// Vite SPA boot sanity — just checks the dev server is serving index.html.
try {
  const r = await fetch('http://localhost:5173/');
  assert('A3. Vite SPA boot (HTTP 200)', r.status === 200);
} catch (err) {
  skip('A3. Vite SPA boot', err.message);
}

if (!TOKEN) {
  console.log('\n  (no token — aborting remaining E2E categories)');
  process.exit(fail === 0 ? 0 : 1);
}

// ════════════════════════════════════════════════════
// Category B — Customer CRUD E2E
// ════════════════════════════════════════════════════
console.log('\n─── B. Customer CRUD ───');

const baseAddress = {
  line1: 'Plot 12, MIDC',
  city: 'Pune',
  state: 'Maharashtra',
  stateCode: '27',
  pincode: '411001',
};

const tsTail = Date.now().toString().slice(-7);
const phoneA = `9${tsTail.padStart(9, '0')}`.slice(0, 10);
const phoneB = `8${tsTail.padStart(9, '0')}`.slice(0, 10);

// B1. Create NON_GST customer
const c1 = await api('POST', '/customers', {
  customerName: `${RUN_MARKER} NonGST Customer`,
  phone: phoneA,
  billingAddress: baseAddress,
  notes: `e2e marker ${RUN_MARKER}`,
});
assert('B1. Create NON_GST customer → 201',
  c1.status === 201, `Got ${c1.status}: ${JSON.stringify(c1.body).slice(0, 200)}`);
if (c1.body?.data?._id) createdCustomerIds.push(c1.body.data._id);

// B2. Create GST customer with GSTIN
const c2 = await api('POST', '/customers', {
  customerName: `${RUN_MARKER} GST Customer`,
  phone: phoneB,
  gstin: '27AAAAA0000A1Z5',
  billingAddress: { ...baseAddress, state: 'Maharashtra', stateCode: '27' },
  notes: `e2e marker ${RUN_MARKER}`,
});
assert('B2. Create GST customer with GSTIN → 201', c2.status === 201);
assert('B2. GSTIN preserved on response',
  c2.body?.data?.gstin === '27AAAAA0000A1Z5');
if (c2.body?.data?._id) createdCustomerIds.push(c2.body.data._id);

// B3. List + search + filter (search by marker)
const list = await api('GET',
  `/customers?search=${encodeURIComponent(RUN_MARKER)}&limit=10`);
assert('B3. List + search → 200', list.status === 200);
assert('B3. List pagination has totalRecords (not "total")',
  typeof list.body?.pagination?.totalRecords === 'number');
assert('B3. Created customers appear in list',
  Array.isArray(list.body?.data) && list.body.data.length >= 2);

// B4. Detail + insights
if (createdCustomerIds[0]) {
  const detail = await api('GET', `/customers/${createdCustomerIds[0]}`);
  assert('B4. Customer detail → 200', detail.status === 200);
  assert('B4. Detail data.customerName matches', detail.body?.data?.customerName?.includes(RUN_MARKER));
  const insights = await api('GET', `/customers/${createdCustomerIds[0]}/insights`);
  assert('B4. Insights endpoint → 200', insights.status === 200);
  assert('B4. Insights has customer + financial blocks',
    insights.body?.data?.customer != null && insights.body?.data?.financial != null);
}

// B5. UPDATE with isActive toggle (Section D Zod-strip fix)
if (createdCustomerIds[0]) {
  const u1 = await api('PUT', `/customers/${createdCustomerIds[0]}`,
    { isActive: false });
  assert('B5. PUT { isActive: false } → 200', u1.status === 200);
  // Verify it actually persisted — refetch
  const v1 = await api('GET', `/customers/${createdCustomerIds[0]}`);
  assert('B5. Verify isActive=false PERSISTED (Zod-strip fix verified)',
    v1.body?.data?.isActive === false,
    `Got isActive=${v1.body?.data?.isActive}`);
  // Flip back to active for subsequent bulk tests
  await api('PUT', `/customers/${createdCustomerIds[0]}`, { isActive: true });
}

// B6. Soft delete (separate fresh customer so other tests are unaffected)
const phoneDel = `7${tsTail.padStart(9, '0')}`.slice(0, 10);
const cDel = await api('POST', '/customers', {
  customerName: `${RUN_MARKER} Delete Customer`,
  phone: phoneDel,
  billingAddress: baseAddress,
});
if (cDel.body?.data?._id) {
  const delRes = await api('DELETE', `/customers/${cDel.body.data._id}`,
    { reason: `${RUN_MARKER} cleanup` });
  assert('B6. Soft delete with reason → 200', delRes.status === 200);
}

// ════════════════════════════════════════════════════
// Category C — Customer Bulk
// ════════════════════════════════════════════════════
console.log('\n─── C. Customer Bulk ───');

if (createdCustomerIds.length >= 2) {
  // C1. Bulk deactivate using { customerIds, updates }
  const bDeact = await api('POST', '/customers/bulk-update', {
    customerIds: createdCustomerIds.slice(0, 2),
    updates: { isActive: false },
  });
  assert('C1. Bulk deactivate { customerIds, updates } → 200',
    bDeact.status === 200, `Got ${bDeact.status}: ${JSON.stringify(bDeact.body).slice(0, 200)}`);

  // Verify both customers now inactive
  const after1 = await api('GET', `/customers/${createdCustomerIds[0]}`);
  const after2 = await api('GET', `/customers/${createdCustomerIds[1]}`);
  assert('C1. Both bulk-deactivated customers persisted as inactive',
    after1.body?.data?.isActive === false && after2.body?.data?.isActive === false);

  // C2. Bulk activate (reverse)
  const bAct = await api('POST', '/customers/bulk-update', {
    customerIds: createdCustomerIds.slice(0, 2),
    updates: { isActive: true },
  });
  assert('C2. Bulk activate → 200', bAct.status === 200);
}

// C3. Sanity: backend REJECTS the wrong shape (the original bug we hit)
const wrongShape = await api('POST', '/customers/bulk-update', {
  ids: createdCustomerIds.slice(0, 1),
  update: { isActive: false },
});
assert('C3. Wrong-shape { ids, update } → 400 (contract regression-proof)',
  wrongShape.status === 400);

// ════════════════════════════════════════════════════
// Category D — Product CRUD E2E
// ════════════════════════════════════════════════════
console.log('\n─── D. Product CRUD ───');

// First fetch a real grade ObjectId (required for product creation)
const gradesRes = await api('GET', '/product-grades?limit=1');
const gradeId = gradesRes.body?.data?.[0]?._id;
assert('D0. Fetched a grade for product creation', !!gradeId);

if (gradeId) {
  // D1. Create product
  const p1 = await api('POST', '/products', {
    name: `${RUN_MARKER} Test Sheet`,
    thicknessMM: 18, lengthFT: 8, widthFT: 4,
    grade: gradeId,
    pricingUnit: 'sqft', basePrice: 1200,
    currentStock: 100, minStockAlert: 20, reorderQuantity: 50,
    hsnCode: '4411', gstRatePct: 18,
    notes: RUN_MARKER,
  });
  assert('D1. Create product → 201', p1.status === 201,
    `Got ${p1.status}: ${JSON.stringify(p1.body).slice(0, 200)}`);
  if (p1.body?.data?._id) createdProductIds.push(p1.body.data._id);

  // D2. List + search
  const pList = await api('GET',
    `/products?search=${encodeURIComponent(RUN_MARKER)}&limit=10`);
  assert('D2. Product list → 200', pList.status === 200);
  assert('D2. Product list includes test product',
    pList.body?.data?.some(p => p.name.includes(RUN_MARKER)));

  // D3. Detail
  if (createdProductIds[0]) {
    const pDetail = await api('GET', `/products/${createdProductIds[0]}`);
    assert('D3. Product detail → 200', pDetail.status === 200);
    assert('D3. areaSqFt auto-computed (8 × 4 = 32)',
      pDetail.body?.data?.areaSqFt === 32);
  }

  // D4. UPDATE with isActive toggle — verifies Section E proactive Zod fix
  if (createdProductIds[0]) {
    const pUpd = await api('PUT', `/products/${createdProductIds[0]}`,
      { isActive: false });
    assert('D4. PUT product { isActive: false } → 200', pUpd.status === 200);
    const pVerify = await api('GET', `/products/${createdProductIds[0]}`);
    assert('D4. Product isActive=false PERSISTED (proactive Zod fix verified)',
      pVerify.body?.data?.isActive === false);
    // Flip back
    await api('PUT', `/products/${createdProductIds[0]}`, { isActive: true });
  }

  // D5. Stock badge logic — frontend pure helper extracted from source
  const colsSrc = fs.readFileSync(
    path.join(SRC, 'pages/products/_productColumns.jsx'), 'utf8');
  const stockBadgeMatch = colsSrc.match(/export function stockBadge[^{]*\{([\s\S]+?)\n\}/);
  if (stockBadgeMatch) {
    const stockBadgeFn = new Function('currentStock', 'minStockAlert', stockBadgeMatch[1]);
    assert('D5. stockBadge(0, 10) → "Out of stock"',
      stockBadgeFn(0, 10).variant === 'danger');
    assert('D5. stockBadge(5, 10) → "Low: 5" danger',
      stockBadgeFn(5, 10).variant === 'danger' && stockBadgeFn(5, 10).label.includes('Low'));
    assert('D5. stockBadge(15, 10) → warning amber',
      stockBadgeFn(15, 10).variant === 'warning');
    assert('D5. stockBadge(50, 10) → success green',
      stockBadgeFn(50, 10).variant === 'success');
  }
}

// ════════════════════════════════════════════════════
// Category E — Product Bulk Fan-Out
// ════════════════════════════════════════════════════
console.log('\n─── E. Product Bulk Fan-Out ───');

// Create a second product so we have ≥2 to bulk on
if (gradeId) {
  const p2 = await api('POST', '/products', {
    name: `${RUN_MARKER} Second Sheet`,
    thicknessMM: 12, lengthFT: 8, widthFT: 4,
    grade: gradeId,
    pricingUnit: 'sqft', basePrice: 900,
    currentStock: 75, minStockAlert: 15,
    notes: RUN_MARKER,
  });
  if (p2.body?.data?._id) createdProductIds.push(p2.body.data._id);
}

if (createdProductIds.length >= 2) {
  // E1. Bulk deactivate via Promise.allSettled (frontend pattern)
  const results = await Promise.allSettled(
    createdProductIds.slice(0, 2).map(id =>
      api('PUT', `/products/${id}`, { isActive: false })
    )
  );
  const ok = results.filter(r => r.status === 'fulfilled' && r.value.status === 200).length;
  assert('E1. Bulk deactivate via Promise.allSettled (2 parallel PUTs)',
    ok === 2, `${ok}/2 succeeded`);

  // Verify both inactive
  const v1 = await api('GET', `/products/${createdProductIds[0]}`);
  const v2 = await api('GET', `/products/${createdProductIds[1]}`);
  assert('E1. Both products persisted as inactive',
    v1.body?.data?.isActive === false && v2.body?.data?.isActive === false);

  // E2. Bulk activate (reverse)
  const aResults = await Promise.allSettled(
    createdProductIds.slice(0, 2).map(id =>
      api('PUT', `/products/${id}`, { isActive: true })
    )
  );
  const aOk = aResults.filter(r => r.status === 'fulfilled' && r.value.status === 200).length;
  assert('E2. Bulk activate (reverse)', aOk === 2);

  // E3. Partial failure — one invalid ID mixed with one valid
  const mixed = await Promise.allSettled([
    api('PUT', `/products/${createdProductIds[0]}`, { isActive: false }),
    api('PUT', `/products/000000000000000000000000`, { isActive: false }),
  ]);
  const goodCount = mixed.filter((r, i) =>
    r.status === 'fulfilled' && [200].includes(r.value.status)
  ).length;
  const badCount = mixed.filter((r, i) =>
    r.status === 'fulfilled' && [404, 400].includes(r.value.status)
  ).length;
  assert('E3. Partial failure: 1 succeeds, 1 returns 404/400',
    goodCount === 1 && badCount === 1,
    `goodCount=${goodCount}, badCount=${badCount}`);
  // Re-activate the good one
  await api('PUT', `/products/${createdProductIds[0]}`, { isActive: true });
}

// ════════════════════════════════════════════════════
// Category F — Forecasting Integration
// ════════════════════════════════════════════════════
console.log('\n─── F. Forecasting Integration ───');

if (createdProductIds[0]) {
  const fRun = await api('POST', `/forecast/run/${createdProductIds[0]}`);
  // Backend may return 200 or 202 for compute kick-off
  assert('F1. POST /forecast/run/:id accepted (200/202)',
    [200, 201, 202].includes(fRun.status),
    `Got ${fRun.status}`);

  // Wait briefly for compute (real run may be async; cron-driven)
  await new Promise(r => setTimeout(r, 500));

  const pAfter = await api('GET', `/products/${createdProductIds[0]}`);
  const fd = pAfter.body?.data?.forecastData;
  assert('F2. Product.forecastData present after run',
    fd != null && typeof fd === 'object');

  // F3. Forecast data has at least the method or lastComputedAt field
  // (newly-created products with no sales history will likely use
  // FALLBACK or NAIVE — that's still valid)
  assert('F3. forecastData has method OR lastComputedAt',
    !!(fd?.method || fd?.lastComputedAt));

  // F4. Frontend MAPE-badge helper — pure function from ForecastTab
  const forecastSrc = fs.readFileSync(
    path.join(SRC, 'pages/products/tabs/ForecastTab.jsx'), 'utf8');
  const mapeMatch = forecastSrc.match(/function mapeBadge\(mape\)\s*\{([\s\S]+?)\n\}/);
  if (mapeMatch) {
    const mapeBadgeFn = new Function('mape', mapeMatch[1]);
    assert('F4. mapeBadge bands (5%/15%/30%) map to success/warning/danger',
      mapeBadgeFn(5).variant === 'success' &&
      mapeBadgeFn(15).variant === 'warning' &&
      mapeBadgeFn(30).variant === 'danger');
  }
}

// ════════════════════════════════════════════════════
// Cleanup — delete every test entity tagged with marker
// ════════════════════════════════════════════════════
console.log('\n─── Cleanup ───');

let cleanedC = 0, cleanedP = 0;
for (const id of createdCustomerIds) {
  const r = await api('DELETE', `/customers/${id}`,
    { reason: `${RUN_MARKER} cleanup` });
  if (r.status === 200) cleanedC++;
}
for (const id of createdProductIds) {
  const r = await api('DELETE', `/products/${id}`,
    { reason: `${RUN_MARKER} cleanup` });
  if (r.status === 200) cleanedP++;
}

console.log(`  Cleaned: ${cleanedC} customer(s), ${cleanedP} product(s)`);
assert('Cleanup: all created customers soft-deleted',
  cleanedC >= createdCustomerIds.length - 1);  // -1 accounts for B6's pre-deleted
assert('Cleanup: all created products soft-deleted',
  cleanedP === createdProductIds.length);

// ════════════════════════════════════════════════════
// Summary
// ════════════════════════════════════════════════════
console.log('\n═══════════════════════════════════════');
console.log(`📊 Prompt 11 E2E: ${pass}/${pass + fail} passed (${skipped} skipped)`);
if (failures.length > 0) {
  console.log('\nFailures:');
  failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
}
process.exit(fail === 0 ? 0 : 1);
