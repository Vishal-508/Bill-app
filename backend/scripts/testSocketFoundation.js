require('dotenv').config();
if (process.env.NODE_ENV !== 'production') {
  const dns = require('dns');
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
}
// Disable crons in the test process (we boot a parallel HTTP server below).
process.env.DISABLE_CRONS = 'true';

const http = require('http');
const mongoose = require('mongoose');
const { io: ioClient } = require('socket.io-client');
const express = require('express');
const logger = require('../src/config/logger');
const { User } = require('../src/models');
const sockets = require('../src/sockets');
const { generateAccessToken } = require('../src/utils/jwt');

const TAG = 'SOCKET_A_TEST';
const TEST_PORT = 5051;

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

  /**
   * Helper: wait for an event on a client socket, with a timeout.
   */
  const waitForEvent = (sock, event, timeoutMs = 2000) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${event}`)), timeoutMs);
      sock.once(event, (data) => { clearTimeout(timer); resolve(data); });
    });

  /**
   * Helper: connect a socket.io-client with given token, resolve on
   * connect or reject on connect_error.
   */
  const connectClient = (token) => new Promise((resolve, reject) => {
    const c = ioClient(`http://localhost:${TEST_PORT}`, {
      auth: token ? { token } : {},
      transports: ['websocket'],
      reconnection: false,
      timeout: 3000,
    });
    c.once('connect', () => resolve(c));
    c.once('connect_error', (err) => {
      // Caller decides what to do with the error
      reject(err);
    });
  });

  let httpServer, adminToken, billingToken, inactiveToken, badToken;
  let users = { admin: null, billing: null, inactive: null };
  const openClients = [];
  const cleanup = async () => {
    for (const c of openClients) {
      try { c.disconnect(); } catch {}
    }
    try { sockets._reset(); } catch {}
    if (httpServer) await new Promise(r => httpServer.close(r));
    // Delete test users
    await User.deleteMany({ email: { $regex: `^${TAG.toLowerCase()}-` } });
  };

  try {
    logger.info('\n═══ SECTION A — Socket.IO Foundation Smoke Test ═══');

    // ─── Setup: create test users + tokens + boot a local HTTP server ───
    logger.info('\nSetup: users + parallel HTTP server with Socket.IO');

    // Clean leftovers
    await User.deleteMany({ email: { $regex: `^${TAG.toLowerCase()}-` } });

    users.admin = await User.create({
      name: `${TAG} Admin`,
      email: `${TAG.toLowerCase()}-admin@socket.test`,
      password: 'AdminSocket@123',
      role: 'ADMIN',
      isActive: true,
    });
    users.billing = await User.create({
      name: `${TAG} Billing`,
      email: `${TAG.toLowerCase()}-billing@socket.test`,
      password: 'BillingSocket@123',
      role: 'BILLING',
      isActive: true,
    });
    users.inactive = await User.create({
      name: `${TAG} Inactive`,
      email: `${TAG.toLowerCase()}-inactive@socket.test`,
      password: 'InactiveSocket@123',
      role: 'ADMIN',
      isActive: false,
    });

    // Mint access tokens (use the same JWT util as the auth middleware)
    adminToken = generateAccessToken(users.admin);
    billingToken = generateAccessToken(users.billing);
    inactiveToken = generateAccessToken(users.inactive);
    badToken = 'not-a-real-jwt';

    // Boot a parallel HTTP server with Socket.IO attached, on TEST_PORT
    const app = express();
    httpServer = http.createServer(app);
    sockets._reset(); // ensure a fresh init below
    sockets.init(httpServer);
    await new Promise(r => httpServer.listen(TEST_PORT, r));
    assert('Test HTTP server + Socket.IO listening', httpServer.listening === true);

    // ═══════════════════════════════════════════════
    // Auth tests (4)
    // ═══════════════════════════════════════════════
    logger.info('\n--- Auth ---');

    logger.info('\nT1: valid JWT → connection accepted');
    const adminSock = await connectClient(adminToken);
    openClients.push(adminSock);
    assert('Admin socket connected', adminSock.connected === true);

    logger.info('\nT2: no token → connection refused');
    let noTokenErr;
    try { await connectClient(null); } catch (e) { noTokenErr = e; }
    assert('No-token rejected with auth error',
      noTokenErr && /Authentication/i.test(noTokenErr.message),
      `Got: ${noTokenErr?.message}`);

    logger.info('\nT3: invalid JWT → connection refused');
    let badTokenErr;
    try { await connectClient(badToken); } catch (e) { badTokenErr = e; }
    assert('Bad-token rejected', badTokenErr != null,
      `Got: ${badTokenErr?.message}`);

    logger.info('\nT4: inactive user → connection refused');
    let inactiveErr;
    try { await connectClient(inactiveToken); } catch (e) { inactiveErr = e; }
    assert('Inactive user rejected',
      inactiveErr && /inactive/i.test(inactiveErr.message),
      `Got: ${inactiveErr?.message}`);

    // ═══════════════════════════════════════════════
    // Room auto-join + subscriptions (4)
    // ═══════════════════════════════════════════════
    logger.info('\n--- Rooms ---');

    const io = sockets.getIO();
    const findSocketByEmail = (email) => {
      for (const s of io.sockets.sockets.values()) {
        if (s.user?.email === email) return s;
      }
      return null;
    };

    logger.info('\nT5: admin auto-joined role:ADMIN + user:<id> rooms');
    const serverAdminSock = findSocketByEmail(users.admin.email);
    assert('Admin server-side socket found', serverAdminSock != null);
    if (serverAdminSock) {
      const rooms = [...serverAdminSock.rooms];
      assert('Joined role:ADMIN',
        rooms.includes(sockets.ROOMS.ROLE('ADMIN')), `Rooms: ${rooms.join(',')}`);
      assert('Joined user:<id>',
        rooms.includes(sockets.ROOMS.USER(String(users.admin._id))));
    }

    logger.info('\nT6: subscribe:orders → joins orders:all room');
    const ackOrders = await new Promise(r => adminSock.emit('subscribe:orders', r));
    assert('subscribe:orders ack ok', ackOrders?.ok === true);
    assert('Joined orders:all room',
      [...findSocketByEmail(users.admin.email).rooms].includes(sockets.ROOMS.ORDERS_ALL));

    logger.info('\nT7: subscribe:dashboard works');
    const ackDash = await new Promise(r => adminSock.emit('subscribe:dashboard', r));
    assert('subscribe:dashboard ack ok', ackDash?.ok === true);

    logger.info('\nT8: subscribe:inventory — admin OK, non-admin rejected');
    const billingSock = await connectClient(billingToken);
    openClients.push(billingSock);
    const ackInvBilling = await new Promise(r => billingSock.emit('subscribe:inventory', r));
    const ackInvAdmin = await new Promise(r => adminSock.emit('subscribe:inventory', r));
    assert('BILLING subscribe:inventory rejected',
      ackInvBilling?.ok === false && /admin only/i.test(ackInvBilling?.error || ''),
      `Got: ${JSON.stringify(ackInvBilling)}`);
    assert('ADMIN subscribe:inventory accepted', ackInvAdmin?.ok === true);

    // ═══════════════════════════════════════════════
    // Emit helpers (8)
    // ═══════════════════════════════════════════════
    logger.info('\n--- Emit helpers ---');

    // Subscribe billing to orders:all so it can receive order events too
    await new Promise(r => billingSock.emit('subscribe:orders', r));

    logger.info('\nT9: emitOrderNew → both clients in orders:all receive');
    const adminP = waitForEvent(adminSock, 'order:new');
    const billingP = waitForEvent(billingSock, 'order:new');
    sockets.emitOrderNew({
      _id: 'order-1', orderNumber: 'ORD-2026-001',
      customer: { customerName: 'Test Customer', phone: '9876543210' },
      totalAmount: 1500, items: [{ a: 1 }, { b: 2 }],
      createdAt: new Date(),
    });
    const [adminEvt, billingEvt] = await Promise.all([adminP, billingP]);
    assert('Admin received order:new', adminEvt?.orderNumber === 'ORD-2026-001');
    assert('Billing received order:new (same room)', billingEvt?.orderNumber === 'ORD-2026-001');
    assert('Payload has customer name + phone',
      adminEvt?.customer?.name === 'Test Customer' && adminEvt?.customer?.phone === '9876543210');

    logger.info('\nT10: emitOrderStatusChanged includes oldStatus + newStatus');
    const p = waitForEvent(adminSock, 'order:status-changed');
    sockets.emitOrderStatusChanged(
      { _id: 'x', orderNumber: 'ORD-2026-002', status: 'READY' },
      'PENDING'
    );
    const statusEvt = await p;
    assert('Status change has both old + new',
      statusEvt.oldStatus === 'PENDING' && statusEvt.newStatus === 'READY');

    logger.info('\nT11: emitOrderUpdated emitted with payload');
    const updP = waitForEvent(adminSock, 'order:updated');
    sockets.emitOrderUpdated({
      _id: 'o3', orderNumber: 'ORD-2026-003',
      status: 'COMPLETED', paymentStatus: 'PAID',
    });
    const updEvt = await updP;
    assert('Update event has status + paymentStatus',
      updEvt.status === 'COMPLETED' && updEvt.paymentStatus === 'PAID');

    logger.info('\nT12: emitBillGenerated reaches orders:all subscribers');
    const billP = waitForEvent(adminSock, 'bill:generated');
    sockets.emitBillGenerated({
      _id: 'b1', billNumber: 'INV-2026-001',
      customerInfo: { customerName: 'Bill Cust', phone: '9999988888' },
      grandTotal: 5900, hasGst: true, issueDate: new Date(),
    });
    const billEvt = await billP;
    assert('Bill event has invoiceNo + grandTotal + billType',
      billEvt.invoiceNo === 'INV-2026-001' &&
      billEvt.grandTotal === 5900 &&
      billEvt.billType === 'GST');

    logger.info('\nT13: emitPaymentReceived dual-room (orders + dashboard)');
    const payP = waitForEvent(adminSock, 'payment:received');
    sockets.emitPaymentReceived(
      { _id: 'p1', paymentReference: 'PAY-2026-XXXX1234', amount: 100, method: 'upi' },
      { billNumber: 'INV-2026-001', customerInfo: { customerName: 'PayCust', phone: '9777666555' } }
    );
    const payEvt = await payP;
    assert('Payment event has invoiceNo + paymentReference',
      payEvt.invoiceNo === 'INV-2026-001' && payEvt.paymentReference === 'PAY-2026-XXXX1234');

    logger.info('\nT14: emitLowStock — admin receives, billing does NOT');
    const lowStockAdmin = waitForEvent(adminSock, 'inventory:low-stock', 1500);
    let billingReceivedLowStock = false;
    billingSock.once('inventory:low-stock', () => { billingReceivedLowStock = true; });
    sockets.emitLowStock([
      { _id: 'lp1', sku: 'TEST-SKU-1', name: 'Low product', currentStock: 5, minStockAlert: 10 },
    ]);
    const lowEvt = await lowStockAdmin;
    // Give a brief moment to confirm billing did NOT receive
    await new Promise(r => setTimeout(r, 300));
    assert('Admin received inventory:low-stock', lowEvt.count === 1);
    assert('Billing did NOT receive inventory:low-stock (role-gated)',
      billingReceivedLowStock === false);

    logger.info('\nT15: emitDashboardRefresh reaches dashboard subscribers');
    const dashP = waitForEvent(adminSock, 'dashboard:refresh');
    sockets.emitDashboardRefresh('test-trigger');
    const dashEvt = await dashP;
    assert('dashboard:refresh has timestamp + reason',
      dashEvt.timestamp != null && dashEvt.reason === 'test-trigger');

    logger.info('\nT16: emit helpers handle null payload gracefully');
    const nullResults = {
      orderNew: sockets.emitOrderNew(null),
      orderUpdated: sockets.emitOrderUpdated(null),
      payment: sockets.emitPaymentReceived(null),
      bill: sockets.emitBillGenerated(null),
      lowStock: sockets.emitLowStock([]),
    };
    assert('emit helpers return false on null/empty input',
      Object.values(nullResults).every(v => v === false),
      JSON.stringify(nullResults));

    // ═══════════════════════════════════════════════
    // Disconnect lifecycle (1) — must run BEFORE io is reset
    // ═══════════════════════════════════════════════
    logger.info('\n--- Disconnect lifecycle ---');

    logger.info('\nT17: Client disconnect cleans up server-side socket');
    const lifecycleClient = await connectClient(adminToken);
    openClients.push(lifecycleClient);
    const connId = lifecycleClient.id;
    lifecycleClient.disconnect();
    await new Promise(r => setTimeout(r, 200));
    const ioStill = sockets.getIO();
    const stillThere = ioStill.sockets.sockets.has(connId);
    assert('Server-side socket removed after disconnect', stillThere === false);

    // ═══════════════════════════════════════════════
    // Defensive: emit when io not initialized (5) — LAST, no re-init needed
    // ═══════════════════════════════════════════════
    logger.info('\n--- Defensive (io = null) ---');

    logger.info('\nT18-T22: All helpers no-op when io is null');
    // Disconnect remaining clients + reset io
    for (const c of openClients) {
      try { c.disconnect(); } catch {}
    }
    openClients.length = 0;
    sockets._reset();
    await new Promise(r => setTimeout(r, 100));

    const r18 = sockets.emitOrderNew({ _id: 'x', orderNumber: 'X' });
    const r19 = sockets.emitOrderUpdated({ _id: 'x', orderNumber: 'X', status: 'X' });
    const r20 = sockets.emitPaymentReceived({ _id: 'x', amount: 100 }, { billNumber: 'X' });
    const r21 = sockets.emitBillGenerated({ _id: 'x', billNumber: 'X' });
    const r22 = sockets.emitLowStock([{ _id: 'x', sku: 'X' }]);
    assert('emitOrderNew → false (no crash)', r18 === false);
    assert('emitOrderUpdated → false', r19 === false);
    assert('emitPaymentReceived → false', r20 === false);
    assert('emitBillGenerated → false', r21 === false);
    assert('emitLowStock → false', r22 === false);

    // ─── Cleanup ───
    logger.info('\nCleanup');
    await cleanup();
    logger.info('  Test server closed; users + clients cleaned up');

    await mongoose.disconnect();

    logger.info('\n═══════════════════════════════════════');
    logger.info(`📊 Socket.IO Foundation (Section A): ${pass}/${pass + fail} passed`);
    if (failures.length > 0) {
      logger.info('\nFailures:');
      failures.forEach((f, i) => logger.info(`  ${i + 1}. ${f}`));
    }
    process.exit(fail === 0 ? 0 : 1);
  } catch (error) {
    logger.error('Test crashed:', error.message);
    logger.error(error.stack);
    try { await cleanup(); } catch {}
    try { await mongoose.disconnect(); } catch {}
    process.exit(1);
  }
};

test();
