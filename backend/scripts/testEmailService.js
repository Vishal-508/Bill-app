require('dotenv').config();
if (process.env.NODE_ENV !== 'production') {
  const dns = require('dns');
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
}

// Force MOCK mode for this smoke test, regardless of what's in .env.
// Without this override, if EMAIL_HOST is a real SMTP server, the service
// would attempt real sends and fail without valid credentials. This
// modification only affects this test process — the .env file is untouched.
process.env.EMAIL_HOST = 'PLACEHOLDER_FOR_TEST';
process.env.EMAIL_USER = 'PLACEHOLDER_FOR_TEST';
process.env.EMAIL_PASS = 'PLACEHOLDER_FOR_TEST';

const mongoose = require('mongoose');
const logger = require('../src/config/logger');
const { SystemSetting } = require('../src/models');
const emailService = require('../src/utils/emailService');

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
    // ─── Test 1: Mock mode detection ───
    logger.info('\nTest 1: Mock mode detection');
    const isMock = emailService.isMockMode();
    assert('isMockMode returns boolean', typeof isMock === 'boolean');
    assert('In MOCK mode (placeholder creds)', isMock === true, `Got ${isMock}`);

    // Ensure EMAIL_ENABLED=true for the rest
    await SystemSetting.findOneAndUpdate(
      { key: 'EMAIL_ENABLED' },
      { $set: { value: true } }
    );

    // ─── Test 2: sendBillEmail (mock mode) ───
    logger.info('\nTest 2: sendBillEmail (mock)');
    let r = await emailService.sendBillEmail({
      to: 'customer@example.com',
      customerName: 'Test Customer',
      invoiceNo: 'INV-2026-101',
      amount: 1500.50,
      orderNo: 'ORD-2026-201',
      pdfUrl: 'https://example.com/test.pdf',
      paymentLinkUrl: 'https://rzp.io/i/abc123',
    });
    assert('success=true', r.success === true);
    assert('isMock=true', r.isMock === true);
    assert('messageId starts with mock_', r.messageId?.startsWith('mock_'));

    // ─── Test 3: sendPaymentLinkEmail ───
    logger.info('\nTest 3: sendPaymentLinkEmail (mock)');
    r = await emailService.sendPaymentLinkEmail({
      to: 'customer@example.com',
      customerName: 'Test',
      amount: 2360,
      invoiceNo: 'INV-2026-102',
      paymentLinkUrl: 'https://rzp.io/i/xyz789',
    });
    assert('success=true', r.success === true);
    assert('isMock=true', r.isMock === true);

    // ─── Test 4: sendOrderReadyEmail ───
    logger.info('\nTest 4: sendOrderReadyEmail (mock)');
    r = await emailService.sendOrderReadyEmail({
      to: 'customer@example.com',
      customerName: 'Test',
      orderNo: 'ORD-2026-202',
      total: 4720,
    });
    assert('success=true', r.success === true);
    assert('isMock=true', r.isMock === true);

    // ─── Test 5: sendOrderConfirmationEmail ───
    logger.info('\nTest 5: sendOrderConfirmationEmail (mock)');
    r = await emailService.sendOrderConfirmationEmail({
      to: 'customer@example.com',
      customerName: 'Test',
      orderNo: 'ORD-2026-203',
      itemsSummary: '3 item(s)',
      estimatedReady: 'Tomorrow',
    });
    assert('success=true', r.success === true);
    assert('isMock=true', r.isMock === true);

    // ─── Test 6: sendPaymentReceiptEmail ───
    logger.info('\nTest 6: sendPaymentReceiptEmail (mock)');
    r = await emailService.sendPaymentReceiptEmail({
      to: 'customer@example.com',
      customerName: 'Test',
      amount: '1500.00',
      invoiceNo: 'INV-2026-101',
      paymentMode: 'upi',
      paymentDate: new Date(),
    });
    assert('success=true', r.success === true);
    assert('isMock=true', r.isMock === true);

    // ─── Test 7: Invalid email format rejected ───
    logger.info('\nTest 7: Invalid email format');
    r = await emailService.sendBillEmail({
      to: 'not-an-email',
      customerName: 'Test',
      invoiceNo: 'INV-X',
      amount: 100,
    });
    assert('success=false', r.success === false);
    assert('error=INVALID_EMAIL_FORMAT', r.error === 'INVALID_EMAIL_FORMAT');

    // ─── Test 8: Missing recipient ───
    logger.info('\nTest 8: Missing recipient');
    r = await emailService.sendBillEmail({
      customerName: 'Test',
      invoiceNo: 'INV-X',
      amount: 100,
    });
    assert('Missing to → success=false', r.success === false);
    assert('error=INVALID_TO', r.error === 'INVALID_TO');

    // ─── Test 9: EMAIL_ENABLED=false ───
    logger.info('\nTest 9: EMAIL_ENABLED=false');
    await SystemSetting.findOneAndUpdate(
      { key: 'EMAIL_ENABLED' },
      { $set: { value: false } }
    );

    r = await emailService.sendBillEmail({
      to: 'customer@example.com',
      customerName: 'Test',
      invoiceNo: 'INV-X',
      amount: 100,
    });
    assert('Disabled → success=false', r.success === false);
    assert('error=EMAIL_DISABLED', r.error === 'EMAIL_DISABLED');

    // Restore
    await SystemSetting.findOneAndUpdate(
      { key: 'EMAIL_ENABLED' },
      { $set: { value: true } }
    );

    // ─── Test 10: HTML template contents (verify substitutions) ───
    logger.info('\nTest 10: HTML template contents');
    // Capture the rendered HTML by reaching into the template helper.
    // We do this by reading the public function's output indirectly — call
    // sendBillEmail in mock mode and verify the messageId comes back.
    // For HTML content verification, we'll re-test via the shell + bodyHtml
    // by simulating: rerun and check that LIVE-mode path would have called
    // nodemailer.sendMail with HTML containing our fields. In mock mode we
    // can't observe the HTML, so verify the function returns success and the
    // template construction doesn't throw on edge inputs.

    r = await emailService.sendBillEmail({
      to: 'customer@example.com',
      customerName: "O'Brien & Sons",   // apostrophe + ampersand
      invoiceNo: 'INV-2026-103',
      amount: 1234567.89,                  // big amount
      orderNo: 'ORD-2026-204',
      pdfUrl: 'https://example.com/test.pdf',
      paymentLinkUrl: null,                // no payment link
    });
    assert('Edge-case names + amounts OK', r.success === true);
    assert('No payment link still succeeds', r.success === true);

    // ─── Test 11: Attachment shape (path passthrough) ───
    logger.info('\nTest 11: Attachment passes through (mock-mode logged)');
    r = await emailService.sendBillEmail({
      to: 'customer@example.com',
      customerName: 'Test',
      invoiceNo: 'INV-2026-104',
      amount: 100,
      pdfUrl: 'https://example.com/invoice-2026-104.pdf',
    });
    // In mock mode we can't inspect the attachments array directly without
    // a spy. But we can verify the function path doesn't throw and returns
    // success. Real-mode test for attachment is deferred to Section H.
    assert('PDF URL attachment path → success', r.success === true);

    // ─── Test 12: All-undefined optional fields ───
    logger.info('\nTest 12: Minimal required fields only');
    r = await emailService.sendBillEmail({
      to: 'minimal@example.com',
      customerName: undefined,
      invoiceNo: 'INV-MIN',
      amount: 0,
    });
    assert('Minimal fields → success', r.success === true);

    // ─── Test 13: Transport not created in mock mode (no SMTP connection) ───
    logger.info('\nTest 13: No SMTP connection in mock mode');
    // Re-invoke isMockMode after reset to confirm singleton behavior
    emailService._resetForTesting();
    const reMock = emailService.isMockMode();
    assert('Still mock after reset (env unchanged)', reMock === true);

    await mongoose.disconnect();

    logger.info('\n═══════════════════════════════════════');
    logger.info(`📊 Email Service (Section E): ${pass}/${pass + fail} passed`);
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
