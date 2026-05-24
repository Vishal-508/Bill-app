require('dotenv').config();
if (process.env.NODE_ENV !== 'production') {
  const dns = require('dns');
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
}

const mongoose = require('mongoose');
const pdfService = require('../src/utils/pdfService');
const { mapBillToTemplate } = require('../src/utils/billDataMapper');
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

    const businessInfo = {
      name: 'Shree Gopal MDF',
      address: '123 Industrial Area, Indore, MP - 452015',
      phone: '+91-9876543210',
      email: 'sales@shreegopalmdf.com',
      gstin: '23ABCDE1234F1Z5',
      state: 'Madhya Pradesh',
    };

    // ─── Scenario 1: Quick cash sale (walk-in, paid in full) ───
    logger.info('\nScenario 1: Walk-in cash customer, PAID');

    const cashSaleData = {
      billNumber: 'INV-2026-061',
      fiscalYear: '2026-27',
      issueDate: new Date('2026-05-24'),
      hasGst: true,
      isIntraState: true,
      businessInfo,
      customerInfo: {
        customerName: 'Ramesh Sharma',
        phone: '+91-9876512345',
      },
      items: [
        {
          serialNo: 1,
          description: 'MDF 18mm Interior',
          itemType: 'FULL_SHEET',
          quantity: 2,
          unit: 'sheets',
          pricePerUnit: 2240,
          taxableAmount: 4480,
          gstRatePct: 18,
          cgst: 403.20,
          sgst: 403.20,
          lineTotal: 5286.40,
        },
        {
          serialNo: 2,
          description: 'MDF 12mm Bundle',
          itemType: 'BUNDLE',
          quantity: 1,
          unit: 'bundle',
          pricePerUnit: 1500,
          taxableAmount: 1500,
          gstRatePct: 18,
          cgst: 135,
          sgst: 135,
          lineTotal: 1770,
        },
      ],
      subtotal: 5980,
      taxableAmount: 5980,
      totalCgst: 538.20,
      totalSgst: 538.20,
      totalGst: 1076.40,
      grandTotal: 7056.40,
      amountInWords: amountToWords(7056.40),
      amountPaid: 7056.40,
      amountDue: 0,
      paymentStatus: 'PAID',
      events: [],
      revisionNumber: 0,
    };

    const cashTemplate = await mapBillToTemplate(cashSaleData);
    assert('Cash sale: Template mapped', cashTemplate.billNumber === 'INV-2026-061');

    const cashHtml = await pdfService.renderTemplate('minimal-bill', cashTemplate);
    assert('Cash sale: HTML rendered', cashHtml.length > 2000);
    assert('Cash sale: CASH MEMO label', cashHtml.includes('CASH MEMO'));
    assert('Cash sale: PAID IN FULL badge', cashHtml.includes('PAID IN FULL'));
    assert('Cash sale: Total amount shown', cashHtml.includes('7,056.40'));
    assert('Cash sale: Thank You message', cashHtml.includes('Thank You'));

    const cashResult = await pdfService.generateAndSave(
      'minimal-bill', cashTemplate, 'sample_minimal_cash_paid'
    );
    assert('Cash sale: PDF generated', cashResult.path != null);
    assert('Cash sale: Compact size',
      cashResult.sizeBytes > 20000 && cashResult.sizeBytes < 200000,
      `Size: ${(cashResult.sizeBytes/1024).toFixed(1)} KB`);

    // ─── Scenario 2: Partial payment ───
    logger.info('\nScenario 2: Partial payment received');

    const partialData = {
      ...cashSaleData,
      billNumber: 'INV-2026-062',
      amountPaid: 3000,
      amountDue: 4056.40,
      paymentStatus: 'PARTIAL',
    };

    const partialTemplate = await mapBillToTemplate(partialData);
    const partialHtml = await pdfService.renderTemplate('minimal-bill', partialTemplate);
    assert('Partial: PARTIAL PAYMENT message', partialHtml.includes('PARTIAL PAYMENT'));
    assert('Partial: Balance shown', partialHtml.includes('Balance Due'));

    const partialResult = await pdfService.generateAndSave(
      'minimal-bill', partialTemplate, 'sample_minimal_partial_payment'
    );
    assert('Partial: PDF generated', partialResult.path != null);

    // ─── Scenario 3: Tax-free / No-GST transaction ───
    logger.info('\nScenario 3: No-GST receipt');

    const noGstData = {
      ...cashSaleData,
      billNumber: 'INV-2026-063',
      hasGst: false,
      totalCgst: 0,
      totalSgst: 0,
      totalGst: 0,
      grandTotal: 5980,
      amountInWords: amountToWords(5980),
      amountPaid: 5980,
      amountDue: 0,
      paymentStatus: 'PAID',
    };

    const noGstTemplate = await mapBillToTemplate(noGstData);
    const noGstHtml = await pdfService.renderTemplate('minimal-bill', noGstTemplate);
    assert('No-GST: RECEIPT label (not CASH MEMO)', noGstHtml.includes('RECEIPT'));
    assert('No-GST: Tax-free notice', noGstHtml.includes('Tax-free'));

    const noGstResult = await pdfService.generateAndSave(
      'minimal-bill', noGstTemplate, 'sample_minimal_no_gst'
    );
    assert('No-GST: PDF generated', noGstResult.path != null);

    // ─── Scenario 4: Business customer (has company + GSTIN) ───
    logger.info('\nScenario 4: Business customer with company');

    const bizData = {
      ...cashSaleData,
      billNumber: 'INV-2026-064',
      customerInfo: {
        customerName: 'Vinod Kumar',
        companyName: 'Kumar Furniture Mart',
        phone: '+91-9012345678',
        gstin: '23VINOD1234X5Y6',
      },
      paymentStatus: 'UNPAID',
      amountPaid: 0,
      amountDue: 7056.40,
    };

    const bizTemplate = await mapBillToTemplate(bizData);
    const bizHtml = await pdfService.renderTemplate('minimal-bill', bizTemplate);
    assert('Business: Company name shown', bizHtml.includes('Kumar Furniture'));
    assert('Business: GSTIN visible', bizHtml.includes('23VINOD1234'));
    assert('Business: PAYMENT PENDING', bizHtml.includes('PAYMENT PENDING'));

    const bizResult = await pdfService.generateAndSave(
      'minimal-bill', bizTemplate, 'sample_minimal_business_unpaid'
    );
    assert('Business: PDF generated', bizResult.path != null);

    // ─── Cleanup ───
    await pdfService.closeBrowser();
    await mongoose.disconnect();

    logger.info('\n═══════════════════════════════════════');
    logger.info(`📊 Minimal Bill Template Tests: ${pass}/${pass + fail} passed`);
    if (failures.length > 0) {
      logger.info('\nFailures:');
      failures.forEach((f, i) => logger.info(`  ${i + 1}. ${f}`));
    }

    logger.info('\n📂 Generated minimal bills for visual inspection:');
    logger.info('   1. sample_minimal_cash_paid.pdf (walk-in PAID)');
    logger.info('   2. sample_minimal_partial_payment.pdf (PARTIAL badge)');
    logger.info('   3. sample_minimal_no_gst.pdf (RECEIPT, tax-free)');
    logger.info('   4. sample_minimal_business_unpaid.pdf (business customer, UNPAID)');

    process.exit(fail === 0 ? 0 : 1);
  } catch (error) {
    logger.error('Test crashed:', error);
    try { await pdfService.closeBrowser(); } catch (e) {}
    try { await mongoose.disconnect(); } catch (e) {}
    process.exit(1);
  }
};

test();
