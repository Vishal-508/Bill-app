require('dotenv').config();
if (process.env.NODE_ENV !== 'production') {
  const dns = require('dns');
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
}

const mongoose = require('mongoose');
const { Payment, Order, Customer, User, SystemSetting } = require('../src/models');
const razorpayService = require('../src/utils/razorpayService');
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

    // ─── Test 1: Mock mode detection ───
    logger.info('\nTest 1: Mock mode detection');
    const inMockMode = razorpayService.isMockMode();
    assert('Service initializes', typeof inMockMode === 'boolean');
    assert('In MOCK mode (placeholder creds)', inMockMode === true);
    logger.info(`  Mode: ${inMockMode ? 'MOCK' : 'LIVE'}`);

    // ─── Test 2: Settings present ───
    logger.info('\nTest 2: Payment settings');
    const gatewayEnabled = await SystemSetting.getValue('PAYMENT_GATEWAY_ENABLED');
    const gatewayProvider = await SystemSetting.getValue('PAYMENT_GATEWAY_PROVIDER');
    const autoCapture = await SystemSetting.getValue('PAYMENT_AUTO_CAPTURE');
    const webhookTolerance = await SystemSetting.getValue('PAYMENT_WEBHOOK_TOLERANCE_SECONDS');

    assert('PAYMENT_GATEWAY_ENABLED present', typeof gatewayEnabled === 'boolean');
    assert('PAYMENT_GATEWAY_PROVIDER = razorpay', gatewayProvider === 'razorpay');
    assert('PAYMENT_AUTO_CAPTURE present', typeof autoCapture === 'boolean');
    assert('PAYMENT_WEBHOOK_TOLERANCE_SECONDS numeric', typeof webhookTolerance === 'number');

    // ─── Test 3: Order creation (mock) ───
    logger.info('\nTest 3: Razorpay order creation');
    const rzpOrder = await razorpayService.createOrder({
      amount: 100000,
      currency: 'INR',
      receipt: 'TEST-RECEIPT-001',
      notes: { test: true },
    });

    assert('Order ID returned', rzpOrder?.id?.length > 0);
    assert('Order ID has mock prefix', rzpOrder.id.startsWith('order_mock_'));
    assert('Amount preserved', rzpOrder.amount === 100000);
    assert('Currency = INR', rzpOrder.currency === 'INR');
    assert('Mock flag set', rzpOrder._mock === true);

    // ─── Test 4: Payment reference generator ───
    logger.info('\nTest 4: Payment reference');
    const ref1 = razorpayService.generatePaymentReference();
    const ref2 = razorpayService.generatePaymentReference();
    assert('Reference format PAY-YYYY-XXXXXXXX', /^PAY-\d{4}-[A-Z0-9]{8}$/.test(ref1), `Got: ${ref1}`);
    assert('References unique', ref1 !== ref2);

    // ─── Test 5: Amount conversion helpers ───
    logger.info('\nTest 5: Amount conversion');
    assert('1000 rupees → 100000 paise', razorpayService.toPaise(1000) === 100000);
    assert('1234.56 rupees → 123456 paise', razorpayService.toPaise(1234.56) === 123456);
    assert('100000 paise → 1000 rupees', razorpayService.toRupees(100000) === 1000);

    // ─── Test 6: Signature verification ───
    logger.info('\nTest 6: Signature verification');
    const validMock = razorpayService.verifyPaymentSignature(
      'order_test', 'pay_test', 'mock_signature'
    );
    assert('Mock signature accepted in mock mode', validMock === true);

    const invalidMock = razorpayService.verifyPaymentSignature(
      'order_test', 'pay_test', 'real_signature'
    );
    assert('Non-mock signature rejected in mock mode', invalidMock === false);

    // ─── Test 7: Webhook signature ───
    logger.info('\nTest 7: Webhook signature verification');
    const webhookValid = razorpayService.verifyWebhookSignature(
      { test: 'data' }, 'any_signature'
    );
    assert('Webhook bypassed in mock mode', webhookValid === true);

    // ─── Test 8: Payment document creation ───
    logger.info('\nTest 8: Payment model creation');

    const customer = await Customer.findOne({ isDeleted: false });
    const order = await Order.findOne({ isDeleted: false }).sort({ createdAt: -1 });
    const admin = await User.findOne({ role: { $in: ['ADMIN', 'SUPER_ADMIN'] } });

    if (!customer || !order || !admin) {
      logger.warn('  ⚠️  Test data missing — using fake ObjectIds');
    }

    const paymentRef = razorpayService.generatePaymentReference();
    const payment = await Payment.create({
      paymentReference: paymentRef,
      gateway: 'razorpay',
      razorpayOrderId: rzpOrder.id,
      order: order?._id || new mongoose.Types.ObjectId(),
      orderNumber: order?.orderNumber || 'TEST-ORDER-MOCK',
      customer: customer?._id || new mongoose.Types.ObjectId(),
      customerSnapshot: {
        customerName: customer?.customerName || 'Test Customer',
        phone: customer?.phone || '9999999999',
      },
      amount: 100000,
      currency: 'INR',
      status: 'CREATED',
      createdBy: admin?._id || new mongoose.Types.ObjectId(),
      notes: 'PAYMENT_FOUNDATION_TEST',
    });

    assert('Payment created', payment._id != null);
    assert('Reference matches', payment.paymentReference === paymentRef);
    assert('Status = CREATED', payment.status === 'CREATED');
    assert('Initial CREATED event tracked', payment.events.length === 1);
    assert('Event type = CREATED', payment.events[0].eventType === 'CREATED');

    // ─── Test 9: Status transitions ───
    logger.info('\nTest 9: Status workflow');
    payment.status = 'ATTEMPTED';
    payment.addEvent('ATTEMPTED', { source: 'api', notes: 'Customer clicked pay' });
    await payment.save();
    assert('attemptedAt auto-set', payment.attemptedAt != null);
    assert('Event log has 2 entries', payment.events.length === 2);

    // ─── Test 10: markCaptured method ───
    logger.info('\nTest 10: markCaptured');
    await payment.markCaptured('pay_mock_xyz123', 'mock_signature', {
      method: 'upi',
      methodDetails: { vpa: 'test@upi' },
      source: 'webhook',
    });

    assert('Status = CAPTURED', payment.status === 'CAPTURED');
    assert('capturedAt set', payment.capturedAt != null);
    assert('Method = upi', payment.method === 'upi');
    assert('VPA captured', payment.methodDetails?.vpa === 'test@upi');
    assert('razorpayPaymentId stored', payment.razorpayPaymentId === 'pay_mock_xyz123');

    // ─── Test 11: Virtuals ───
    logger.info('\nTest 11: Virtual fields');
    assert('isSuccessful = true', payment.isSuccessful === true);
    assert('isFinalized = true', payment.isFinalized === true);
    assert('netAmount = full', payment.netAmount === 100000);

    // ─── Test 12: Refund flow ───
    logger.info('\nTest 12: Refund flow');
    const refundResult = await razorpayService.refund('pay_mock_xyz123', 50000);
    assert('Refund ID returned', refundResult?.id?.length > 0);
    assert('Refund ID has mock prefix', refundResult.id.startsWith('rfnd_mock_'));
    assert('Refund amount = 50000', refundResult.amount === 50000);

    payment.amountRefunded = 50000;
    payment.razorpayRefundId = refundResult.id;
    payment.addEvent('REFUND_INITIATED', { source: 'api' });
    await payment.save();

    assert('netAmount reduced after refund', payment.netAmount === 50000);

    // ─── Cleanup ───
    logger.info('\nCleanup');
    await Payment.deleteOne({ _id: payment._id });
    logger.info('  Test payment cleaned up');

    await mongoose.disconnect();

    logger.info('\n═══════════════════════════════════════');
    logger.info(`📊 Payment Foundation: ${pass}/${pass + fail} passed`);
    if (failures.length > 0) {
      logger.info('\nFailures:');
      failures.forEach((f, i) => logger.info(`  ${i + 1}. ${f}`));
    }

    logger.info(`\nMode: ${inMockMode ? 'MOCK (placeholder credentials)' : 'LIVE'}`);
    logger.info(`Razorpay SDK: ${require('razorpay/package.json').version}`);

    process.exit(fail === 0 ? 0 : 1);
  } catch (error) {
    logger.error('Test crashed:', error);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  }
};

test();
