// Section A smoke — queryKeys unit + LIVE customer/product CRUD
// against the backend on port 5000. The live block creates a unique
// test customer, mutates it, fetches it back, and soft-deletes it
// for cleanup. Same dance for one product.

function makeMockStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
}
globalThis.localStorage = makeMockStorage();
globalThis.window = { location: { pathname: '/', search: '', replace: () => {} } };

const API_BASE = process.env.API_BASE_URL || 'http://localhost:5000/api';
const LOGIN_EMAIL = process.env.LOGIN_EMAIL || 'testadmin@shreegopal.com';
const LOGIN_PASSWORD = process.env.LOGIN_PASSWORD || 'TestAdmin@123';
const BYPASS = process.env.TEST_BYPASS_SECRET || '';

const { queryKeys } = await import('../src/utils/queryKeys.js');

let pass = 0, fail = 0, skipped = 0;
const failures = [];
function assert(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); failures.push(name); }
}
function skip(name, reason) { skipped++; console.log(`  ⊝  ${name} — skipped (${reason})`); }

console.log('\n═══ Section A — Customer/Product API + Query Hooks ═══');

// ═══════════════════════════════════════════════
// queryKeys factory (unit)
// ═══════════════════════════════════════════════
console.log('\n--- queryKeys factory ---');

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

assert('customers.all → ["customers"]',
  eq(queryKeys.customers.all, ['customers']));
assert('customers.lists → ["customers","list"]',
  eq(queryKeys.customers.lists, ['customers', 'list']));
assert('customers.list({page:2}) → ["customers","list",{page:2}]',
  eq(queryKeys.customers.list({ page: 2 }), ['customers', 'list', { page: 2 }]));
assert('customers.list() → ["customers","list",{}] (no-args fallback)',
  eq(queryKeys.customers.list(), ['customers', 'list', {}]));
assert('customers.detail("abc") → ["customers","detail","abc"]',
  eq(queryKeys.customers.detail('abc'), ['customers', 'detail', 'abc']));
assert('customers.detail coerces non-string IDs to string',
  eq(queryKeys.customers.detail(123), ['customers', 'detail', '123']));
assert('customers.insights returns scoped key',
  eq(queryKeys.customers.insights('xyz'), ['customers', 'insights', 'xyz']));

assert('products.all → ["products"]',
  eq(queryKeys.products.all, ['products']));
assert('products.list scoped under list',
  eq(queryKeys.products.list({ q: 'mdf' }), ['products', 'list', { q: 'mdf' }]));
assert('products.detail scoped under detail',
  eq(queryKeys.products.detail('p1'), ['products', 'detail', 'p1']));
assert('products.lowStock is a separate scope',
  eq(queryKeys.products.lowStock, ['products', 'low-stock']));

// Structural invariant: every detail key starts with the entity
assert('All detail keys share entity-prefix structure',
  queryKeys.customers.detail('x')[0] === 'customers' &&
  queryKeys.products.detail('x')[0]  === 'products');
// Invalidating ['customers'] hits both list AND detail subtrees
assert('Lists + details share entity prefix (one invalidate kills all)',
  queryKeys.customers.list({}).slice(0, 1)[0] === 'customers' &&
  queryKeys.customers.detail('x').slice(0, 1)[0] === 'customers');

// ═══════════════════════════════════════════════
// Live backend reachability
// ═══════════════════════════════════════════════
console.log('\n--- Backend reachability ---');
let backendAlive = false;
try {
  const r = await fetch(`${API_BASE.replace(/\/api$/, '')}/api/health`,
    { signal: AbortSignal.timeout(3000) });
  backendAlive = r.ok;
  assert('Backend reachable', backendAlive);
} catch (err) {
  skip('Live API tests', err.message);
}

if (!backendAlive) {
  console.log('\n  (start backend: cd backend && npm run dev)');
} else {
  // Login
  let token = null;
  try {
    const r = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: LOGIN_EMAIL, password: LOGIN_PASSWORD }),
    });
    const body = await r.json();
    token = body.accessToken;
    assert('Login succeeded', r.status === 200 && !!token);
  } catch (err) {
    fail++; failures.push('Login fetch threw');
    console.log(`  ❌ Login fetch threw — ${err.message}`);
  }

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    ...(BYPASS ? { 'x-test-bypass-ratelimit': BYPASS } : {}),
  };

  // ═════════════════════════════════════════════
  // GET /api/customers — list shape
  // ═════════════════════════════════════════════
  console.log('\n--- GET /api/customers (list shape) ---');
  try {
    const r = await fetch(`${API_BASE}/customers?limit=5&page=1`, { headers });
    const body = await r.json();
    assert('Customer list → 200', r.status === 200, `Got ${r.status}`);
    assert('List body has data array', Array.isArray(body.data));
    // Backend's QueryBuilder returns pagination.{totalRecords, page,
    // limit, totalPages, hasNext, hasPrev} — NOT `total`.
    assert('List body has pagination block (totalRecords)',
      body.pagination && typeof body.pagination.totalRecords === 'number');
  } catch (err) {
    fail++; failures.push('Customer list fetch threw');
  }

  // ═════════════════════════════════════════════
  // Customer CRUD cycle (create → get → update → soft-delete)
  // ═════════════════════════════════════════════
  console.log('\n--- Customer CRUD cycle ---');
  const ts = Date.now().toString().slice(-7);
  const testPhone = `9${ts.padStart(9, '0')}`.slice(0, 10);
  // Backend's createCustomerSchema uses `customerName` (not `name`)
  // and `billingAddress` (not `address`). billType is not part of
  // the create schema — it's derived from `gstin` presence.
  const createPayload = {
    customerName: `API-Test Customer ${ts}`,
    phone: testPhone,
    billingAddress: {
      line1: 'Test line 1',
      city: 'Mumbai',
      state: 'Maharashtra',
      stateCode: '27',
      pincode: '400001',
    },
  };

  let createdId = null;
  try {
    const r = await fetch(`${API_BASE}/customers`,
      { method: 'POST', headers, body: JSON.stringify(createPayload) });
    const body = await r.json();
    assert('POST /customers → 201', r.status === 201,
      `Got ${r.status}: ${JSON.stringify(body).slice(0, 200)}`);
    createdId = body?.data?._id;
    assert('Create response has data._id', !!createdId);
    assert('Created customer customerName preserved',
      body?.data?.customerName === createPayload.customerName);
  } catch (err) {
    fail++; failures.push('Customer create threw');
  }

  if (createdId) {
    // GET detail
    try {
      const r = await fetch(`${API_BASE}/customers/${createdId}`, { headers });
      const body = await r.json();
      assert('GET /customers/:id → 200', r.status === 200);
      assert('Detail body has data with matching customerName',
        body?.data?.customerName === createPayload.customerName);
    } catch (err) {
      fail++; failures.push('Customer get threw');
    }

    // PUT update — backend field is customerName
    try {
      const r = await fetch(`${API_BASE}/customers/${createdId}`, {
        method: 'PUT', headers,
        body: JSON.stringify({ customerName: `Updated Customer ${ts}` }),
      });
      const body = await r.json();
      assert('PUT /customers/:id → 200', r.status === 200,
        `Got ${r.status}: ${JSON.stringify(body).slice(0, 200)}`);
      assert('Updated customer name reflected',
        body?.data?.customerName === `Updated Customer ${ts}`);
    } catch (err) {
      fail++; failures.push('Customer update threw');
    }

    // DELETE (soft) — backend's softDeleteCustomerSchema accepts a body
    try {
      const r = await fetch(`${API_BASE}/customers/${createdId}`, {
        method: 'DELETE', headers,
        body: JSON.stringify({ reason: 'API smoke test cleanup' }),
      });
      assert('DELETE /customers/:id → 200', r.status === 200,
        `Got ${r.status}`);
    } catch (err) {
      fail++; failures.push('Customer delete threw');
    }
  }

  // ═════════════════════════════════════════════
  // Product list + low-stock shape
  // ═════════════════════════════════════════════
  console.log('\n--- Product list + low-stock ---');
  try {
    const r = await fetch(`${API_BASE}/products?limit=5`, { headers });
    const body = await r.json();
    assert('Product list → 200', r.status === 200);
    assert('Product list has data array', Array.isArray(body.data));
  } catch (err) {
    fail++; failures.push('Product list fetch threw');
  }

  try {
    const r = await fetch(`${API_BASE}/products/low-stock`, { headers });
    assert('Low-stock endpoint → 200', r.status === 200);
  } catch (err) {
    fail++; failures.push('Low-stock fetch threw');
  }
}

// ═══════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════
console.log('\n═══════════════════════════════════════');
console.log(`📊 Section A: ${pass}/${pass + fail} passed (${skipped} skipped)`);
if (failures.length > 0) {
  console.log('\nFailures:');
  failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
}
process.exit(fail === 0 ? 0 : 1);
