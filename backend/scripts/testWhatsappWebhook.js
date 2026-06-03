require('dotenv').config();
if (process.env.NODE_ENV !== 'production') {
  const dns = require('dns');
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
}

const axios = require('axios');
const mongoose = require('mongoose');
const logger = require('../src/config/logger');
const { WhatsAppLog, Customer } = require('../src/models');

const BASE_URL = process.env.API_URL || 'http://localhost:5000';
const BYPASS = process.env.TEST_BYPASS_SECRET;
const VERIFY_TOKEN = process.env.WA_VERIFY_TOKEN?.trim();

// Webhook is PUBLIC — no auth header. But bypass header still useful
// for rate-limit avoidance on hot test runs.
const api = axios.create({
  baseURL: BASE_URL,
  headers: { 'x-test-bypass-ratelimit': BYPASS },
  validateStatus: () => true,
});

const TAG = 'WA_WEBHOOK_TEST';

// Build a Meta-style webhook payload
function buildPayload({ statuses, messages, errors, phoneId = '123456789' }) {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'BUSINESS_ACCOUNT_TEST_ID',
      changes: [{
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '15551234567', phone_number_id: phoneId },
          ...(messages ? { messages } : {}),
          ...(statuses ? { statuses } : {}),
          ...(errors ? { errors } : {}),
        },
        field: 'messages',
      }],
    }],
  };
}

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
    // ─── Setup ───
    logger.info('\nSetup');
    if (!VERIFY_TOKEN) {
      logger.error('WA_VERIFY_TOKEN missing — Section A added a placeholder');
      process.exit(1);
    }

    // Find a customer with a phone (for inbound matching tests)
    const customer = await Customer.findOne({ phone: { $exists: true, $ne: null }, isDeleted: false })
      .select('_id phone customerName').lean();
    assert('Customer with phone available', customer != null);
    const customerPhoneRaw = customer.phone;
    logger.info(`  Customer phone (raw): ${customerPhoneRaw}`);

    // ─── Test 1-4: GET /webhook verification handshake ───
    logger.info('\nTest 1-4: GET /api/whatsapp/webhook (Meta verification)');

    let res = await api.get('/api/whatsapp/webhook', {
      params: {
        'hub.mode': 'subscribe',
        'hub.verify_token': VERIFY_TOKEN,
        'hub.challenge': 'CHALLENGE_42',
      },
    });
    assert('Correct token → 200', res.status === 200, `Got ${res.status}`);
    assert('Correct token → returns challenge', String(res.data) === 'CHALLENGE_42', `Got: ${res.data}`);

    res = await api.get('/api/whatsapp/webhook', {
      params: {
        'hub.mode': 'subscribe',
        'hub.verify_token': 'WRONG_TOKEN',
        'hub.challenge': 'CHALLENGE_X',
      },
    });
    assert('Wrong token → 403', res.status === 403);

    res = await api.get('/api/whatsapp/webhook', {
      params: {
        'hub.mode': 'wrongmode',
        'hub.verify_token': VERIFY_TOKEN,
        'hub.challenge': 'CHALLENGE_X',
      },
    });
    assert('Wrong mode → 403', res.status === 403);

    res = await api.get('/api/whatsapp/webhook');
    assert('Missing params → 403', res.status === 403);

    // ─── Test 5: POST /webhook with empty payload (always 200) ───
    logger.info('\nTest 5: Empty payload');
    res = await api.post('/api/whatsapp/webhook', {}, {
      headers: { 'Content-Type': 'application/json' },
    });
    assert('Empty payload → 200', res.status === 200);

    // ─── Setup: Create an outbound WhatsAppLog to drive status updates ───
    logger.info('\nSetup: Outbound log to receive status updates');
    const outbound = await WhatsAppLog.create({
      to: '919876543210',
      customer: customer._id,
      type: 'BILL',
      templateName: 'bill_pdf_v1',
      waMessageId: 'wamid.test_webhook_outbound_1',
      payload: {},
      status: 'SENT',
      isMock: true,
    });
    assert('Outbound seed log created', outbound._id != null);

    // ─── Test 6: status DELIVERED applied ───
    logger.info('\nTest 6: status update → DELIVERED');
    res = await api.post('/api/whatsapp/webhook', buildPayload({
      statuses: [{
        id: 'wamid.test_webhook_outbound_1',
        status: 'delivered',
        timestamp: String(Math.floor(Date.now() / 1000)),
        recipient_id: '919876543210',
      }],
    }), { headers: { 'Content-Type': 'application/json' } });
    assert('Delivered webhook → 200', res.status === 200);

    let refreshed = await WhatsAppLog.findById(outbound._id).select('status').lean();
    assert('Log status → DELIVERED', refreshed.status === 'DELIVERED', `Got ${refreshed.status}`);

    // ─── Test 7: status READ applied ───
    logger.info('\nTest 7: status update → READ');
    res = await api.post('/api/whatsapp/webhook', buildPayload({
      statuses: [{
        id: 'wamid.test_webhook_outbound_1',
        status: 'read',
        timestamp: String(Math.floor(Date.now() / 1000)),
        recipient_id: '919876543210',
      }],
    }), { headers: { 'Content-Type': 'application/json' } });
    assert('Read webhook → 200', res.status === 200);

    refreshed = await WhatsAppLog.findById(outbound._id).select('status').lean();
    assert('Log status → READ', refreshed.status === 'READ', `Got ${refreshed.status}`);

    // ─── Test 8: idempotent — same READ twice doesn't break anything ───
    logger.info('\nTest 8: idempotent status (same READ twice)');
    res = await api.post('/api/whatsapp/webhook', buildPayload({
      statuses: [{
        id: 'wamid.test_webhook_outbound_1',
        status: 'read',
        timestamp: String(Math.floor(Date.now() / 1000)),
        recipient_id: '919876543210',
      }],
    }), { headers: { 'Content-Type': 'application/json' } });
    assert('Duplicate status → 200', res.status === 200);

    refreshed = await WhatsAppLog.findById(outbound._id).select('status').lean();
    assert('Status still READ', refreshed.status === 'READ');

    // ─── Test 9: status FAILED captures errorCode + errorMessage ───
    logger.info('\nTest 9: status update → FAILED with error');
    const outbound2 = await WhatsAppLog.create({
      to: '919876543210',
      customer: customer._id,
      type: 'PAYMENT_LINK',
      waMessageId: 'wamid.test_webhook_outbound_2',
      status: 'SENT',
      isMock: true,
    });

    res = await api.post('/api/whatsapp/webhook', buildPayload({
      statuses: [{
        id: 'wamid.test_webhook_outbound_2',
        status: 'failed',
        timestamp: String(Math.floor(Date.now() / 1000)),
        recipient_id: '919876543210',
        errors: [{
          code: 131047,
          title: 'Re-engagement message',
          message: 'Outside service window',
        }],
      }],
    }), { headers: { 'Content-Type': 'application/json' } });
    assert('Failed webhook → 200', res.status === 200);

    refreshed = await WhatsAppLog.findById(outbound2._id).select('status errorCode errorMessage').lean();
    assert('Log status → FAILED', refreshed.status === 'FAILED', `Got ${refreshed.status}`);
    assert('errorCode captured', refreshed.errorCode === '131047', `Got ${refreshed.errorCode}`);
    assert('errorMessage captured', refreshed.errorMessage === 'Re-engagement message');

    // ─── Test 10: status update for unknown waMessageId — graceful no-op ───
    logger.info('\nTest 10: Unknown waMessageId');
    res = await api.post('/api/whatsapp/webhook', buildPayload({
      statuses: [{
        id: 'wamid.test_does_not_exist_xyz',
        status: 'delivered',
        timestamp: String(Math.floor(Date.now() / 1000)),
      }],
    }), { headers: { 'Content-Type': 'application/json' } });
    assert('Unknown waMessageId → 200', res.status === 200);

    // ─── Test 11-13: inbound message handling ───
    logger.info('\nTest 11: inbound message creates INBOUND log');
    const inboundWamid = `wamid.test_inbound_${Date.now()}`;
    res = await api.post('/api/whatsapp/webhook', buildPayload({
      messages: [{
        from: customerPhoneRaw,
        id: inboundWamid,
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: 'text',
        text: { body: 'Hello business, I have a question' },
      }],
    }), { headers: { 'Content-Type': 'application/json' } });
    assert('Inbound webhook → 200', res.status === 200);

    const inboundLog = await WhatsAppLog.findOne({ waMessageId: inboundWamid, type: 'INBOUND' });
    assert('INBOUND log created', inboundLog != null);
    assert('Customer matched by phone', inboundLog?.customer?.toString() === customer._id.toString(),
      `Expected ${customer._id}, got ${inboundLog?.customer}`);

    // ─── Test 12: inbound idempotency (same waMessageId twice) ───
    logger.info('\nTest 12: inbound idempotency (same waMessageId twice)');
    res = await api.post('/api/whatsapp/webhook', buildPayload({
      messages: [{
        from: customerPhoneRaw,
        id: inboundWamid,
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: 'text',
        text: { body: 'duplicate' },
      }],
    }), { headers: { 'Content-Type': 'application/json' } });
    assert('Duplicate inbound → 200', res.status === 200);

    const inboundCount = await WhatsAppLog.countDocuments({ waMessageId: inboundWamid, type: 'INBOUND' });
    assert('Only ONE INBOUND log for waMessageId', inboundCount === 1, `Got count=${inboundCount}`);

    // ─── Test 13: inbound from unknown number → log with customer=null ───
    logger.info('\nTest 13: inbound from unknown number');
    const unknownWamid = `wamid.test_unknown_${Date.now()}`;
    res = await api.post('/api/whatsapp/webhook', buildPayload({
      messages: [{
        from: '919999999999', // unlikely to match any seeded customer
        id: unknownWamid,
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: 'text',
        text: { body: 'Hello from a stranger' },
      }],
    }), { headers: { 'Content-Type': 'application/json' } });
    assert('Unknown-from webhook → 200', res.status === 200);

    const unknownLog = await WhatsAppLog.findOne({ waMessageId: unknownWamid, type: 'INBOUND' });
    assert('Log created for unknown number', unknownLog != null);
    assert('customer is null/undefined for unknown', !unknownLog?.customer);

    // ─── Test 14: errors[] array logged (no crash) ───
    logger.info('\nTest 14: errors[] array');
    res = await api.post('/api/whatsapp/webhook', buildPayload({
      errors: [{
        code: 130472,
        title: 'User mobile number test failed',
        message: 'Some Meta-side error',
      }],
    }), { headers: { 'Content-Type': 'application/json' } });
    assert('errors[] webhook → 200', res.status === 200);

    // ─── Test 15: malformed JSON gracefully rejected ───
    logger.info('\nTest 15: malformed JSON');
    res = await api.post('/api/whatsapp/webhook', 'not-json{', {
      headers: { 'Content-Type': 'application/json' },
      transformRequest: [(data) => data],
    });
    assert('Malformed JSON → 400', res.status === 400, `Got ${res.status}`);

    // ─── Test 16: mixed payload — statuses + messages together ───
    logger.info('\nTest 16: mixed payload (statuses + messages in one delivery)');
    const mixedWamid = `wamid.test_mixed_${Date.now()}`;
    res = await api.post('/api/whatsapp/webhook', buildPayload({
      statuses: [{
        id: 'wamid.test_webhook_outbound_2',
        status: 'failed', // already failed — idempotent no-op expected
        timestamp: String(Math.floor(Date.now() / 1000)),
      }],
      messages: [{
        from: customerPhoneRaw,
        id: mixedWamid,
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: 'text',
        text: { body: 'Mixed delivery' },
      }],
    }), { headers: { 'Content-Type': 'application/json' } });
    assert('Mixed payload → 200', res.status === 200);

    const mixedInbound = await WhatsAppLog.findOne({ waMessageId: mixedWamid });
    assert('Mixed: inbound created', mixedInbound != null);

    // ─── Test 17: signature header missing — mock mode bypasses ───
    logger.info('\nTest 17: signature missing (mock-mode bypass)');
    res = await api.post('/api/whatsapp/webhook', buildPayload({
      statuses: [{
        id: 'wamid.test_no_sig',
        status: 'sent',
        timestamp: String(Math.floor(Date.now() / 1000)),
      }],
    }), { headers: { 'Content-Type': 'application/json' } });
    assert('No signature in mock mode → 200', res.status === 200);

    // ─── Test 18: empty entry array — graceful 200 ───
    logger.info('\nTest 18: empty entry array');
    res = await api.post('/api/whatsapp/webhook', { object: 'whatsapp_business_account', entry: [] }, {
      headers: { 'Content-Type': 'application/json' },
    });
    assert('Empty entry → 200', res.status === 200);

    // ─── Test 19: regression — other WA routes still require auth ───
    logger.info('\nTest 19: regression — /send-bill still requires auth');
    res = await api.post('/api/whatsapp/send-bill/507f1f77bcf86cd799439011', {});
    assert('Protected route unauthed → 401', res.status === 401, `Got ${res.status}`);

    // ─── Cleanup ───
    logger.info('\nCleanup');
    await WhatsAppLog.deleteMany({
      $or: [
        { waMessageId: { $regex: /^wamid\.test_/ } },
        { _id: outbound._id },
        { _id: outbound2._id },
      ],
    });
    logger.info('  Test logs deleted');

    await mongoose.disconnect();

    logger.info('\n═══════════════════════════════════════');
    logger.info(`📊 WhatsApp Webhook (Section C): ${pass}/${pass + fail} passed`);
    if (failures.length > 0) {
      logger.info('\nFailures:');
      failures.forEach((f, i) => logger.info(`  ${i + 1}. ${f}`));
    }

    process.exit(fail === 0 ? 0 : 1);
  } catch (error) {
    logger.error('Test crashed:', error);
    try { await mongoose.disconnect(); } catch {}
    process.exit(1);
  }
};

test();
