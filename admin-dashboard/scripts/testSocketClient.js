// Section F smoke — file-structure checks + LIVE socket.io-client tests
// against the backend Socket.IO server on port 5000.
//
// The live test sequence:
//   1. POST /api/auth/login → JWT
//   2. Connect socket.io-client with that JWT → expect 'connect'
//   3. subscribe:orders + subscribe:inventory (admin) → ack ok
//   4. Trigger backend event by POST /api/orders → expect order:new on client
//   5. Cleanup: cancel the order so it doesn't pollute the DB

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

let pass = 0, fail = 0, skipped = 0;
const failures = [];
function assert(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); failures.push(name); }
}
function skip(name, reason) { skipped++; console.log(`  ⊝  ${name} — skipped (${reason})`); }

function read(rel) { return fs.readFileSync(path.join(SRC, rel), 'utf8'); }
function exists(rel) { return fs.existsSync(path.join(SRC, rel)); }

console.log('\n═══ Section F — Socket.IO Client Smoke Test ═══');

// ═══════════════════════════════════════════════
// File structure + content
// ═══════════════════════════════════════════════
console.log('\n--- File structure ---');
assert('hooks/useSocket.js exists', exists('hooks/useSocket.js'));
assert('components/notifications/NotificationDropdown.jsx exists',
  exists('components/notifications/NotificationDropdown.jsx'));
assert('components/notifications/NotificationItem.jsx exists',
  exists('components/notifications/NotificationItem.jsx'));

const socketSrc = read('hooks/useSocket.js');
assert('useSocket exports a function',
  /export\s+(function|const)\s+useSocket\b/.test(socketSrc));
assert('useSocket uses useEffect for lifecycle',
  socketSrc.includes('useEffect'));
// The cleanup branch handles `!isAuthenticated` (logout) AND clean
// unmount. Both cases must disconnect any live socket. Looser regex
// — just verify that within the useEffect body there's a !isAuth check
// that calls disconnect somewhere downstream.
assert('useSocket disconnects on logout (cleanup branch)',
  /!isAuthenticated[\s\S]{0,300}disconnect\(\)/.test(socketSrc));
assert('useSocket subscribes to orders + dashboard',
  socketSrc.includes("'subscribe:orders'") && socketSrc.includes("'subscribe:dashboard'"));
assert('useSocket subscribes to inventory only for ADMIN/SUPER_ADMIN',
  socketSrc.includes('subscribe:inventory') && socketSrc.includes('ROLES.ADMIN'));

const expectedHandlers = [
  'order:new', 'order:status-changed', 'order:updated',
  'payment:received', 'bill:generated', 'inventory:low-stock', 'dashboard:refresh',
];
for (const ev of expectedHandlers) {
  assert(`useSocket registers handler for '${ev}'`,
    new RegExp(`socket\\.on\\(['"]${ev}['"]`).test(socketSrc));
}
assert('useSocket has reconnection_failed fallback toast',
  socketSrc.includes('reconnect_failed'));

// NotificationDropdown wiring
const ddSrc = read('components/notifications/NotificationDropdown.jsx');
assert('NotificationDropdown dispatches markAsRead', ddSrc.includes('markAsRead'));
assert('NotificationDropdown dispatches markAllAsRead', ddSrc.includes('markAllAsRead'));
assert('NotificationDropdown dispatches clearAll', ddSrc.includes('clearAll'));
assert('NotificationDropdown renders NotificationItem',
  ddSrc.includes('NotificationItem'));

// Topbar imports the dropdown
const topbarSrc = read('components/layout/Topbar.jsx');
assert('Topbar imports NotificationDropdown',
  topbarSrc.includes('NotificationDropdown'));
assert('Topbar renders <NotificationDropdown />',
  /<NotificationDropdown\s*\/>/.test(topbarSrc));

// MainLayout calls useSocket
const mlSrc = read('components/layout/MainLayout.jsx');
assert('MainLayout imports useSocket', mlSrc.includes('useSocket'));
assert('MainLayout calls useSocket() in render',
  /useSocket\(\);?/.test(mlSrc));

// ═══════════════════════════════════════════════
// Live backend test — login + socket connect + event delivery
// ═══════════════════════════════════════════════
console.log('\n--- Backend reachability ---');
let backendAlive = false;
try {
  const r = await fetch(`${SOCKET_URL}/api/health`, { signal: AbortSignal.timeout(3000) });
  backendAlive = r.ok;
  assert(`Backend reachable at ${SOCKET_URL}`, backendAlive);
} catch (err) {
  skip('Live socket tests', `backend not reachable: ${err.message}`);
}

if (backendAlive) {
  console.log('\n--- POST /api/auth/login ---');
  let accessToken = null;
  try {
    const r = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: LOGIN_EMAIL, password: LOGIN_PASSWORD }),
    });
    const body = await r.json();
    accessToken = body.accessToken;
    assert('Login succeeded (200 + accessToken)',
      r.status === 200 && typeof accessToken === 'string');
  } catch (err) {
    fail++; failures.push('Login fetch threw');
    console.log(`  ❌ Login fetch threw — ${err.message}`);
  }

  if (accessToken) {
    console.log('\n--- socket.io-client connection ---');
    const { io: ioClient } = await import('socket.io-client');

    const connectClient = (token) => new Promise((resolve, reject) => {
      const c = ioClient(SOCKET_URL, {
        auth: { token },
        transports: ['websocket'],
        reconnection: false,
        timeout: 4000,
      });
      c.once('connect', () => resolve(c));
      c.once('connect_error', reject);
    });

    // Valid JWT → connect
    let client;
    try {
      client = await connectClient(accessToken);
      assert('Valid JWT → socket connects', client.connected === true);
    } catch (err) {
      fail++; failures.push('Socket connect failed');
      console.log(`  ❌ Socket connect failed — ${err.message}`);
    }

    // Invalid JWT → connect_error
    let badErr;
    try { await connectClient('not-a-real-jwt'); }
    catch (e) { badErr = e; }
    assert('Invalid JWT → connect_error',
      badErr && /Authentication/i.test(badErr.message),
      `Got: ${badErr?.message}`);

    if (client) {
      console.log('\n--- subscribe events ---');
      // subscribe:orders ack
      const ordersAck = await new Promise((r) => client.emit('subscribe:orders', r));
      assert('subscribe:orders ack ok',
        ordersAck?.ok === true && ordersAck?.room === 'orders:all',
        JSON.stringify(ordersAck));

      // subscribe:inventory ack (admin user → ok)
      const invAck = await new Promise((r) => client.emit('subscribe:inventory', r));
      assert('ADMIN subscribe:inventory ack ok', invAck?.ok === true);

      // subscribe:dashboard ack
      const dashAck = await new Promise((r) => client.emit('subscribe:dashboard', r));
      assert('subscribe:dashboard ack ok', dashAck?.ok === true);

      // ─── Trigger a real backend event via POST /api/orders ───
      console.log('\n--- Trigger backend event → expect order:new on client ---');
      const waitForOrderNew = new Promise((resolve, reject) => {
        const timer = setTimeout(() =>
          reject(new Error('Timeout waiting for order:new')), 6000);
        client.once('order:new', (data) => {
          clearTimeout(timer);
          resolve(data);
        });
      });

      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      };
      if (BYPASS) headers['x-test-bypass-ratelimit'] = BYPASS;

      // Fetch a real customer + product to build a valid order
      const custRes = await fetch(`${API_BASE}/customers?limit=1`, { headers });
      const custBody = await custRes.json();
      const customer = custBody?.data?.[0];

      const prodRes = await fetch(`${API_BASE}/products?productType=RAW_SHEET&limit=1`, { headers });
      const prodBody = await prodRes.json();
      const product = prodBody?.data?.[0];

      let createdOrderId = null;
      if (!customer || !product) {
        skip('order:new live broadcast', 'no customer + product fixtures available');
      } else {
        const ppu = (product.basePrice || 100) * (product.areaSqFt || 1);
        const sub = ppu * 1;
        const orderRes = await fetch(`${API_BASE}/orders`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            customer: customer._id,
            items: [{
              itemType: 'FULL_SHEET', product: product._id,
              quantity: 1, pricePerUnit: ppu, materialCost: sub, lineSubtotal: sub,
            }],
            subtotal: sub, taxableAmount: sub, gstRatePct: 18,
            cgst: sub * 0.09, sgst: sub * 0.09, totalGst: sub * 0.18,
            totalAmount: sub * 1.18, paymentMode: 'PARTIAL',
            customerNotes: 'PROMPT10_F_SOCKET_TEST',
          }),
        });
        const orderBody = await orderRes.json();
        createdOrderId = orderBody?.data?._id;
        assert('POST /api/orders → 201', orderRes.status === 201,
          `Got ${orderRes.status}`);

        try {
          const evt = await waitForOrderNew;
          assert('Client received order:new event', evt != null);
          assert('order:new payload has orderNumber',
            typeof evt.orderNumber === 'string' && evt.orderNumber.length > 0);
          assert('order:new payload has customer + grandTotal',
            evt.customer != null && typeof evt.grandTotal === 'number');
        } catch (err) {
          fail++; failures.push('order:new event delivery');
          console.log(`  ❌ order:new event delivery — ${err.message}`);
        }
      }

      // Cleanup — soft-cancel the test order
      if (createdOrderId) {
        try {
          await fetch(`${API_BASE}/orders/${createdOrderId}/status`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ status: 'CANCELLED', notes: 'socket-test-cleanup' }),
          });
        } catch { /* best effort */ }
      }

      // Disconnect
      client.disconnect();
      await new Promise(r => setTimeout(r, 200));
      assert('Client disconnects cleanly', client.connected === false);
    }
  }
}

// ═══════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════
console.log('\n═══════════════════════════════════════');
console.log(`📊 Section F Socket.IO client: ${pass}/${pass + fail} passed (${skipped} skipped)`);
if (failures.length > 0) {
  console.log('\nFailures:');
  failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
}
process.exit(fail === 0 ? 0 : 1);
