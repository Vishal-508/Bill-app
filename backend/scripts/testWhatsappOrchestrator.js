require('dotenv').config();
if (process.env.NODE_ENV !== 'production') {
  const dns = require('dns');
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
}

// Force MOCK mode for email regardless of .env contents — keeps the test
// deterministic if real SMTP credentials are present. This affects the
// emailService instance loaded by this test script only. The backend running
// separately has its own process and its own env; not affected.
process.env.EMAIL_HOST = 'PLACEHOLDER_FOR_TEST';
process.env.EMAIL_USER = 'PLACEHOLDER_FOR_TEST';
process.env.EMAIL_PASS = 'PLACEHOLDER_FOR_TEST';

const axios = require('axios');
const mongoose = require('mongoose');
const logger = require('../src/config/logger');
const {
  WhatsAppLog, Customer, Bill, Order, Payment, SystemSetting,
} = require('../src/models');
const orchestrator = require('../src/services/notificationOrchestrator.service');
const whatsappService = require('../src/utils/whatsappService');

const BASE_URL = process.env.API_URL || 'http://localhost:5000';
const BYPASS = process.env.TEST_BYPASS_SECRET;

const api = axios.create({
  baseURL: BASE_URL,
  headers: { 'x-test-bypass-ratelimit': BYPASS },
  validateStatus: () => true,
});

const TAG = 'WA_ORCHESTRATOR_TEST';

// Helper: clear notification-related logs/orders/bills/payments tagged for this test
async function cleanup({ customerId }) {
  await WhatsAppLog.deleteMany({
    $or: [
      { customer: customerId, payload: { $exists: true } }, // dangerous; narrow below
    ],
  });
}

async function deepCleanup({ customerId, billIds = [], orderIds = [] }) {
  // Specific by relation — safe
  await WhatsAppLog.deleteMany({
    $or: [
      { relatedBill: { $in: billIds } },
      { relatedOrder: { $in: orderIds } },
    ],
  });
  await Bill.deleteMany({ notesToCustomer: TAG });
  await Order.deleteMany({ customerNotes: TAG });
}

const test = async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  let pass = 0, fail = 0;
  const failures = [];
  const billIds = [];
  const orderIds = [];

  const assert = (name, condition, detail = '') => {
    if (condition) { pass++; logger.info(`  ✅ ${name}`); }
    else {
      fail++;
      logger.error(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
      failures.push(name);
    }
  };

  try {
    // ─── Setup: Auth + customer + WA setting ───
    logger.info('\nSetup');
    const loginRes = await api.post('/api/auth/login', {
      email: 'testadmin@shreegopal.com',
      password: 'TestAdmin@123',
    });
    assert('Admin login', loginRes.status === 200);
    const h = { Authorization: `Bearer ${loginRes.data.accessToken}` };

    const customer = await Customer.findOne({
      phone: { $exists: true, $ne: null },
      isDeleted: false,
    }).select('_id customerName phone email').lean();
    assert('Customer with phone', customer != null);

    // Make sure WHATSAPP_ENABLED=true and FALLBACK_TO_EMAIL=true at start
    await SystemSetting.findOneAndUpdate(
      { key: 'WHATSAPP_ENABLED' },
      { $set: { value: true } }
    );
    await SystemSetting.findOneAndUpdate(
      { key: 'WHATSAPP_FALLBACK_TO_EMAIL' },
      { $set: { value: true } }
    );

    // ─── PART A: orchestrator.onBillGenerated (direct call) ───
    logger.info('\n[A] onBillGenerated — direct call');

    // Create a bill via API
    const prodRes = await api.get('/api/products?productType=RAW_SHEET&limit=1', { headers: h });
    const product = prodRes.data.data[0];
    const ppu = product.basePrice * product.areaSqFt;
    const sub = ppu * 2;
    const orderBody = {
      customer: customer._id,
      items: [{
        itemType: 'FULL_SHEET',
        product: product._id,
        quantity: 2,
        pricePerUnit: ppu,
        materialCost: sub,
        lineSubtotal: sub,
      }],
      subtotal: sub,
      taxableAmount: sub,
      gstRatePct: 18,
      cgst: sub * 0.09,
      sgst: sub * 0.09,
      totalGst: sub * 0.18,
      totalAmount: sub * 1.18,
      paymentMode: 'PARTIAL',
      customerNotes: TAG,
    };
    const orderRes = await api.post('/api/orders', orderBody, { headers: h });
    assert('Test order created', orderRes.status === 201);
    const testOrder = orderRes.data.data;
    orderIds.push(testOrder._id);

    // Wait a beat to let the bill creation's auto-fire orchestrator settle if any
    const billCreateRes = await api.post(`/api/bills/from-order/${testOrder._id}`, {
      format: 'detailed',
      notesToCustomer: TAG,
    }, { headers: h });
    assert('Bill created via API', billCreateRes.status === 201);
    const testBill = billCreateRes.data.data;
    billIds.push(testBill._id);

    // Wait for fire-and-forget to land
    await new Promise(r => setTimeout(r, 300));

    // Test 1: Wired into createFromOrder — log auto-created
    const autoLog = await WhatsAppLog.findOne({
      relatedBill: testBill._id,
      type: 'BILL',
    }).lean();
    assert('A1: WhatsAppLog auto-created on /api/bills/from-order',
      autoLog != null, `relatedBill: ${testBill._id}`);
    assert('A2: log status SENT (auto)', autoLog?.status === 'SENT');
    assert('A3: log waMessageId starts with wamid.', autoLog?.waMessageId?.startsWith('wamid.'));
    assert('A4: log type=BILL', autoLog?.type === 'BILL');

    // Direct orchestrator call — verify return shape
    // First, clean the auto log so we can re-fire deterministically
    await WhatsAppLog.deleteMany({ relatedBill: testBill._id });

    // Fetch the bill model instance for direct call (orchestrator hydrates customer)
    const billDoc = await Bill.findById(testBill._id);
    const r1 = await orchestrator.onBillGenerated(billDoc);
    assert('A5: direct call returns whatsapp.sent=true', r1.whatsapp.sent === true);
    assert('A6: direct call returns waMessageId', r1.whatsapp.waMessageId?.startsWith('wamid.'));
    assert('A7: email skipped (whatsapp succeeded)',
      r1.email.skipped === 'whatsapp_succeeded' || r1.email.sent === false);

    // ─── PART B: WHATSAPP_ENABLED=false ───
    logger.info('\n[B] WHATSAPP_ENABLED=false');
    await SystemSetting.findOneAndUpdate(
      { key: 'WHATSAPP_ENABLED' },
      { $set: { value: false } }
    );

    await WhatsAppLog.deleteMany({ relatedBill: testBill._id });
    const r2 = await orchestrator.onBillGenerated(billDoc);
    assert('B1: whatsapp.sent=false', r2.whatsapp.sent === false);
    assert('B2: skipped=WHATSAPP_ENABLED=false',
      r2.whatsapp.skipped === 'WHATSAPP_ENABLED=false');

    // Email fallback should fire if customer has email
    if (customer.email) {
      assert('B3: email.sent=true (fallback fired)', r2.email.sent === true);
      assert('B4: email.isMock=true', r2.email.isMock === true);
    } else {
      assert('B3: email skipped (no_email)', r2.email.skipped === 'no_email');
      assert('B4: email.sent=false', r2.email.sent === false);
    }

    // No WhatsAppLog should be created when WA is disabled
    const disabledLogCount = await WhatsAppLog.countDocuments({ relatedBill: testBill._id });
    assert('B5: no WhatsAppLog created when disabled', disabledLogCount === 0);

    // Re-enable for next tests
    await SystemSetting.findOneAndUpdate(
      { key: 'WHATSAPP_ENABLED' },
      { $set: { value: true } }
    );

    // ─── PART C: Simulated WA failure → email fallback ───
    logger.info('\n[C] Simulated WA failure → email fallback');

    // Monkey-patch the in-process service to throw
    const originalSendBill = whatsappService.sendBillTemplate;
    whatsappService.sendBillTemplate = async () => {
      throw new Error('Simulated network failure');
    };

    try {
      await WhatsAppLog.deleteMany({ relatedBill: testBill._id });
      const r3 = await orchestrator.onBillGenerated(billDoc);
      assert('C1: whatsapp.sent=false on failure', r3.whatsapp.sent === false);
      assert('C2: whatsapp.error captured',
        r3.whatsapp.error?.includes('Simulated network failure'));
      if (customer.email) {
        assert('C3: email fallback fired', r3.email.sent === true);
      } else {
        assert('C3: email skipped (no email available)', r3.email.skipped === 'no_email');
      }

      // FAILED WhatsAppLog should be created
      const failLog = await WhatsAppLog.findOne({
        relatedBill: testBill._id,
        status: 'FAILED',
      }).lean();
      assert('C4: FAILED WhatsAppLog created', failLog != null);
      assert('C5: errorMessage captured in log',
        failLog?.errorMessage?.includes('Simulated network failure'));
    } finally {
      whatsappService.sendBillTemplate = originalSendBill;
    }

    // ─── PART D: onOrderReady ───
    logger.info('\n[D] onOrderReady — direct call');
    const orderDoc = await Order.findById(testOrder._id);

    const r4 = await orchestrator.onOrderReady(orderDoc);
    assert('D1: whatsapp.sent=true', r4.whatsapp.sent === true);
    const orderReadyLog = await WhatsAppLog.findOne({
      relatedOrder: testOrder._id,
      type: 'ORDER_READY',
    }).lean();
    assert('D2: ORDER_READY log created', orderReadyLog != null);
    assert('D3: log templateName=order_ready_v1',
      orderReadyLog?.templateName === 'order_ready_v1');

    // ─── PART E: onOrderConfirmation ───
    logger.info('\n[E] onOrderConfirmation — direct call');
    const r5 = await orchestrator.onOrderConfirmation(orderDoc);
    assert('E1: whatsapp.sent=true', r5.whatsapp.sent === true);
    const ocLog = await WhatsAppLog.findOne({
      relatedOrder: testOrder._id,
      type: 'ORDER_CONFIRMATION',
    }).lean();
    assert('E2: ORDER_CONFIRMATION log created', ocLog != null);

    // ─── PART F: onPaymentReceived (24h window check) ───
    logger.info('\n[F] onPaymentReceived');
    // Create a synthetic Payment doc tied to our test order
    const payment = await Payment.create({
      paymentReference: `PAY-2026-WAORCH${Date.now().toString(36).toUpperCase().slice(-4)}`,
      gateway: 'mock',
      razorpayOrderId: `order_mock_orch_${Date.now()}`,
      razorpayPaymentId: `pay_mock_orch_${Date.now()}`,
      order: testOrder._id,
      orderNumber: testOrder.orderNumber,
      customer: customer._id,
      customerSnapshot: { customerName: customer.customerName, phone: customer.phone },
      amount: 10000, // 100 rupees in paise
      currency: 'INR',
      status: 'CAPTURED',
      capturedAt: new Date(),
      isMock: true,
    });

    // Outside 24h window (no inbound) — should skip WA, fall to email
    const r6 = await orchestrator.onPaymentReceived(payment, await Bill.findById(testBill._id).lean());
    assert('F1: WA skipped (no inbound)',
      r6.whatsapp.sent === false && r6.whatsapp.skipped?.includes('inbound'));
    if (customer.email) {
      assert('F2: email fallback fired', r6.email.sent === true);
    }

    // Now seed an INBOUND within 24h and re-run
    const inboundLog = await WhatsAppLog.create({
      to: '919999999999',
      customer: customer._id,
      type: 'INBOUND',
      payload: { text: { body: 'Test inbound for window' } },
      status: 'SENT',
      isMock: true,
    });

    const r7 = await orchestrator.onPaymentReceived(payment, await Bill.findById(testBill._id).lean());
    assert('F3: WA sent (within 24h window)', r7.whatsapp.sent === true);
    const paymentTextLog = await WhatsAppLog.findOne({
      relatedBill: testBill._id,
      type: 'TEXT',
      waMessageId: r7.whatsapp.waMessageId,
    }).lean();
    assert('F4: TEXT log created for payment receipt', paymentTextLog != null);

    // ─── PART G: Error isolation ───
    logger.info('\n[G] Error isolation');
    // Force orchestrator's internal hydration to throw by passing a bill with bad customer ref
    const ghostBill = { _id: new mongoose.Types.ObjectId(), customer: new mongoose.Types.ObjectId(), billNumber: 'GHOST', grandTotal: 0 };
    const r8 = await orchestrator.onBillGenerated(ghostBill);
    assert('G1: ghost customer → error=customer_not_found',
      r8.error === 'customer_not_found' || r8.whatsapp.sent === false);

    // Catastrophic internal error — orchestrator must NOT throw
    let threw = false;
    try {
      await orchestrator.onBillGenerated(null);
    } catch {
      threw = true;
    }
    assert('G2: null input does not throw', threw === false);

    // ─── PART H: Controller wiring (order status → READY) ───
    logger.info('\n[H] order.changeStatus → onOrderReady wired');
    await WhatsAppLog.deleteMany({ relatedOrder: testOrder._id, type: 'ORDER_READY' });

    // Need to be in IN_PROGRESS first (transitions are guarded)
    await api.post(`/api/orders/${testOrder._id}/status`,
      { status: 'IN_PROGRESS', notes: 'orch test' },
      { headers: h }
    );
    const readyRes = await api.post(`/api/orders/${testOrder._id}/status`,
      { status: 'READY', notes: 'orch test' },
      { headers: h }
    );
    assert('H1: status change to READY succeeded', readyRes.status === 200, `Got ${readyRes.status}`);

    await new Promise(r => setTimeout(r, 300)); // fire-and-forget settle
    const autoReadyLog = await WhatsAppLog.findOne({
      relatedOrder: testOrder._id,
      type: 'ORDER_READY',
    }).lean();
    assert('H2: ORDER_READY log auto-created from controller wiring',
      autoReadyLog != null);

    // ─── Cleanup ───
    logger.info('\nCleanup');
    await Payment.deleteMany({ _id: payment._id });
    await WhatsAppLog.deleteOne({ _id: inboundLog._id });
    await deepCleanup({ customerId: customer._id, billIds, orderIds });
    // Also tidy any stray test-tagged WhatsApp logs
    await WhatsAppLog.deleteMany({
      $or: [
        { relatedBill: { $in: billIds } },
        { relatedOrder: { $in: orderIds } },
        { customer: customer._id, isMock: true, type: 'INBOUND', createdAt: { $gte: new Date(Date.now() - 30 * 60 * 1000) } },
      ],
    });
    logger.info('  Test data cleaned');

    await mongoose.disconnect();

    logger.info('\n═══════════════════════════════════════');
    logger.info(`📊 WhatsApp Orchestrator (Section D): ${pass}/${pass + fail} passed`);
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
