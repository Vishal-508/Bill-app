require('dotenv').config();
if (process.env.NODE_ENV !== 'production') {
  const dns = require('dns');
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
}

const axios = require('axios');
const mongoose = require('mongoose');
const logger = require('../src/config/logger');
const { WhatsAppLog, EmailLog, Customer, User } = require('../src/models');

const BASE_URL = process.env.API_URL || 'http://localhost:5000';
const BYPASS = process.env.TEST_BYPASS_SECRET;

const api = axios.create({
  baseURL: BASE_URL,
  headers: { 'x-test-bypass-ratelimit': BYPASS },
  validateStatus: () => true,
});

const TAG = 'LOGS_F_TEST'; // marker for cleanup
const TEST_PHONE = '919999988887';
const TEST_EMAIL = 'logs-f-test@example.local';

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

  const seededLogIds = { wa: [], email: [] };

  try {
    // ─── Setup: Auth ───
    logger.info('\nSetup: Auth');
    const loginRes = await api.post('/api/auth/login', {
      email: 'testadmin@shreegopal.com',
      password: 'TestAdmin@123',
    });
    assert('Admin login (200)', loginRes.status === 200);
    const h = { Authorization: `Bearer ${loginRes.data.accessToken}` };

    const customer = await Customer.findOne({
      isDeleted: false,
    }).select('_id customerName phone email').lean();
    assert('Customer for ref', customer != null);

    // ─── Seed: 3 WhatsApp logs of distinct types + statuses ───
    logger.info('\nSetup: Seed test logs');
    const waBill = await WhatsAppLog.create({
      to: TEST_PHONE,
      customer: customer._id,
      type: 'BILL',
      templateName: 'bill_pdf_v1',
      waMessageId: `wamid.${TAG}_${Date.now()}_b`,
      status: 'SENT',
      isMock: true,
      payload: { tag: TAG },
    });
    seededLogIds.wa.push(waBill._id);

    const waPayLink = await WhatsAppLog.create({
      to: TEST_PHONE,
      customer: customer._id,
      type: 'PAYMENT_LINK',
      templateName: 'payment_link_v1',
      waMessageId: `wamid.${TAG}_${Date.now()}_p`,
      status: 'DELIVERED',
      isMock: true,
      payload: { tag: TAG },
    });
    seededLogIds.wa.push(waPayLink._id);

    const waInbound = await WhatsAppLog.create({
      to: TEST_PHONE,
      customer: customer._id,
      type: 'INBOUND',
      waMessageId: `wamid.${TAG}_${Date.now()}_i`,
      status: 'SENT',
      isMock: true,
      payload: { tag: TAG, text: { body: 'hello there' } },
    });
    seededLogIds.wa.push(waInbound._id);

    // ─── Seed: 2 email logs ───
    const emailBill = await EmailLog.create({
      to: TEST_EMAIL,
      customer: customer._id,
      type: 'BILL',
      subject: `Invoice ${TAG} from Shree Gopal MDF`,
      emailMessageId: `mock_${TAG}_${Date.now()}_b`,
      status: 'SENT',
      isMock: true,
      payload: { tag: TAG },
    });
    seededLogIds.email.push(emailBill._id);

    const emailFail = await EmailLog.create({
      to: TEST_EMAIL,
      customer: customer._id,
      type: 'PAYMENT_LINK',
      subject: `Payment due — ${TAG}`,
      status: 'FAILED',
      errorMessage: 'Simulated transport error',
      errorCode: 'EAUTH',
      isMock: true,
      payload: { tag: TAG },
    });
    seededLogIds.email.push(emailFail._id);

    assert('Seeded 3 WhatsApp + 2 email logs',
      seededLogIds.wa.length === 3 && seededLogIds.email.length === 2);

    // ─── Test 1: WhatsApp logs — paginated list ───
    logger.info('\nTest 1: GET /api/whatsapp/logs');
    let res = await api.get('/api/whatsapp/logs?limit=50', { headers: h });
    assert('WA logs 200', res.status === 200, `Got ${res.status}`);
    assert('WA logs has pagination', res.data.pagination != null);
    assert('WA logs has data array', Array.isArray(res.data.data));

    const seenWaIds = res.data.data.map(d => d._id);
    const ourCount = seededLogIds.wa.filter(id => seenWaIds.includes(String(id))).length;
    assert('All 3 seeded WA logs visible', ourCount === 3, `Found ${ourCount}/3`);

    // ─── Test 2: Filter type=BILL ───
    logger.info('\nTest 2: WA filter type=BILL');
    res = await api.get('/api/whatsapp/logs?type=BILL&limit=50', { headers: h });
    assert('WA filter type=BILL 200', res.status === 200);
    const billOnly = res.data.data.every(d => d.type === 'BILL');
    assert('All results are BILL type', billOnly);

    // ─── Test 3: Filter status=DELIVERED ───
    logger.info('\nTest 3: WA filter status=DELIVERED');
    res = await api.get('/api/whatsapp/logs?status=DELIVERED&limit=50', { headers: h });
    assert('WA filter status=DELIVERED 200', res.status === 200);
    const deliveredOnly = res.data.data.every(d => d.status === 'DELIVERED');
    assert('All results are DELIVERED status', deliveredOnly);

    // ─── Test 4: Filter by customer ───
    logger.info('\nTest 4: WA filter by customer');
    res = await api.get(`/api/whatsapp/logs?customer=${customer._id}&limit=50`, { headers: h });
    assert('WA filter customer 200', res.status === 200);
    const allOurs = res.data.data.every(d => String(d.customer?._id || d.customer) === String(customer._id));
    assert('All results match customer', allOurs);

    // ─── Test 5: Date range filter ───
    logger.info('\nTest 5: WA date range filter');
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    res = await api.get(
      `/api/whatsapp/logs?dateFrom=${yesterday}&dateTo=${tomorrow}&limit=50`,
      { headers: h }
    );
    assert('WA date range 200', res.status === 200);
    assert('Includes our recently-seeded logs', res.data.data.some(d => seededLogIds.wa.map(String).includes(d._id)));

    // ─── Test 6: Pagination ───
    logger.info('\nTest 6: WA pagination page=2 limit=1');
    res = await api.get('/api/whatsapp/logs?page=2&limit=1', { headers: h });
    assert('Pagination 200', res.status === 200);
    assert('limit honored (data.length <= 1)', res.data.data.length <= 1);
    assert('page echoed = 2', res.data.pagination.page === 2);
    assert('totalPages computed', typeof res.data.pagination.totalPages === 'number');

    // ─── Test 7: WA log detail ───
    logger.info('\nTest 7: GET /api/whatsapp/logs/:id');
    res = await api.get(`/api/whatsapp/logs/${waBill._id}`, { headers: h });
    assert('Detail 200', res.status === 200);
    assert('Has full payload', res.data.data?.payload != null);
    assert('Customer populated', res.data.data?.customer?.customerName != null);

    // ─── Test 8: WA log stats ───
    logger.info('\nTest 8: GET /api/whatsapp/logs/stats');
    res = await api.get('/api/whatsapp/logs/stats', { headers: h });
    assert('Stats 200', res.status === 200);
    assert('Has byType', typeof res.data.data?.byType === 'object');
    assert('Has byStatus', typeof res.data.data?.byStatus === 'object');
    assert('Has total >= 3', res.data.data?.total >= 3);

    // ─── Test 9: Email logs ───
    logger.info('\nTest 9: GET /api/email/logs');
    res = await api.get('/api/email/logs?limit=50', { headers: h });
    assert('Email logs 200', res.status === 200);
    const seenEmailIds = res.data.data.map(d => d._id);
    const emailOurs = seededLogIds.email.filter(id => seenEmailIds.includes(String(id))).length;
    assert('Both seeded email logs visible', emailOurs === 2, `Found ${emailOurs}/2`);

    // ─── Test 10: Email filter type=BILL ───
    logger.info('\nTest 10: Email filter type=BILL');
    res = await api.get('/api/email/logs?type=BILL&limit=50', { headers: h });
    assert('Email filter 200', res.status === 200);
    assert('All results BILL type', res.data.data.every(d => d.type === 'BILL'));

    // ─── Test 11: Email log detail ───
    logger.info('\nTest 11: GET /api/email/logs/:id');
    res = await api.get(`/api/email/logs/${emailFail._id}`, { headers: h });
    assert('Email detail 200', res.status === 200);
    assert('errorMessage captured', res.data.data?.errorMessage === 'Simulated transport error');
    assert('errorCode captured', res.data.data?.errorCode === 'EAUTH');

    // ─── Test 12: Email log stats ───
    logger.info('\nTest 12: GET /api/email/logs/stats');
    res = await api.get('/api/email/logs/stats', { headers: h });
    assert('Email stats 200', res.status === 200);
    assert('byStatus.FAILED >= 1', (res.data.data?.byStatus?.FAILED || 0) >= 1);

    // ─── Test 13: WA health (mock mode) ───
    logger.info('\nTest 13: GET /api/whatsapp/health');
    res = await api.get('/api/whatsapp/health', { headers: h });
    assert('WA health 200', res.status === 200);
    assert('WA health.status = mock', res.data?.status === 'mock', `Got ${res.data?.status}`);

    // ─── Test 14: Email health — depends on whether real SMTP configured ───
    // The backend has its own env (real EMAIL_HOST=smtp.gmail.com), so this
    // hits LIVE-mode transport.verify(). We accept either ok or error here —
    // the test verifies the ENDPOINT works, not the SMTP credentials.
    logger.info('\nTest 14: GET /api/email/health');
    res = await api.get('/api/email/health', { headers: h });
    assert('Email health responds', [200, 503].includes(res.status), `Got ${res.status}`);
    assert('Email health has status field',
      ['mock', 'ok', 'error'].includes(res.data?.status),
      `Got status=${res.data?.status}`);

    // ─── Test 15: Combined notifications health ───
    logger.info('\nTest 15: GET /api/notifications/health');
    res = await api.get('/api/notifications/health', { headers: h });
    assert('Notifications health responds', [200, 503].includes(res.status), `Got ${res.status}`);
    assert('Has whatsapp + email + overall',
      res.data?.whatsapp != null && res.data?.email != null && res.data?.overall != null);
    assert('overall in valid enum',
      ['ok', 'degraded', 'down'].includes(res.data?.overall));

    // ─── Test 16: Auth required ───
    logger.info('\nTest 16: Auth required on logs');
    res = await api.get('/api/whatsapp/logs');
    assert('Unauthed → 401', res.status === 401, `Got ${res.status}`);

    res = await api.get('/api/email/logs');
    assert('Unauthed email → 401', res.status === 401, `Got ${res.status}`);

    // ─── Test 17: RBAC — CUTTING role on health endpoints ───
    logger.info('\nTest 17: RBAC — CUTTING denied on /health endpoints');
    const CUTTING_EMAIL = `cutting-${TAG.toLowerCase()}@shreegopal.local`;
    const CUTTING_PASS = 'CuttingTest@123';

    // Idempotent — clean any leftover from a prior failed run
    await User.deleteMany({ email: CUTTING_EMAIL });
    const cuttingUser = await User.create({
      name: 'Cutting Test User',
      email: CUTTING_EMAIL,
      password: CUTTING_PASS,
      role: 'CUTTING',
      isActive: true,
    });
    assert('CUTTING user created', cuttingUser != null && cuttingUser.role === 'CUTTING');

    const cuttingLogin = await api.post('/api/auth/login', {
      email: CUTTING_EMAIL,
      password: CUTTING_PASS,
    });
    assert('CUTTING login 200', cuttingLogin.status === 200, `Got ${cuttingLogin.status}`);
    const ch = { Authorization: `Bearer ${cuttingLogin.data.accessToken}` };

    // CUTTING → /whatsapp/health = 403 (admin-only)
    res = await api.get('/api/whatsapp/health', { headers: ch });
    assert('CUTTING → /whatsapp/health → 403', res.status === 403, `Got ${res.status}`);

    // CUTTING → /email/health = 403 (admin-only)
    res = await api.get('/api/email/health', { headers: ch });
    assert('CUTTING → /email/health → 403', res.status === 403, `Got ${res.status}`);

    // CUTTING → /notifications/health = OK (open to all staff)
    res = await api.get('/api/notifications/health', { headers: ch });
    assert('CUTTING → /notifications/health → 200 or 503 (allowed, not forbidden)',
      res.status !== 403 && res.status !== 401, `Got ${res.status}`);

    // CUTTING → /whatsapp/logs = OK (all staff can read logs)
    res = await api.get('/api/whatsapp/logs?limit=5', { headers: ch });
    assert('CUTTING → /whatsapp/logs → 200 (all staff allowed)', res.status === 200, `Got ${res.status}`);

    // ─── Cleanup ───
    logger.info('\nCleanup');
    await WhatsAppLog.deleteMany({ _id: { $in: seededLogIds.wa } });
    await EmailLog.deleteMany({ _id: { $in: seededLogIds.email } });
    await User.deleteMany({ email: CUTTING_EMAIL });
    logger.info('  Seeded logs + CUTTING user deleted');

    await mongoose.disconnect();

    logger.info('\n═══════════════════════════════════════');
    logger.info(`📊 Notification Logs + Health (Section F): ${pass}/${pass + fail} passed`);
    if (failures.length > 0) {
      logger.info('\nFailures:');
      failures.forEach((f, i) => logger.info(`  ${i + 1}. ${f}`));
    }

    process.exit(fail === 0 ? 0 : 1);
  } catch (error) {
    logger.error('Test crashed:', error);
    try {
      await WhatsAppLog.deleteMany({ _id: { $in: seededLogIds.wa } });
      await EmailLog.deleteMany({ _id: { $in: seededLogIds.email } });
      await User.deleteMany({ email: { $regex: TAG.toLowerCase(), $options: 'i' } });
    } catch {}
    try { await mongoose.disconnect(); } catch {}
    process.exit(1);
  }
};

test();
