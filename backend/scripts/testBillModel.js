require('dotenv').config();
if (process.env.NODE_ENV !== 'production') {
  const dns = require('dns');
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
}

const mongoose = require('mongoose');
const { Bill, Order, Customer, Product, User, SystemSetting } = require('../src/models');
const { generateBillNumber, getFiscalYear } = require('../src/utils/billNumberGenerator');
const { generateOrderNumber } = require('../src/utils/orderNumberGenerator');
const { amountToWords } = require('../src/utils/amountToWords');
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

    // ─── Test 1: SystemSettings present ───
    logger.info('\nTest 1: SystemSettings');
    const prefix = await SystemSetting.getValue('INVOICE_PREFIX');
    const businessAddress = await SystemSetting.getValue('BUSINESS_ADDRESS');
    assert('INVOICE_PREFIX exists', prefix === 'INV', `Got: ${prefix}`);
    assert('BUSINESS_ADDRESS exists', businessAddress && businessAddress.length > 0, `Got: ${businessAddress}`);

    // ─── Test 2: Bill number generation ───
    logger.info('\nTest 2: Bill number generation');
    const billNum1 = await generateBillNumber();
    assert('Number generated', billNum1 && billNum1.startsWith('INV-'), `Got: ${billNum1}`);
    assert('Format INV-YYYY-NNN', /^INV-\d{4}-\d{3,}$/.test(billNum1), `Got: ${billNum1}`);

    // ─── Test 3: Fiscal year ───
    logger.info('\nTest 3: Fiscal year');
    const fy = getFiscalYear();
    assert('FY format YYYY-YY', /^\d{4}-\d{2}$/.test(fy), `Got: ${fy}`);

    const aprDate = new Date('2026-06-15');
    assert('June 2026 → 2026-27', getFiscalYear(aprDate) === '2026-27', `Got: ${getFiscalYear(aprDate)}`);

    const febDate = new Date('2026-02-15');
    assert('Feb 2026 → 2025-26', getFiscalYear(febDate) === '2025-26', `Got: ${getFiscalYear(febDate)}`);

    // ─── Test 4: Amount to words ───
    logger.info('\nTest 4: Amount to words');
    assert('₹0', amountToWords(0) === 'Zero Rupees Only', `Got: ${amountToWords(0)}`);
    assert('₹100', amountToWords(100).includes('Hundred Rupees'), `Got: ${amountToWords(100)}`);
    assert('₹1234.56 has Thousand & Paise',
      amountToWords(1234.56).includes('Thousand') && amountToWords(1234.56).includes('Paise'),
      `Got: ${amountToWords(1234.56)}`);
    assert('₹100000 has Lakh',
      amountToWords(100000).includes('Lakh'),
      `Got: ${amountToWords(100000)}`);
    assert('₹10000000 has Crore',
      amountToWords(10000000).includes('Crore'),
      `Got: ${amountToWords(10000000)}`);

    // ─── Test 5: Create test Bill ───
    logger.info('\nTest 5: Create Bill');

    const customer = await Customer.findOne({ phone: '8000000001' });
    const product = await Product.findOne({ productType: 'RAW_SHEET' });
    const admin = await User.findOne({ role: { $in: ['ADMIN', 'SUPER_ADMIN'] } });

    if (!customer || !product || !admin) {
      logger.error('Missing baseline test data');
      logger.error(`  customer: ${customer ? 'OK' : 'MISSING'}`);
      logger.error(`  product:  ${product ? 'OK' : 'MISSING'}`);
      logger.error(`  admin:    ${admin ? 'OK' : 'MISSING'}`);
      process.exit(1);
    }

    // Self-contained: create a test order if none exists
    let order = await Order.findOne({ isDeleted: false }).sort({ createdAt: -1 });
    let createdOwnOrder = false;
    if (!order) {
      logger.info('  (No existing order — creating one for the test)');
      order = await Order.create({
        orderNumber: await generateOrderNumber(),
        customer: customer._id,
        customerSnapshot: { customerName: customer.customerName, phone: customer.phone, billingState: 'Madhya Pradesh' },
        items: [{
          itemType: 'FULL_SHEET',
          product: product._id,
          productSnapshot: { sku: product.sku, name: product.name, productType: 'RAW_SHEET' },
          quantity: 2,
          pricePerUnit: 2000,
          materialCost: 4000,
          lineSubtotal: 4000,
        }],
        subtotal: 4000,
        taxableAmount: 4000,
        gstRatePct: 18,
        cgst: 360,
        sgst: 360,
        totalGst: 720,
        totalAmount: 4720,
        paymentMode: 'FULL_UPFRONT',
        createdBy: admin._id,
        customerNotes: 'BILL_MODEL_TEST',
      });
      createdOwnOrder = true;
    }

    const billNum = await generateBillNumber();

    const bill = await Bill.create({
      billNumber: billNum,
      fiscalYear: getFiscalYear(),
      order: order._id,
      orderNumber: order.orderNumber,
      customer: customer._id,
      issueDate: new Date(),
      status: 'DRAFT',
      format: 'detailed',
      language: 'en',
      hasGst: true,
      customerInfo: {
        customerName: customer.customerName,
        companyName: customer.companyName,
        phone: customer.phone,
        email: customer.email,
        gstin: customer.gstin,
        billingAddress: customer.billingAddress,
      },
      businessInfo: {
        name: await SystemSetting.getValue('BUSINESS_NAME', 'Shree Gopal MDF'),
        address: await SystemSetting.getValue('BUSINESS_ADDRESS'),
        phone: await SystemSetting.getValue('BUSINESS_PHONE'),
        email: await SystemSetting.getValue('BUSINESS_EMAIL'),
        gstin: await SystemSetting.getValue('BUSINESS_GSTIN'),
        state: await SystemSetting.getValue('BUSINESS_STATE'),
        bankDetails: await SystemSetting.getValue('BUSINESS_BANK_DETAILS'),
      },
      items: [{
        serialNo: 1,
        description: 'MDF 18mm 8×4 Interior Grade',
        productSku: 'TEST-SKU',
        productName: 'MDF Sheet',
        itemType: 'FULL_SHEET',
        quantity: 2,
        unit: 'sheets',
        pricePerUnit: 2000,
        materialCost: 4000,
        taxableAmount: 4000,
        gstRatePct: 18,
        cgst: 360,
        sgst: 360,
        lineTotal: 4720,
      }],
      subtotal: 4000,
      taxableAmount: 4000,
      isIntraState: true,
      totalCgst: 360,
      totalSgst: 360,
      totalGst: 720,
      grandTotal: 4720,
      amountInWords: amountToWords(4720),
      termsAndConditions: await SystemSetting.getValue('INVOICE_TERMS_DEFAULT'),
      createdBy: admin._id,
    });

    assert('Bill created', bill._id != null);
    assert('Bill number assigned', bill.billNumber === billNum);
    assert('Status = DRAFT', bill.status === 'DRAFT');
    assert('Event tracked (CREATED)', bill.events.length === 1 && bill.events[0].eventType === 'CREATED');
    assert('Amount in words present', bill.amountInWords && bill.amountInWords.includes('Rupees'));
    assert('isEditable = true (DRAFT)', bill.isEditable === true);

    // ─── Test 6: Finalize bill ───
    logger.info('\nTest 6: Finalize bill');
    await bill.finalize(admin._id, 'Test finalization');

    assert('Status = FINALIZED', bill.status === 'FINALIZED');
    assert('finalizedAt set', bill.finalizedAt != null);
    assert('finalizedBy set', bill.finalizedBy != null);
    assert('Event tracked (FINALIZED)', bill.events.some(e => e.eventType === 'FINALIZED'));
    assert('isEditable = false (FINALIZED)', bill.isEditable === false);

    // ─── Test 7: Cannot finalize twice ───
    logger.info('\nTest 7: Double-finalization blocked');
    let doubleRejected = false;
    try {
      await bill.finalize(admin._id);
    } catch (e) {
      doubleRejected = e.message.includes('Cannot finalize');
    }
    assert('Double finalize rejected', doubleRejected);

    // ─── Test 8: Mark as sent ───
    logger.info('\nTest 8: Mark as sent (WhatsApp)');
    await bill.markSent(admin._id, 'whatsapp', 'Sent via WhatsApp Cloud API');

    assert('Status = SENT', bill.status === 'SENT');
    assert('Event tracked (WHATSAPPED)', bill.events.some(e => e.eventType === 'WHATSAPPED'));

    // ─── Test 9: Payment status auto-update ───
    logger.info('\nTest 9: Payment status auto-update');
    bill.amountPaid = bill.grandTotal;
    await bill.save();

    assert('Status PAID after full payment', bill.paymentStatus === 'PAID', `Got: ${bill.paymentStatus}`);
    assert('Amount due = 0', bill.amountDue === 0, `Got: ${bill.amountDue}`);

    bill.amountPaid = 2000;
    await bill.save();
    assert('Status PARTIAL', bill.paymentStatus === 'PARTIAL', `Got: ${bill.paymentStatus}`);

    // ─── Test 10: Sequence number incremented ───
    logger.info('\nTest 10: Sequence increment');
    const billNum2 = await generateBillNumber();
    const seq1 = parseInt(billNum1.match(/(\d+)$/)[1]);
    const seq2 = parseInt(billNum2.match(/(\d+)$/)[1]);
    assert('Second number greater', seq2 > seq1, `${billNum1} → ${billNum2}`);

    // ─── Cleanup ───
    logger.info('\nCleanup');
    await Bill.deleteOne({ _id: bill._id });
    if (createdOwnOrder) {
      await Order.deleteOne({ _id: order._id });
      logger.info('  ✅ Test order + bill deleted');
    } else {
      logger.info('  ✅ Test bill deleted (existing order untouched)');
    }

    await mongoose.disconnect();

    logger.info('\n═══════════════════════════════════════');
    logger.info(`📊 Bill Model Tests: ${pass}/${pass + fail} passed`);
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
