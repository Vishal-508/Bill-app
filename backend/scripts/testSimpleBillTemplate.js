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
      bankDetails: 'Bank: SBI\nA/c: 32145678901\nIFSC: SBIN0001234\nBranch: Indore Main',
    };

    // ─── Scenario 1: Regular customer with GST ───
    logger.info('\nScenario 1: Regular customer (GST, intra-state)');

    const regularData = {
      billNumber: 'INV-2026-051',
      fiscalYear: '2026-27',
      issueDate: new Date('2026-05-24'),
      orderNumber: 'ORD-2026-075',
      hasGst: true,
      isIntraState: true,
      businessInfo,
      customerInfo: {
        customerName: 'Suresh Patel',
        companyName: 'Patel Carpentry',
        phone: '+91-9000000123',
        gstin: '23PQRST5678U2V6',
        billingAddress: {
          addressLine1: 'Shop 12, Carpentry Lane',
          city: 'Indore',
          state: 'Madhya Pradesh',
          pincode: '452001',
        },
      },
      placeOfSupply: 'Madhya Pradesh',
      items: [
        {
          serialNo: 1,
          hsnCode: '4411',
          description: 'MDF 18mm Interior Grade',
          productSku: 'MDF-18MM-INT',
          itemType: 'FULL_SHEET',
          quantity: 3,
          unit: 'sheets',
          pricePerUnit: 2240,
          taxableAmount: 6720,
          gstRatePct: 18,
          cgst: 604.80,
          sgst: 604.80,
          lineTotal: 7929.60,
        },
        {
          serialNo: 2,
          hsnCode: '4411',
          description: 'Custom Cut Pieces',
          dimensions: { lengthInches: 18, widthInches: 12, display: '18×12 inch' },
          itemType: 'CUSTOM_CUT',
          quantity: 8,
          unit: 'pieces',
          pricePerUnit: 230,
          materialCost: 1600,
          cuttingCharges: 240,
          taxableAmount: 1840,
          gstRatePct: 18,
          cgst: 165.60,
          sgst: 165.60,
          lineTotal: 2171.20,
        },
      ],
      subtotal: 8560,
      taxableAmount: 8560,
      totalCgst: 770.40,
      totalSgst: 770.40,
      totalGst: 1540.80,
      grandTotal: 10100.80,
      amountInWords: amountToWords(10100.80),
      amountPaid: 0,
      amountDue: 10100.80,
      paymentStatus: 'UNPAID',
      termsAndConditions: '1. Goods once sold not returnable. 2. Subject to Indore jurisdiction.',
      events: [],
      revisionNumber: 0,
    };

    const regularTemplate = await mapBillToTemplate(regularData);
    assert('Regular: Template mapped', regularTemplate.billNumber === 'INV-2026-051');
    assert('Regular: 2 items', regularTemplate.items.length === 2);

    const regularHtml = await pdfService.renderTemplate('simple-bill', regularTemplate);
    assert('Regular: HTML rendered', regularHtml.length > 3000);
    assert('Regular: Has TAX INVOICE label', regularHtml.includes('TAX INVOICE'));
    assert('Regular: Shows GSTIN', regularHtml.includes('23PQRST5678U2V6'));
    assert('Regular: Currency formatted', regularHtml.includes('10,100.80'));
    assert('Regular: UNPAID badge', regularHtml.includes('UNPAID'));

    const regularResult = await pdfService.generateAndSave(
      'simple-bill', regularTemplate, 'sample_simple_bill_regular'
    );
    assert('Regular: PDF generated', regularResult.path != null);
    assert('Regular: Reasonable size',
      regularResult.sizeBytes > 30000 && regularResult.sizeBytes < 300000,
      `Size: ${(regularResult.sizeBytes/1024).toFixed(1)} KB`);

    // ─── Scenario 2: Many items (test single-page) ───
    logger.info('\nScenario 2: Many items (10 items, single-page test)');

    const manyItems = Array.from({ length: 10 }, (_, i) => ({
      serialNo: i + 1,
      hsnCode: '4411',
      description: `MDF Item ${i + 1} - Product Description`,
      itemType: 'FULL_SHEET',
      quantity: i + 1,
      unit: 'pcs',
      pricePerUnit: 500 + (i * 100),
      taxableAmount: (500 + (i * 100)) * (i + 1),
      gstRatePct: 18,
      cgst: (500 + (i * 100)) * (i + 1) * 0.09,
      sgst: (500 + (i * 100)) * (i + 1) * 0.09,
      lineTotal: (500 + (i * 100)) * (i + 1) * 1.18,
    }));

    const manyTotal = manyItems.reduce((s, i) => s + i.lineTotal, 0);
    const manyTaxable = manyItems.reduce((s, i) => s + i.taxableAmount, 0);
    const manyGst = manyTotal - manyTaxable;

    const manyData = {
      ...regularData,
      billNumber: 'INV-2026-052',
      items: manyItems,
      subtotal: manyTaxable,
      taxableAmount: manyTaxable,
      totalCgst: manyGst / 2,
      totalSgst: manyGst / 2,
      totalGst: manyGst,
      grandTotal: manyTotal,
      amountInWords: amountToWords(manyTotal),
      amountDue: manyTotal,
    };

    const manyTemplate = await mapBillToTemplate(manyData);
    const manyResult = await pdfService.generateAndSave(
      'simple-bill', manyTemplate, 'sample_simple_bill_many_items'
    );
    assert('Many items: PDF generated', manyResult.path != null);
    assert('Many items: 10 items mapped', manyTemplate.items.length === 10);

    // ─── Scenario 3: Partial payment ───
    logger.info('\nScenario 3: Partial payment status');

    const partialData = {
      ...regularData,
      billNumber: 'INV-2026-053',
      amountPaid: 5000,
      amountDue: 5100.80,
      paymentStatus: 'PARTIAL',
    };

    const partialTemplate = await mapBillToTemplate(partialData);
    const partialHtml = await pdfService.renderTemplate('simple-bill', partialTemplate);
    assert('Partial: PARTIAL badge', partialHtml.includes('PARTIAL'));

    const partialResult = await pdfService.generateAndSave(
      'simple-bill', partialTemplate, 'sample_simple_bill_partial_paid'
    );
    assert('Partial: PDF generated', partialResult.path != null);

    // ─── Scenario 4: No-GST simple bill ───
    logger.info('\nScenario 4: No-GST simple bill');

    const noGstData = {
      ...regularData,
      billNumber: 'INV-2026-054',
      hasGst: false,
      totalCgst: 0,
      totalSgst: 0,
      totalGst: 0,
      grandTotal: regularData.taxableAmount,
      amountInWords: amountToWords(regularData.taxableAmount),
    };

    const noGstTemplate = await mapBillToTemplate(noGstData);
    const noGstHtml = await pdfService.renderTemplate('simple-bill', noGstTemplate);
    assert('No-GST: Shows INVOICE (not TAX INVOICE)',
      noGstHtml.includes('INVOICE') && !noGstHtml.includes('CGST'));

    const noGstResult = await pdfService.generateAndSave(
      'simple-bill', noGstTemplate, 'sample_simple_bill_no_gst'
    );
    assert('No-GST: PDF generated', noGstResult.path != null);

    // ─── Cleanup ───
    await pdfService.closeBrowser();
    await mongoose.disconnect();

    logger.info('\n═══════════════════════════════════════');
    logger.info(`📊 Simple Bill Template Tests: ${pass}/${pass + fail} passed`);
    if (failures.length > 0) {
      logger.info('\nFailures:');
      failures.forEach((f, i) => logger.info(`  ${i + 1}. ${f}`));
    }

    logger.info('\n📂 Generated invoices for visual inspection:');
    logger.info('   1. sample_simple_bill_regular.pdf (2 items, intra-state, UNPAID)');
    logger.info('   2. sample_simple_bill_many_items.pdf (10 items, single-page test)');
    logger.info('   3. sample_simple_bill_partial_paid.pdf (PARTIAL payment badge)');
    logger.info('   4. sample_simple_bill_no_gst.pdf (no GST mode)');

    process.exit(fail === 0 ? 0 : 1);
  } catch (error) {
    logger.error('Test crashed:', error);
    try { await pdfService.closeBrowser(); } catch (e) {}
    try { await mongoose.disconnect(); } catch (e) {}
    process.exit(1);
  }
};

test();
