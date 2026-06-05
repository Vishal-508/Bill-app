// Pragmatic frontend smoke test — utils + reducers + axios interceptor wiring.
// Runs in Node (admin-dashboard package.json has "type": "module" → ESM).
// No DOM, no React rendering. Section D will add browser-level verification.

// ─── localStorage shim (Node has no window.localStorage) ───
function makeMockStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    _store: store,
  };
}
globalThis.localStorage = makeMockStorage();
// Also stub window so any window.location.replace defenses don't blow up.
globalThis.window = { location: { pathname: '/', search: '', replace: () => {} } };

const { formatINR, formatPhone, formatDate, formatDateTime, truncate } =
  await import('../src/utils/format.js');
const { STORAGE_KEYS, ROUTES, ROLES, MAX_NOTIFICATIONS } =
  await import('../src/utils/constants.js');
const authModule = await import('../src/store/auth.slice.js');
const uiModule = await import('../src/store/ui.slice.js');
const notificationsModule = await import('../src/store/notifications.slice.js');
const { api } = await import('../src/api/axios.js');

let pass = 0, fail = 0;
const failures = [];
function assert(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); failures.push(name); }
}

console.log('\n═══ Section A — Foundation Frontend Smoke Test ═══');

// ═══════════════════════════════════════════════
// Helpers — formatters
// ═══════════════════════════════════════════════
console.log('\n--- Formatters ---');

// Intl on Node produces non-breaking spaces ( ) and may use the
// narrow ₹ symbol. Normalize spaces before asserting to keep the
// expected strings readable.
const norm = (s) => String(s).replace(/ /g, ' ').replace(/ /g, ' ');

const r1 = norm(formatINR(123456.78));
assert('formatINR(123456.78) → ₹1,23,456.78 (Indian lakhs grouping)',
  r1 === '₹1,23,456.78', `Got "${r1}"`);

const r2 = norm(formatINR(1234567.89));
assert('formatINR(1234567.89) → ₹12,34,567.89',
  r2 === '₹12,34,567.89', `Got "${r2}"`);

const r3 = norm(formatINR(0));
assert('formatINR(0) → ₹0.00', r3 === '₹0.00', `Got "${r3}"`);

const r4 = norm(formatINR(null));
assert('formatINR(null) → ₹0.00 (safe fallback)',
  r4 === '₹0.00', `Got "${r4}"`);

assert('formatPhone("9876543210") → +91 98765-43210',
  formatPhone('9876543210') === '+91 98765-43210',
  `Got "${formatPhone('9876543210')}"`);
assert('formatPhone("+91 9876543210") → +91 98765-43210',
  formatPhone('+91 9876543210') === '+91 98765-43210');
assert('formatPhone("919876543210") → +91 98765-43210',
  formatPhone('919876543210') === '+91 98765-43210');
assert('formatPhone("1234567890") → unchanged (invalid first digit)',
  formatPhone('1234567890') === '1234567890');
assert('formatPhone(null) → ""', formatPhone(null) === '');

assert('formatDate(2026-06-05) → 05 Jun 2026',
  formatDate(new Date('2026-06-05')) === '05 Jun 2026',
  `Got "${formatDate(new Date('2026-06-05'))}"`);
assert('formatDate(null) → ""', formatDate(null) === '');
assert('formatDate("not a date") → ""', formatDate('not a date') === '');

const dt = formatDateTime(new Date('2026-06-05T14:32:00'));
assert('formatDateTime → "05 Jun 2026, 14:32"',
  dt === '05 Jun 2026, 14:32', `Got "${dt}"`);

assert('truncate("hello world", 5) → "hell…"',
  truncate('hello world', 5) === 'hell…');
assert('truncate("short", 50) → "short" (no change)',
  truncate('short', 50) === 'short');

// ═══════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════
console.log('\n--- Constants ---');
assert('STORAGE_KEYS.ACCESS_TOKEN defined',
  typeof STORAGE_KEYS.ACCESS_TOKEN === 'string');
assert('ROUTES.DASHBOARD === /dashboard', ROUTES.DASHBOARD === '/dashboard');
assert('ROLES.SUPER_ADMIN === "SUPER_ADMIN"', ROLES.SUPER_ADMIN === 'SUPER_ADMIN');
assert('MAX_NOTIFICATIONS === 50', MAX_NOTIFICATIONS === 50);

// ═══════════════════════════════════════════════
// Auth slice
// ═══════════════════════════════════════════════
console.log('\n--- Auth slice ---');
const authReducer = authModule.default;
const { setCredentials, logout, updateUser, clearError } = authModule;

let state = authReducer(undefined, { type: '@@INIT' });
assert('Auth initial state: not authenticated',
  state.isAuthenticated === false && state.user === null);

state = authReducer(state, setCredentials({
  user: { _id: 'u1', email: 'a@b.com', role: 'ADMIN', name: 'Admin' },
  accessToken: 'access-xxx',
  refreshToken: 'refresh-yyy',
}));
assert('setCredentials sets user + token + isAuthenticated',
  state.isAuthenticated === true &&
  state.user.email === 'a@b.com' &&
  state.accessToken === 'access-xxx');
assert('setCredentials persists access token to localStorage',
  localStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN) === 'access-xxx');
assert('setCredentials persists refresh token',
  localStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN) === 'refresh-yyy');

state = authReducer(state, updateUser({ name: 'Updated Name' }));
assert('updateUser merges into existing user',
  state.user.name === 'Updated Name' && state.user.email === 'a@b.com');

state = authReducer(state, logout());
assert('logout clears auth state',
  state.isAuthenticated === false &&
  state.user === null && state.accessToken === null);
assert('logout clears localStorage tokens',
  localStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN) === null &&
  localStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN) === null);

state = { ...state, error: { message: 'oops' } };
state = authReducer(state, clearError());
assert('clearError nulls the error field', state.error === null);

// ═══════════════════════════════════════════════
// UI slice
// ═══════════════════════════════════════════════
console.log('\n--- UI slice ---');
const uiReducer = uiModule.default;
const { toggleSidebar, setSidebarOpen, openModal, closeModal, setPageTitle } = uiModule;

let ui = uiReducer(undefined, { type: '@@INIT' });
const initialSidebar = ui.sidebarOpen;
ui = uiReducer(ui, toggleSidebar());
assert('toggleSidebar flips sidebarOpen',
  ui.sidebarOpen === !initialSidebar);

ui = uiReducer(ui, setSidebarOpen(true));
assert('setSidebarOpen(true) forces open', ui.sidebarOpen === true);

ui = uiReducer(ui, openModal('customer-form'));
assert('openModal sets activeModal', ui.activeModal === 'customer-form');
ui = uiReducer(ui, closeModal());
assert('closeModal clears activeModal', ui.activeModal === null);

ui = uiReducer(ui, setPageTitle('Dashboard'));
assert('setPageTitle stores the title', ui.pageTitle === 'Dashboard');

// ═══════════════════════════════════════════════
// Notifications slice
// ═══════════════════════════════════════════════
console.log('\n--- Notifications slice ---');
const notifReducer = notificationsModule.default;
const { addNotification, markAsRead, markAllAsRead, clearAll, _resetIds } = notificationsModule;
_resetIds();

let n = notifReducer(undefined, { type: '@@INIT' });
assert('Notifications initial: empty + unread=0',
  n.items.length === 0 && n.unreadCount === 0);

n = notifReducer(n, addNotification({ type: 'order:new', orderNumber: 'ORD-1' }));
n = notifReducer(n, addNotification({ type: 'payment:received', invoiceNo: 'INV-1' }));
assert('addNotification stamps id + read=false',
  n.items[0].id === 2 && n.items[0].read === false);
assert('addNotification prepends (newest first)',
  n.items[0].type === 'payment:received' && n.items[1].type === 'order:new');
assert('unreadCount = 2', n.unreadCount === 2);

n = notifReducer(n, markAsRead(2));
assert('markAsRead decrements unreadCount',
  n.unreadCount === 1 && n.items[0].read === true);

n = notifReducer(n, markAllAsRead());
assert('markAllAsRead clears unreadCount',
  n.unreadCount === 0 && n.items.every(i => i.read));

// Cap at MAX_NOTIFICATIONS — push 60, expect 50
_resetIds();
n = notifReducer({ items: [], unreadCount: 0 }, { type: '@@INIT' });
for (let i = 0; i < 60; i++) {
  n = notifReducer(n, addNotification({ type: 'test', i }));
}
assert(`addNotification caps at MAX_NOTIFICATIONS (${MAX_NOTIFICATIONS})`,
  n.items.length === MAX_NOTIFICATIONS,
  `Got ${n.items.length}`);
assert('Cap drops OLDEST (last item is i=59, first dropped is i=0)',
  n.items[0].i === 59 && n.items[MAX_NOTIFICATIONS - 1].i === 60 - MAX_NOTIFICATIONS);

n = notifReducer(n, clearAll());
assert('clearAll empties items + zeros unreadCount',
  n.items.length === 0 && n.unreadCount === 0);

// ═══════════════════════════════════════════════
// Axios
// ═══════════════════════════════════════════════
console.log('\n--- Axios instance ---');
assert('api.defaults.baseURL set',
  api.defaults.baseURL === 'http://localhost:5000/api',
  `Got "${api.defaults.baseURL}"`);
assert('Request interceptor registered',
  api.interceptors.request.handlers.length >= 1);
assert('Response interceptor registered',
  api.interceptors.response.handlers.length >= 1);

// Drive the request interceptor manually: with token in storage,
// the interceptor should attach an Authorization header.
localStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, 'test-bearer-xxx');
const reqInterceptor = api.interceptors.request.handlers[0].fulfilled;
const mockConfig = { headers: {} };
const out = await Promise.resolve(reqInterceptor(mockConfig));
assert('Request interceptor attaches Bearer token from storage',
  out.headers.Authorization === 'Bearer test-bearer-xxx',
  `Got "${out.headers.Authorization}"`);

localStorage.removeItem(STORAGE_KEYS.ACCESS_TOKEN);
const out2 = await Promise.resolve(reqInterceptor({ headers: {} }));
assert('No token in storage → no Authorization header',
  !out2.headers.Authorization);

// Response interceptor reject branch on non-401, non-403 — should
// reject without crashing. Use a synthetic axios-like error.
const respRejector = api.interceptors.response.handlers[0].rejected;
let caught = false;
try {
  await respRejector({ config: {}, response: { status: 502 } });
} catch (e) {
  caught = true;
}
assert('Response interceptor rejects on 5xx (without crashing)', caught);

// ═══════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════
console.log('\n═══════════════════════════════════════');
console.log(`📊 Section A foundation: ${pass}/${pass + fail} passed`);
if (failures.length > 0) {
  console.log('\nFailures:');
  failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
}
process.exit(fail === 0 ? 0 : 1);
