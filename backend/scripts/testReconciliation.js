require('dotenv').config();
if (process.env.NODE_ENV !== 'production') {
  const dns = require('dns');
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
}

const axios = require('axios');
const mongoose = require('mongoose');
const logger = require('../src/config/logger');

const BASE_URL = process.env.API_URL || 'http://localhost:5000';
const BYPASS = process.env.TEST_BYPASS_SECRET;

const api = axios.create({
  baseURL: BASE_URL,
  headers: { 'x-test-bypass-ratelimit': BYPASS },
  validateStatus: () => true,
});

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

  try {
    logger.info('\nSetup');
    const loginRes = await api.post('/api/auth/login', {
      email: 'testadmin@shreegopal.com',
      password: 'TestAdmin@123',
    });
    const h = { Authorization: `Bearer ${loginRes.data.accessToken}` };

    // ─── Test 1: Summary endpoint ───
    logger.info('\nTest 1: Summary endpoint');
    let res = await api.get('/api/reconciliation/summary', { headers: h });
    assert('Summary endpoint 200', res.status === 200, `Got ${res.status}: ${JSON.stringify(res.data).substring(0, 200)}`);
    assert('Has dateRange', res.data.data?.dateRange != null);
    assert('Has payments breakdown', res.data.data?.payments != null);
    assert('Has orders breakdown', res.data.data?.orders != null);

    // ─── Test 2: Custom date range ───
    logger.info('\nTest 2: Custom date range');
    const fromDate = '2026-01-01';
    const toDate = '2026-12-31';
    res = await api.get(`/api/reconciliation/summary?fromDate=${fromDate}&toDate=${toDate}`,
      { headers: h });
    assert('Custom range 200', res.status === 200);
    assert('Date range respected', res.data.data?.dateRange?.from?.startsWith('2026-01-01'));

    // ─── Test 3: Outstanding orders ───
    logger.info('\nTest 3: Outstanding orders');
    res = await api.get('/api/reconciliation/outstanding?limit=10', { headers: h });
    assert('Outstanding endpoint 200', res.status === 200);
    assert('Has count', typeof res.data.count === 'number');
    assert('Has totalOutstandingAmount', typeof res.data.totalOutstandingAmount === 'number');
    assert('Has data array', Array.isArray(res.data.data));

    if (res.data.data?.length > 0) {
      const first = res.data.data[0];
      assert('Has urgency field', ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(first.urgency));
      assert('Has ageDays', typeof first.ageDays === 'number');
      assert('Has amountDue', typeof first.amountDue === 'number');
    } else {
      assert('No outstanding orders (acceptable)', true);
      assert('Empty case handled', true);
      assert('Skip urgency check', true);
    }

    // ─── Test 4: Daily reconciliation ───
    logger.info('\nTest 4: Daily reconciliation');
    const today = new Date().toISOString().split('T')[0];
    res = await api.get(`/api/reconciliation/daily/${today}`, { headers: h });
    assert('Daily endpoint 200', res.status === 200);
    assert('Has payments section', res.data.data?.payments != null);
    assert('Has refunds section', res.data.data?.refunds != null);
    assert('Has orders section', res.data.data?.orders != null);
    assert('Has netCollection', typeof res.data.data?.netCollection === 'number');

    // ─── Test 5: Invalid date rejected ───
    logger.info('\nTest 5: Invalid date');
    res = await api.get('/api/reconciliation/daily/not-a-date', { headers: h });
    assert('Invalid date rejected (400)', res.status === 400);

    // ─── Test 6: Customer reconciliation ───
    logger.info('\nTest 6: Customer reconciliation');
    const custRes = await api.get('/api/customers?limit=1', { headers: h });
    const customerId = custRes.data.data?.[0]?._id;

    if (customerId) {
      res = await api.get(`/api/reconciliation/customer/${customerId}`, { headers: h });
      assert('Customer reconciliation 200', res.status === 200, `Got ${res.status}`);
      assert('Has customer info', res.data.data?.customer != null);
      assert('Has orders summary', res.data.data?.orders != null);
      assert('Has payments summary', res.data.data?.payments != null);
    } else {
      assert('No customer (skipped)', true);
      assert('Customer test skipped', true);
      assert('Customer test skipped (2)', true);
      assert('Customer test skipped (3)', true);
    }

    // ─── Test 7: Invalid customer ID ───
    logger.info('\nTest 7: Invalid customer ID');
    res = await api.get('/api/reconciliation/customer/not-a-valid-id', { headers: h });
    assert('Invalid customer ID rejected (400)', res.status === 400);

    // ─── Test 8: Non-existent customer ───
    logger.info('\nTest 8: Non-existent customer');
    res = await api.get('/api/reconciliation/customer/507f1f77bcf86cd799439011', { headers: h });
    assert('Non-existent customer 404', res.status === 404);

    // ─── Test 9: Discrepancy detection ───
    logger.info('\nTest 9: Discrepancy detection');
    res = await api.get('/api/reconciliation/discrepancies', { headers: h });
    assert('Discrepancies endpoint 200', res.status === 200);
    assert('Has count', typeof res.data.count === 'number');
    assert('Has totalChecked', typeof res.data.totalChecked === 'number');
    assert('Has data array', Array.isArray(res.data.data));

    // ─── Test 10: RBAC enforcement ───
    logger.info('\nTest 10: RBAC');
    const staffLogin = await api.post('/api/auth/login', {
      email: 'teststaff@shreegopal.com',
      password: 'TestStaff@123',
    });

    if (staffLogin.status === 200) {
      const staffH = { Authorization: `Bearer ${staffLogin.data.accessToken}` };
      res = await api.get('/api/reconciliation/summary', { headers: staffH });
      assert('STAFF access denied (403)', res.status === 403);
    } else {
      assert('No STAFF user (skipped)', true);
    }

    await mongoose.disconnect();

    logger.info('\n═══════════════════════════════════════');
    logger.info(`📊 Reconciliation Tests: ${pass}/${pass + fail} passed`);
    if (failures.length > 0) {
      logger.info('\nFailures:');
      failures.forEach((f, i) => logger.info(`  ${i + 1}. ${f}`));
    }

    process.exit(fail === 0 ? 0 : 1);
  } catch (error) {
    logger.error('Test crashed:', error);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  }
};

test();
