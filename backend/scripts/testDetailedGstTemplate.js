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

    logger.info('\nSetup: Building realistic invoice data');

    const realisticBillData = {
      billNumber: 'INV-2026-042',
      fiscalYear: '2026-27',
      issueDate: new Date('2026-05-24'),
      dueDate: new Date('2026-06-23'),
      orderNumber: 'ORD-2026-068',

      hasGst: true,
      isIntraState: true,

      businessInfo: {
        name: 'Shree Gopal MDF',
        address: '123, Industrial Area, Sector 5, Indore, Madhya Pradesh - 452015',
        phone: '+91-9876543210',
        email: 'sales@shreegopalmdf.com',
        gstin: '23ABCDE1234F1Z5',
        state: 'Madhya Pradesh',
        bankDetails: 'Bank: State Bank of India\nA/c No: 32145678901\nIFSC: SBIN0001234\nBranch: Indore Main Branch',
      },

      customerInfo: {
        customerName: 'Rajesh Kumar',
        companyName: 'Sharma Furniture Works',
        phone: '+91-9000000001',
        email: 'rajesh@sharmafurniture.com',
        gstin: '23PQRST5678U2V6',
        billingAddress: {
          addressLine1: 'Shop No. 45, Furniture Market',
          addressLine2: 'Near Sarafa Bazaar',
          city: 'Indore',
          state: 'Madhya Pradesh',
          pincode: '452002',
        },
        shippingAddress: {
          addressLine1: 'Plot 87, Industrial Estate',
          city: 'Indore',
          state: 'Madhya Pradesh',
          pincode: '452015',
        },
      },

      placeOfSupply: 'Madhya Pradesh',

      items: [
        {
          serialNo: 1,
          hsnCode: '4411',
          description: 'MDF Sheet 18mm Interior Grade',
          productSku: 'MDF-18MM-INT-001',
          productName: 'MDF 18mm 8x4 Interior',
          itemType: 'FULL_SHEET',
          quantity: 5,
          unit: 'sheets',
          pricePerUnit: 2240,
          materialCost: 11200,
          cuttingCharges: 0,
          taxableAmount: 11200,
          gstRatePct: 18,
          cgst: 1008,
          sgst: 1008,
          igst: 0,
          lineTotal: 13216,
        },
        {
          serialNo: 2,
          hsnCode: '4411',
          description: 'MDF Pre-Cut Bundle Standard',
          productSku: 'MDF-BDL-STD-024',
          productName: 'MDF 12mm Bundle 24x6 inch',
          itemType: 'BUNDLE',
          quantity: 2,
          unit: 'bundles',
          pricePerUnit: 1500,
          materialCost: 3000,
          cuttingCharges: 0,
          taxableAmount: 3000,
          gstRatePct: 18,
          cgst: 270,
          sgst: 270,
          igst: 0,
          lineTotal: 3540,
        },
        {
          serialNo: 3,
          hsnCode: '4411',
          description: 'Custom Cut Pieces — Round Shape',
          productSku: 'MDF-CUT-RND-001',
          productName: 'Custom Round Cut 12 inch dia',
          itemType: 'CUSTOM_CUT',
          dimensions: {
            lengthInches: 12,
            widthInches: 12,
            display: '12×12 inch (round)',
          },
          quantity: 20,
          unit: 'pieces',
          pricePerUnit: 175,
          materialCost: 2800,
          cuttingCharges: 700,
          taxableAmount: 3500,
          gstRatePct: 18,
          cgst: 315,
          sgst: 315,
          igst: 0,
          lineTotal: 4130,
          notes: 'For circular table tops — sanded edges',
        },
      ],

      subtotal: 17000,
      totalDiscount: 500,
      additionalCharges: 200,
      taxableAmount: 16700,
      totalCgst: 1593,
      totalSgst: 1593,
      totalIgst: 0,
      totalGst: 3186,
      roundOff: 0.05,
      grandTotal: 19886.05,
      amountInWords: amountToWords(19886.05),

      amountPaid: 5000,
      amountDue: 14886.05,
      paymentStatus: 'PARTIAL',

      deliveryMethod: 'DELIVERY',

      notesToCustomer: 'Goods delivered as per agreed specifications. Please verify dimensions before installation. Free polishing service available for orders above ₹15,000.',

      termsAndConditions: '1. Goods once sold will not be taken back. 2. Interest @ 18% p.a. will be charged on outstanding amount after due date. 3. Subject to Indore jurisdiction. 4. All disputes to be resolved through arbitration.',

      events: [],
      revisionNumber: 0,
    };

    // ─── Test 1: Data mapper ───
    logger.info('\nTest 1: Bill → Template data mapping');
    const templateData = await mapBillToTemplate(realisticBillData);

    assert('Template data has billNumber', templateData.billNumber === 'INV-2026-042');
    assert('Template data has 3 items', templateData.items.length === 3);
    assert('hasGst flag set', templateData.hasGst === true);
    assert('isIntraState flag set', templateData.isIntraState === true);
    assert('amountInWords computed', templateData.amountInWords.includes('Rupees'));
    assert('Custom cut item has dimensionsDisplay',
      templateData.items[2].dimensionsDisplay.includes('12'));
    assert('hasCutting flag on item 3', templateData.items[2].hasCutting === true);

    // ─── Test 2: Template rendering ───
    logger.info('\nTest 2: Template HTML rendering');
    const html = await pdfService.renderTemplate('detailed-gst', templateData);

    assert('HTML rendered', html.length > 5000);
    assert('Contains business name', html.includes('Shree Gopal MDF'));
    assert('Contains customer name', html.includes('Rajesh Kumar'));
    assert('Contains GSTIN', html.includes('23ABCDE1234F1Z5'));
    assert('TAX INVOICE label', html.includes('TAX INVOICE'));
    assert('All 3 items present',
      html.includes('MDF Sheet 18mm') &&
      html.includes('MDF Pre-Cut') &&
      html.includes('Custom Cut Pieces'));
    assert('Currency formatting (Indian)', html.includes('19,886.05'));
    assert('CGST/SGST shown (intra-state)', html.includes('CGST') && html.includes('SGST'));
    assert('Amount in words present', html.includes('Nineteen Thousand'));
    assert('Bank details shown', html.includes('State Bank of India'));
    assert('Terms & conditions shown', html.includes('Interest @ 18%'));

    // ─── Test 3: PDF generation ───
    logger.info('\nTest 3: PDF generation');
    const t0 = Date.now();
    const result = await pdfService.generateAndSave(
      'detailed-gst',
      templateData,
      'sample_detailed_gst_invoice'
    );
    const elapsed = Date.now() - t0;

    assert('PDF generated', result.path != null);
    assert('Reasonable size', result.sizeBytes > 30000 && result.sizeBytes < 500000,
      `Size: ${(result.sizeBytes/1024).toFixed(1)} KB`);
    assert('Magic bytes %PDF', result.buffer.subarray(0, 4).toString() === '%PDF');

    logger.info(`  ⏱️  Generated in ${elapsed}ms`);
    logger.info(`  📄 Path: ${result.path}`);
    logger.info(`  📦 Size: ${(result.sizeBytes/1024).toFixed(1)} KB`);

    // ─── Test 4: Inter-state variant (IGST) ───
    logger.info('\nTest 4: Inter-state variant (IGST)');
    const interStateData = JSON.parse(JSON.stringify(templateData));
    interStateData.isIntraState = false;
    interStateData.customer.billingAddress.state = 'Maharashtra';
    interStateData.placeOfSupply = 'Maharashtra';
    interStateData.totalIgst = 3186;
    interStateData.totalCgst = 0;
    interStateData.totalSgst = 0;
    interStateData.items.forEach(item => {
      item.igst = (item.cgst || 0) + (item.sgst || 0);
      item.cgst = 0;
      item.sgst = 0;
    });

    const interStateResult = await pdfService.generateAndSave(
      'detailed-gst',
      interStateData,
      'sample_invoice_interstate_igst'
    );
    assert('Inter-state PDF generated', interStateResult.path != null);

    // ─── Test 5: No-GST variant ───
    logger.info('\nTest 5: No-GST variant');
    const noGstData = JSON.parse(JSON.stringify(templateData));
    noGstData.hasGst = false;
    noGstData.totalCgst = 0;
    noGstData.totalSgst = 0;
    noGstData.totalIgst = 0;
    noGstData.totalGst = 0;
    noGstData.grandTotal = noGstData.taxableAmount;
    noGstData.amountInWords = amountToWords(noGstData.grandTotal);

    const noGstResult = await pdfService.generateAndSave(
      'detailed-gst',
      noGstData,
      'sample_invoice_no_gst'
    );
    assert('No-GST PDF generated', noGstResult.path != null);

    // ─── Cleanup ───
    await pdfService.closeBrowser();
    await mongoose.disconnect();

    logger.info('\n═══════════════════════════════════════');
    logger.info(`📊 Detailed GST Template Tests: ${pass}/${pass + fail} passed`);
    if (failures.length > 0) {
      logger.info('\nFailures:');
      failures.forEach((f, i) => logger.info(`  ${i + 1}. ${f}`));
    }

    logger.info('\n📂 Generated invoices for visual inspection:');
    logger.info('   1. sample_detailed_gst_invoice.pdf (intra-state, CGST+SGST)');
    logger.info('   2. sample_invoice_interstate_igst.pdf (inter-state, IGST)');
    logger.info('   3. sample_invoice_no_gst.pdf (no GST)');

    process.exit(fail === 0 ? 0 : 1);
  } catch (error) {
    logger.error('Test crashed:', error);
    try { await pdfService.closeBrowser(); } catch (e) {}
    try { await mongoose.disconnect(); } catch (e) {}
    process.exit(1);
  }
};

test();
