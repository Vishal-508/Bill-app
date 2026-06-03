require('dotenv').config();
// Force email service into mock mode (overrides backend .env that has real SMTP creds).
// This must run BEFORE require('emailService') executes, so set it first.
process.env.EMAIL_HOST = 'PLACEHOLDER_FOR_TEST';
process.env.EMAIL_USER = 'PLACEHOLDER_FOR_TEST';
process.env.EMAIL_PASS = 'PLACEHOLDER_FOR_TEST';
// Skip cron registration in the test process — we drive retry directly.
process.env.DISABLE_CRONS = 'true';

if (process.env.NODE_ENV !== 'production') {
  const dns = require('dns');
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
}

const axios = require('axios');
const mongoose = require('mongoose');
const logger = require('../src/config/logger');
const { WhatsAppLog, EmailLog, Customer, SystemSetting } = require('../src/models');
const retryService = require('../src/services/notificationRetry.service');
const whatsappService = require('../src/utils/whatsappService');
const emailService = require('../src/utils/emailService');

const BASE_URL = process.env.API_URL || 'http://localhost:5000';
const BYPASS = process.env.TEST_BYPASS_SECRET;

const api = axios.create({
  baseURL: BASE_URL,
  headers: { 'x-test-bypass-ratelimit': BYPASS },
  validateStatus: () => true,
});

const TAG = 'RETRY_G_TEST';
const TEST_PHONE = '919999988886';
const TEST_EMAIL = 'retry-g-test@example.local';

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

  // Track originals for monkey-patch restore
  const originalSendBillTemplate = whatsappService.sendBillTemplate;
  const originalSendBillEmail = emailService.sendBillEmail;

  // Cleanup function — invoked at end + in catch
  const cleanup = async () => {
    await WhatsAppLog.deleteMany({ to: { $regex: TEST_PHONE, $options: 'i' } });
    await EmailLog.deleteMany({ to: TEST_EMAIL });
    // Restore original send functions
    whatsappService.sendBillTemplate = originalSendBillTemplate;
    emailService.sendBillEmail = originalSendBillEmail;
    // Reset any system-setting override to default
    await SystemSetting.findOneAndUpdate(
      { key: 'NOTIFICATION_RETRY_ENABLED' },
      { $set: { value: true } },
      { upsert: false }
    );
  };

  try {
    // ─── Setup: Auth ───
    logger.info('\nSetup: Auth');
    const loginRes = await api.post('/api/auth/login', {
      email: 'testadmin@shreegopal.com',
      password: 'TestAdmin@123',
    });
    assert('Admin login (200)', loginRes.status === 200);
    const h = { Authorization: `Bearer ${loginRes.data.accessToken}` };

    const customer = await Customer.findOne({ isDeleted: false })
      .select('_id customerName phone email').lean();
    assert('Customer for ref', customer != null);

    // ─── Helper: seed a FAILED WhatsAppLog ───
    const seedWaFailed = async (overrides = {}) => {
      const sendArgs = {
        to: TEST_PHONE,
        templateName: 'bill_pdf_v1',
        pdfUrl: 'https://example.com/test.pdf',
        customerName: 'Test',
        billNumber: `${TAG}-${Date.now()}`,
        amount: 100,
        filename: 'test.pdf',
      };
      return await WhatsAppLog.create({
        to: TEST_PHONE,
        customer: customer._id,
        type: 'BILL',
        templateName: 'bill_pdf_v1',
        status: 'FAILED',
        errorMessage: 'Simulated initial failure',
        retryCount: 0,
        retryContext: { sendFn: 'sendBillTemplate', args: sendArgs },
        isMock: true,
        payload: { tag: TAG },
        ...overrides,
      });
    };

    // ─── Test 1: Eligible logs are picked up (status=FAILED, retryCount<3) ───
    logger.info('\nTest 1: Eligible FAILED logs are picked up by retry');
    const log1 = await seedWaFailed();
    const result1 = await retryService.retryFailedWhatsAppMessages();
    const log1After = await WhatsAppLog.findById(log1._id).lean();
    assert('Retry processed >= 1 log', result1.processed >= 1, `processed=${result1.processed}`);
    assert('Log1 status flipped to SENT (mock succeeds by default)',
      log1After.status === 'SENT', `Got ${log1After.status}`);
    assert('Log1 retryCount = 1', log1After.retryCount === 1, `Got ${log1After.retryCount}`);
    assert('Log1 nextRetryAt cleared', !log1After.nextRetryAt);
    assert('Log1 lastRetryAt set', log1After.lastRetryAt != null);

    // ─── Test 2: retryCount >= MAX_RETRIES skipped ───
    logger.info('\nTest 2: Logs with retryCount=3 are skipped');
    const log2 = await seedWaFailed({ retryCount: 3 });
    const result2 = await retryService.retryFailedWhatsAppMessages();
    const log2After = await WhatsAppLog.findById(log2._id).lean();
    assert('Log2 retryCount unchanged = 3', log2After.retryCount === 3, `Got ${log2After.retryCount}`);
    assert('Log2 status still FAILED', log2After.status === 'FAILED');
    void result2;

    // ─── Test 3: createdAt older than 24h skipped ───
    logger.info('\nTest 3: Logs older than 24h are skipped');
    const log3 = await seedWaFailed();
    // Bypass Mongoose timestamps via raw driver
    const oldDate = new Date(Date.now() - 48 * 60 * 60 * 1000);
    await WhatsAppLog.collection.updateOne(
      { _id: log3._id },
      { $set: { createdAt: oldDate } }
    );
    await retryService.retryFailedWhatsAppMessages();
    const log3After = await WhatsAppLog.findById(log3._id).lean();
    assert('Log3 status unchanged (still FAILED — too old)',
      log3After.status === 'FAILED', `Got ${log3After.status}`);
    assert('Log3 retryCount unchanged = 0', log3After.retryCount === 0);

    // ─── Test 4: nextRetryAt in future is respected ───
    logger.info('\nTest 4: Future nextRetryAt → skip');
    const future = new Date(Date.now() + 60 * 60 * 1000); // +1h
    const log4 = await seedWaFailed({ retryCount: 1, nextRetryAt: future });
    await retryService.retryFailedWhatsAppMessages();
    const log4After = await WhatsAppLog.findById(log4._id).lean();
    assert('Log4 retryCount unchanged = 1', log4After.retryCount === 1);
    assert('Log4 status still FAILED', log4After.status === 'FAILED');

    // ─── Test 5: Failed retry → retryCount++ + backoff ───
    logger.info('\nTest 5: Failed retry increments + schedules backoff');
    // Monkey-patch: force the WhatsApp BILL send to throw
    whatsappService.sendBillTemplate = async () => {
      throw new Error('Simulated transient failure');
    };
    const beforeFailedRetry = Date.now();
    const log5 = await seedWaFailed();
    await retryService.retryFailedWhatsAppMessages();
    const log5After = await WhatsAppLog.findById(log5._id).lean();
    assert('Log5 retryCount = 1', log5After.retryCount === 1);
    assert('Log5 status still FAILED', log5After.status === 'FAILED');
    assert('Log5 errorMessage contains "Simulated"',
      (log5After.errorMessage || '').includes('Simulated'),
      `Got: ${log5After.errorMessage}`);
    const expectedBackoffMs = 5 * 60 * 1000;
    const actualBackoffMs = log5After.nextRetryAt ? log5After.nextRetryAt.getTime() - beforeFailedRetry : 0;
    assert('Log5 nextRetryAt ≈ now + 5min (within ±15s)',
      Math.abs(actualBackoffMs - expectedBackoffMs) < 15000,
      `Got ${actualBackoffMs}ms`);

    // ─── Test 6: 3rd failed retry → PERMANENTLY_FAILED ───
    logger.info('\nTest 6: After 3rd failed retry → PERMANENTLY_FAILED');
    const log6 = await seedWaFailed({ retryCount: 2 });
    await retryService.retryFailedWhatsAppMessages();
    const log6After = await WhatsAppLog.findById(log6._id).lean();
    assert('Log6 retryCount = 3', log6After.retryCount === 3);
    assert('Log6 status = PERMANENTLY_FAILED',
      log6After.status === 'PERMANENTLY_FAILED', `Got ${log6After.status}`);
    assert('Log6 permanentlyFailedAt set', log6After.permanentlyFailedAt != null);
    assert('Log6 nextRetryAt cleared', !log6After.nextRetryAt);

    // ─── Restore monkey-patch ───
    whatsappService.sendBillTemplate = originalSendBillTemplate;

    // ─── Test 7: Email retry success path ───
    logger.info('\nTest 7: Email retry — success path (mock mode)');
    const emailLog7 = await EmailLog.create({
      to: TEST_EMAIL,
      customer: customer._id,
      type: 'BILL',
      subject: `${TAG} retry test`,
      status: 'FAILED',
      errorMessage: 'Initial failure',
      retryCount: 0,
      retryContext: {
        sendFn: 'sendBillEmail',
        args: {
          to: TEST_EMAIL,
          customerName: 'Retry Test',
          invoiceNo: `${TAG}-INV`,
          amount: 500,
        },
      },
      isMock: true,
      payload: { tag: TAG },
    });
    await retryService.retryFailedEmails();
    const emailLog7After = await EmailLog.findById(emailLog7._id).lean();
    assert('EmailLog7 status = SENT (mock retry success)',
      emailLog7After.status === 'SENT', `Got ${emailLog7After.status}`);
    assert('EmailLog7 retryCount = 1', emailLog7After.retryCount === 1);
    assert('EmailLog7 nextRetryAt cleared', !emailLog7After.nextRetryAt);

    // ─── Test 8: Alerting fires for newly permanently-failed ───
    logger.info('\nTest 8: Alerting fires (mock mode → no real email)');
    // log6 from Test 6 has permanentlyFailedAt + alertSent=false
    const alertResult = await retryService.alertPermanentlyFailed();
    assert('Alert.whatsappCount >= 1', alertResult.whatsappCount >= 1,
      `Got ${alertResult.whatsappCount}`);
    assert('Alert.mock = true (emailService in mock mode)', alertResult.mock === true);
    const log6AfterAlert = await WhatsAppLog.findById(log6._id).lean();
    assert('Log6 alertSent = true after alerting', log6AfterAlert.alertSent === true);

    // Idempotency: second call should not re-alert the same log
    const alertResult2 = await retryService.alertPermanentlyFailed();
    const recentlyAlertedAgain = alertResult2.whatsappCount;
    assert('Second alert call does not re-alert (whatsappCount = 0)',
      recentlyAlertedAgain === 0, `Got ${recentlyAlertedAgain}`);

    // ─── Test 9: POST /api/notifications/retry-now ───
    logger.info('\nTest 9: POST /api/notifications/retry-now');
    const log9 = await seedWaFailed();
    const triggerRes = await api.post('/api/notifications/retry-now', {}, { headers: h });
    assert('Retry-now 200', triggerRes.status === 200, `Got ${triggerRes.status}`);
    assert('Response has whatsapp summary',
      triggerRes.data?.data?.whatsapp != null);
    assert('Response has email summary',
      triggerRes.data?.data?.email != null);
    assert('Response has alerts summary',
      triggerRes.data?.data?.alerts != null);
    void log9;

    // ─── Test 10: NOTIFICATION_RETRY_ENABLED=false → cron skips work ───
    logger.info('\nTest 10: Disabled setting → retry skips');
    // Upsert with all required fields (cope with case where setting doesn't exist yet)
    await SystemSetting.findOneAndUpdate(
      { key: 'NOTIFICATION_RETRY_ENABLED' },
      {
        $set: { value: false },
        $setOnInsert: {
          label: 'Notification Retry Cron Enabled',
          description: 'Master switch for the failed-notification retry cron',
          valueType: 'boolean',
          defaultValue: true,
          category: 'GENERAL',
        },
      },
      { upsert: true }
    );
    const log10 = await seedWaFailed();
    const result10 = await retryService.retryFailedWhatsAppMessages();
    const log10After = await WhatsAppLog.findById(log10._id).lean();
    assert('Result.disabled = true', result10.disabled === true);
    assert('Log10 untouched (status still FAILED)',
      log10After.status === 'FAILED' && log10After.retryCount === 0);

    // Restore for cleanup
    await SystemSetting.findOneAndUpdate(
      { key: 'NOTIFICATION_RETRY_ENABLED' },
      { $set: { value: true } }
    );

    // ─── Test 11: RBAC — non-admin cannot trigger retry ───
    logger.info('\nTest 11: RBAC — CUTTING user cannot trigger retry-now');
    const cuttingEmail = `cutting-${TAG.toLowerCase()}@local.test`;
    const cuttingPass = 'CuttingTest@123';
    const { User } = require('../src/models');
    await User.deleteMany({ email: cuttingEmail });
    await User.create({
      name: 'Cutting Retry User',
      email: cuttingEmail,
      password: cuttingPass,
      role: 'CUTTING',
      isActive: true,
    });
    const cuttingLogin = await api.post('/api/auth/login', {
      email: cuttingEmail,
      password: cuttingPass,
    });
    assert('CUTTING login 200', cuttingLogin.status === 200);
    const ch = { Authorization: `Bearer ${cuttingLogin.data.accessToken}` };
    const rbacRes = await api.post('/api/notifications/retry-now', {}, { headers: ch });
    assert('CUTTING → retry-now → 403',
      rbacRes.status === 403, `Got ${rbacRes.status}`);
    await User.deleteMany({ email: cuttingEmail });

    // ─── Cleanup ───
    logger.info('\nCleanup');
    await cleanup();
    logger.info('  Test data deleted, monkey-patches restored, setting restored');

    await mongoose.disconnect();

    logger.info('\n═══════════════════════════════════════');
    logger.info(`📊 Notification Retry Cron (Section G): ${pass}/${pass + fail} passed`);
    if (failures.length > 0) {
      logger.info('\nFailures:');
      failures.forEach((f, i) => logger.info(`  ${i + 1}. ${f}`));
    }
    process.exit(fail === 0 ? 0 : 1);
  } catch (error) {
    logger.error('Test crashed:', error);
    try {
      await cleanup();
    } catch {}
    try { await mongoose.disconnect(); } catch {}
    process.exit(1);
  }
};

test();
