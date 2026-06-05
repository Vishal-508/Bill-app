// Section E smoke — unit tests for the zod login schema + LIVE
// backend contract tests against /api/auth/login + /api/auth/me.
//
// Live tests require backend on http://localhost:5000. If unreachable,
// the live group is skipped with a clear message; unit tests still run.

// ─── localStorage shim (axios.js touches it via interceptors) ───
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

const BACKEND_URL = process.env.API_BASE_URL || 'http://localhost:5000/api';
const LOGIN_EMAIL = process.env.LOGIN_EMAIL || 'testadmin@shreegopal.com';
const LOGIN_PASSWORD = process.env.LOGIN_PASSWORD || 'TestAdmin@123';

const { loginSchema } = await import('../src/utils/validators.js');

let pass = 0, fail = 0, skipped = 0;
const failures = [];
function assert(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); failures.push(name); }
}
function skip(name, reason) { skipped++; console.log(`  ⊝  ${name} — skipped (${reason})`); }

console.log('\n═══ Section E — Login Flow Smoke Test ═══');

// ═══════════════════════════════════════════════
// Unit — zod loginSchema
// ═══════════════════════════════════════════════
console.log('\n--- zod loginSchema (unit) ---');

const okParse = loginSchema.safeParse({ email: 'a@b.com', password: 'longpass1', rememberMe: true });
assert('Valid input parses', okParse.success);

const missingEmail = loginSchema.safeParse({ email: '', password: 'longpass1' });
assert('Empty email rejected', !missingEmail.success);
if (!missingEmail.success) {
  const fieldErrors = missingEmail.error.flatten().fieldErrors;
  assert('Empty email surfaces field error',
    Array.isArray(fieldErrors.email) && fieldErrors.email.length > 0);
}

const badEmail = loginSchema.safeParse({ email: 'not-an-email', password: 'longpass1' });
assert('Bad email format rejected', !badEmail.success);
if (!badEmail.success) {
  const msg = badEmail.error.issues.find(i => i.path[0] === 'email')?.message;
  assert('Bad email error message mentions "valid email"',
    /valid email/i.test(msg || ''),
    `Got: ${msg}`);
}

const shortPw = loginSchema.safeParse({ email: 'a@b.com', password: 'short' });
assert('Password < 8 chars rejected', !shortPw.success);
if (!shortPw.success) {
  const msg = shortPw.error.issues.find(i => i.path[0] === 'password')?.message;
  assert('Short password error mentions "8 characters"',
    /8 characters/i.test(msg || ''),
    `Got: ${msg}`);
}

const exact8 = loginSchema.safeParse({ email: 'a@b.com', password: '12345678' });
assert('Password exactly 8 chars accepted', exact8.success);

const noRemember = loginSchema.safeParse({ email: 'a@b.com', password: 'longpass1' });
assert('rememberMe is optional', noRemember.success);

// ═══════════════════════════════════════════════
// Live — backend reachability check
// ═══════════════════════════════════════════════
console.log('\n--- Backend reachability ---');
let backendAlive = false;
try {
  const res = await fetch(`${BACKEND_URL.replace(/\/api$/, '')}/api/health`, {
    method: 'GET',
    signal: AbortSignal.timeout(3000),
  });
  backendAlive = res.ok;
  assert(`Backend reachable on ${BACKEND_URL.replace(/\/api$/, '')}`,
    backendAlive, `HTTP ${res.status}`);
} catch (err) {
  skip('Backend reachability', err.message);
}

if (!backendAlive) {
  console.log('\n  (live integration tests skipped — backend not reachable)');
  console.log('  Start the backend in another terminal: cd backend && npm run dev');
} else {
  // ═══════════════════════════════════════════════
  // Live — POST /api/auth/login (happy path)
  // ═══════════════════════════════════════════════
  console.log('\n--- POST /api/auth/login (happy path) ---');
  let accessToken = null;
  try {
    const r = await fetch(`${BACKEND_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: LOGIN_EMAIL, password: LOGIN_PASSWORD }),
    });
    const body = await r.json();
    assert('Login with valid creds → 200', r.status === 200, `Got ${r.status} body=${JSON.stringify(body).slice(0, 200)}`);
    assert('Response has accessToken', typeof body.accessToken === 'string' && body.accessToken.length > 20);
    assert('Response has refreshToken', typeof body.refreshToken === 'string');
    assert('Response has user.email', body.user?.email === LOGIN_EMAIL);
    assert('Response has user.role', typeof body.user?.role === 'string');
    accessToken = body.accessToken;
  } catch (err) {
    fail++; failures.push('Login happy-path fetch threw');
    console.log(`  ❌ Login happy-path fetch threw — ${err.message}`);
  }

  // ═══════════════════════════════════════════════
  // Live — wrong password → 401
  // ═══════════════════════════════════════════════
  console.log('\n--- POST /api/auth/login (wrong password) ---');
  try {
    const r = await fetch(`${BACKEND_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: LOGIN_EMAIL, password: 'definitely-not-the-password' }),
    });
    assert('Wrong password → 401', r.status === 401, `Got ${r.status}`);
  } catch (err) {
    fail++; failures.push('Wrong-password fetch threw');
    console.log(`  ❌ Wrong-password fetch threw — ${err.message}`);
  }

  // ═══════════════════════════════════════════════
  // Live — malformed body → 400
  // ═══════════════════════════════════════════════
  console.log('\n--- POST /api/auth/login (malformed body) ---');
  try {
    const r = await fetch(`${BACKEND_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email', password: 'x' }),
    });
    // Backend may return 400 (validation) or 401 (auth failure pre-validation) — either is acceptable
    assert('Malformed body rejected (400 or 401)', [400, 401].includes(r.status), `Got ${r.status}`);
  } catch (err) {
    fail++; failures.push('Malformed-body fetch threw');
    console.log(`  ❌ Malformed-body fetch threw — ${err.message}`);
  }

  // ═══════════════════════════════════════════════
  // Live — GET /api/auth/me (token-gated)
  // ═══════════════════════════════════════════════
  console.log('\n--- GET /api/auth/me ---');
  if (accessToken) {
    try {
      const r = await fetch(`${BACKEND_URL}/auth/me`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const body = await r.json();
      assert('Authed /me → 200', r.status === 200, `Got ${r.status}`);
      assert('/me returns user.email matching login',
        body.user?.email === LOGIN_EMAIL,
        `Got ${body.user?.email}`);
    } catch (err) {
      fail++; failures.push('/me fetch threw');
      console.log(`  ❌ /me fetch threw — ${err.message}`);
    }

    // No token → 401
    try {
      const r = await fetch(`${BACKEND_URL}/auth/me`);
      assert('Unauthed /me → 401', r.status === 401, `Got ${r.status}`);
    } catch (err) {
      fail++; failures.push('Unauthed /me fetch threw');
    }
  } else {
    skip('GET /auth/me', 'no token from login step');
  }
}

// ═══════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════
console.log('\n═══════════════════════════════════════');
console.log(`📊 Section E login flow: ${pass}/${pass + fail} passed (${skipped} skipped)`);
if (failures.length > 0) {
  console.log('\nFailures:');
  failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
}
process.exit(fail === 0 ? 0 : 1);
