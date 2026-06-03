require('dotenv').config();
if (process.env.NODE_ENV !== 'production') {
  const dns = require('dns');
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
}

const mongoose = require('mongoose');
const crypto = require('crypto');
const { WhatsAppLog, Customer, SystemSetting } = require('../src/models');
const whatsappService = require('../src/utils/whatsappService');
const logger = require('../src/config/logger');

const test = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);

    let pass = 0, fail = 0;
    const failures = [];

    const assert = (name, condition, detail = '') => {
      if (condition) { pass++; logger.info(`  ✅ ${name}`); }
      else {
        fail++;
        const msg = `${name}${detail ? ` — ${detail}` : ''}`;
        logger.error(`  ❌ ${msg}`);
        failures.push(msg);
      }
    };

    // ─── Test 1: Mock-mode detection ───
    logger.info('\nTest 1: Mock-mode detection');
    const isMock = whatsappService.isMockMode();
    assert('isMockMode returns boolean', typeof isMock === 'boolean');
    assert('In MOCK mode (placeholder creds)', isMock === true, `Got ${isMock}`);

    // ─── Test 2: SystemSettings present ───
    logger.info('\nTest 2: SystemSettings');
    const waEnabled = await SystemSetting.getValue('WHATSAPP_ENABLED');
    const waFallback = await SystemSetting.getValue('WHATSAPP_FALLBACK_TO_EMAIL');
    assert('WHATSAPP_ENABLED is boolean', typeof waEnabled === 'boolean', `Got: ${waEnabled}`);
    assert('WHATSAPP_FALLBACK_TO_EMAIL is boolean', typeof waFallback === 'boolean');

    // ─── Test 3: formatPhone variants ───
    logger.info('\nTest 3: Phone normalization');
    assert('10-digit raw', whatsappService.formatPhone('9876543210') === '919876543210');
    assert('Leading 0', whatsappService.formatPhone('09876543210') === '919876543210');
    assert('Already prefixed 91', whatsappService.formatPhone('919876543210') === '919876543210');
    assert('+91 prefix', whatsappService.formatPhone('+919876543210') === '919876543210');
    assert('Spaces + +91', whatsappService.formatPhone('+91 98765 43210') === '919876543210');
    assert('Hyphenated', whatsappService.formatPhone('91-9876543210') === '919876543210');

    // ─── Test 4: formatPhone rejects invalid ───
    logger.info('\nTest 4: Phone rejection');
    const tryInvalid = (input) => {
      try { whatsappService.formatPhone(input); return false; }
      catch { return true; }
    };
    assert('Rejects empty', tryInvalid(''));
    assert('Rejects too short', tryInvalid('12345'));
    assert('Rejects too long', tryInvalid('1234567890123456'));
    assert('Rejects letters-only', tryInvalid('abcdefghij'));

    // ─── Test 5: Mock send returns expected shape ───
    logger.info('\nTest 5: Mock template send');
    const mockResponse = await whatsappService.sendTemplate('919876543210', 'test_template', []);
    assert('Has messaging_product', mockResponse.messaging_product === 'whatsapp');
    assert('Has messages array', Array.isArray(mockResponse.messages));
    assert('Has wamid', mockResponse.messages[0]?.id?.startsWith('wamid.mock_'));
    assert('_mock flag set', mockResponse._mock === true);

    // ─── Test 6: sendBillTemplate (mock) ───
    logger.info('\nTest 6: sendBillTemplate');
    const billResp = await whatsappService.sendBillTemplate({
      to: '9876543210',
      templateName: 'bill_pdf_v1',
      pdfUrl: 'https://example.com/test.pdf',
      customerName: 'Test Customer',
      billNumber: 'INV-2026-001',
      amount: '1500.00',
      filename: 'INV-2026-001.pdf',
    });
    assert('Bill template returns wamid', billResp.messages[0]?.id?.startsWith('wamid.mock_'));

    // ─── Test 7: sendPaymentLinkTemplate (mock) ───
    logger.info('\nTest 7: sendPaymentLinkTemplate');
    const payResp = await whatsappService.sendPaymentLinkTemplate({
      to: '9876543210',
      templateName: 'payment_link_v1',
      paymentLinkUrl: 'https://rzp.io/i/abc123',
      customerName: 'Test',
      amount: '1500',
      billNumber: 'INV-001',
    });
    assert('Payment link returns wamid', payResp.messages[0]?.id?.startsWith('wamid.mock_'));

    // ─── Test 8: sendOrderConfirmationTemplate (mock) ───
    logger.info('\nTest 8: sendOrderConfirmationTemplate');
    const oc = await whatsappService.sendOrderConfirmationTemplate({
      to: '9876543210',
      templateName: 'order_confirmation_v1',
      customerName: 'Test',
      orderNumber: 'ORD-2026-005',
      totalAmount: '2360',
    });
    assert('Order confirmation returns wamid', oc.messages[0]?.id?.startsWith('wamid.mock_'));

    // ─── Test 9: sendOrderReadyTemplate (mock) ───
    logger.info('\nTest 9: sendOrderReadyTemplate');
    const orRdy = await whatsappService.sendOrderReadyTemplate({
      to: '9876543210',
      templateName: 'order_ready_v1',
      customerName: 'Test',
      orderNumber: 'ORD-2026-005',
    });
    assert('Order ready returns wamid', orRdy.messages[0]?.id?.startsWith('wamid.mock_'));

    // ─── Test 10: sendTextMessage (mock) ───
    logger.info('\nTest 10: sendTextMessage');
    const txt = await whatsappService.sendTextMessage('9876543210', 'Hello from test');
    assert('Text returns wamid', txt.messages[0]?.id?.startsWith('wamid.mock_'));

    // ─── Test 11: Webhook challenge verification ───
    logger.info('\nTest 11: Webhook challenge');
    const correctVerifyToken = process.env.WA_VERIFY_TOKEN?.trim();
    const goodChallenge = whatsappService.verifyWebhookChallenge('subscribe', correctVerifyToken, 'CHALLENGE_123');
    assert('Correct token returns challenge', goodChallenge === 'CHALLENGE_123', `Got: ${goodChallenge}`);

    const badChallenge = whatsappService.verifyWebhookChallenge('subscribe', 'wrong_token', 'CHALLENGE_123');
    assert('Wrong token returns null', badChallenge === null);

    const wrongMode = whatsappService.verifyWebhookChallenge('unsubscribe', correctVerifyToken, 'CHALLENGE_123');
    assert('Wrong mode returns null', wrongMode === null);

    // ─── Test 12: Webhook signature (MOCK mode bypass) ───
    logger.info('\nTest 12: Webhook signature (mock mode)');
    // In mock mode all signatures pass through
    const mockSigOk = whatsappService.verifyWebhookSignature('{"any":"body"}', 'sha256=ignored');
    assert('Mock-mode bypass returns true', mockSigOk === true);

    const mockSigEmpty = whatsappService.verifyWebhookSignature('', '');
    assert('Mock-mode bypass even with empty', mockSigEmpty === true);

    // ─── Test 13: generateMockMessageId ───
    logger.info('\nTest 13: Mock message ID generator');
    const id1 = whatsappService.generateMockMessageId();
    const id2 = whatsappService.generateMockMessageId();
    assert('Has wamid.mock_ prefix', id1.startsWith('wamid.mock_'));
    assert('IDs are unique', id1 !== id2);

    // ─── Test 14: WhatsAppLog model — create ───
    logger.info('\nTest 14: WhatsAppLog model');
    const customer = await Customer.findOne({ isDeleted: false }).lean();
    if (!customer) {
      logger.warn('  ⚠ No customer found — using bare ObjectId for ref');
    }

    const log = await WhatsAppLog.create({
      to: '919876543210',
      customer: customer?._id,
      type: 'TEXT',
      payload: { text: { body: 'hello' } },
      waMessageId: whatsappService.generateMockMessageId(),
      status: 'SENT',
      isMock: true,
    });

    assert('Log created with _id', log._id != null);
    assert('Default status is SENT', log.status === 'SENT');
    assert('statusUpdatedAt defaulted', log.statusUpdatedAt instanceof Date);
    assert('retryCount default 0', log.retryCount === 0);

    // ─── Test 15: WhatsAppLog enum validation ───
    logger.info('\nTest 15: Schema enum validation');
    let typeRejected = false;
    try {
      await WhatsAppLog.create({ to: '919876543210', type: 'INVALID_TYPE', isMock: true });
    } catch (err) {
      typeRejected = err.name === 'ValidationError';
    }
    assert('Invalid type rejected by schema', typeRejected);

    let statusRejected = false;
    try {
      await WhatsAppLog.create({
        to: '919876543210', type: 'TEXT', status: 'UNKNOWN_STATUS', isMock: true,
      });
    } catch (err) {
      statusRejected = err.name === 'ValidationError';
    }
    assert('Invalid status rejected by schema', statusRejected);

    // ─── Test 16: applyStatusUpdate helper ───
    logger.info('\nTest 16: applyStatusUpdate helper');
    const prevUpdatedAt = log.statusUpdatedAt;
    await new Promise(r => setTimeout(r, 10));
    await log.applyStatusUpdate('DELIVERED');
    assert('Status → DELIVERED', log.status === 'DELIVERED');
    assert('statusUpdatedAt advanced', log.statusUpdatedAt > prevUpdatedAt);

    await log.applyStatusUpdate('FAILED', '131047', 'Outside service window');
    assert('Status → FAILED', log.status === 'FAILED');
    assert('errorCode captured', log.errorCode === '131047');
    assert('errorMessage captured', log.errorMessage === 'Outside service window');

    // ─── Test 17: Models index export ───
    logger.info('\nTest 17: Models index');
    const m = require('../src/models');
    assert('WhatsAppLog exported', !!m.WhatsAppLog);
    assert('Model count = 16', Object.keys(m).length === 16, `Got ${Object.keys(m).length}`);

    // ─── Cleanup ───
    logger.info('\nCleanup');
    await WhatsAppLog.deleteOne({ _id: log._id });
    logger.info('  Test log deleted');

    await mongoose.disconnect();

    logger.info('\n═══════════════════════════════════════');
    logger.info(`📊 WhatsApp Foundation (Section A): ${pass}/${pass + fail} passed`);
    if (failures.length > 0) {
      logger.info('\nFailures:');
      failures.forEach((f, i) => logger.info(`  ${i + 1}. ${f}`));
    }
    logger.info(`\nMode: ${isMock ? 'MOCK (placeholder credentials)' : 'LIVE'}`);

    process.exit(fail === 0 ? 0 : 1);
  } catch (error) {
    logger.error('Test crashed:', error);
    try { await mongoose.disconnect(); } catch {}
    process.exit(1);
  }
};

test();
