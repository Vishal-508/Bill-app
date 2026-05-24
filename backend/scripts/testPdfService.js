require('dotenv').config();
if (process.env.NODE_ENV !== 'production') {
  const dns = require('dns');
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
}

const fs = require('fs/promises');
const path = require('path');
const pdfService = require('../src/utils/pdfService');
const { amountToWords } = require('../src/utils/amountToWords');
const logger = require('../src/config/logger');

const test = async () => {
  try {
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

    // Test 1: Template loading
    logger.info('\nTest 1: Template loading');
    try {
      const template = await pdfService.loadTemplate('test');
      assert('Template loaded', typeof template === 'function');
    } catch (err) {
      assert('Template loaded', false, err.message);
    }

    // Test 2: Template rendering
    logger.info('\nTest 2: Template rendering with data');
    const sampleData = {
      title: 'PDF Generation Test',
      subtitle: 'Smoke test for Puppeteer + Handlebars',
      generatedAt: new Date(),
      testNumber: 'TEST-001',
      items: [
        { description: 'MDF 18mm 8x4 Interior', qty: 2, rate: 2000, amount: 4000 },
        { description: 'MDF 12mm Bundle 24x6 inch', qty: 1, rate: 1500, amount: 1500 },
        { description: 'Custom cut pieces 18x9 inch', qty: 10, rate: 250, amount: 2500 },
      ],
      total: 8000,
      amountInWords: amountToWords(8000),
    };

    let html;
    try {
      html = await pdfService.renderTemplate('test', sampleData);
      assert('HTML generated', html && html.length > 1000);
      assert('Contains test data', html.includes('TEST-001'));
      assert('Indian currency format (8,000.00)', html.includes('8,000.00'));
      assert('Amount in words present', html.includes('Rupees'));
    } catch (err) {
      assert('Template rendering', false, err.message);
    }

    // Test 3: PDF generation
    logger.info('\nTest 3: PDF generation');
    let pdfBuffer;
    let firstPdfMs = 0;
    try {
      const t0 = Date.now();
      pdfBuffer = await pdfService.generatePdfFromHtml(html);
      firstPdfMs = Date.now() - t0;

      assert('PDF buffer generated', Buffer.isBuffer(pdfBuffer));
      assert('PDF size reasonable', pdfBuffer.length > 1000 && pdfBuffer.length < 1000000,
        `Size: ${pdfBuffer.length} bytes`);
      assert('PDF magic bytes (%PDF)',
        pdfBuffer.subarray(0, 4).toString() === '%PDF');

      logger.info(`  ⏱️  PDF generated in ${firstPdfMs}ms`);
    } catch (err) {
      assert('PDF generation', false, err.message);
    }

    // Test 4: Full pipeline
    logger.info('\nTest 4: Full pipeline (template → PDF → save)');
    try {
      const result = await pdfService.generateAndSave(
        'test',
        sampleData,
        'smoke_test_pdf_service'
      );

      assert('PDF saved', result.path != null);
      assert('File exists on disk', (await fs.stat(result.path)).size > 0);
      assert('Size reported', result.sizeBytes > 0);

      logger.info(`  📄 Test PDF: ${result.path}`);
      logger.info(`  📦 Size: ${(result.sizeBytes / 1024).toFixed(1)} KB`);
    } catch (err) {
      assert('Full pipeline', false, err.message);
    }

    // Test 5: Browser reuse
    logger.info('\nTest 5: Browser reuse');
    let secondPdfMs = 0;
    try {
      const t0 = Date.now();
      await pdfService.generatePdfFromHtml(html);
      const first = Date.now() - t0;

      const t1 = Date.now();
      await pdfService.generatePdfFromHtml(html);
      secondPdfMs = Date.now() - t1;

      logger.info(`  ⏱️  First: ${first}ms, Second: ${secondPdfMs}ms`);
      assert('Browser reuse works', secondPdfMs < first + 500,
        `Should not require relaunch. First: ${first}ms, Second: ${secondPdfMs}ms`);
    } catch (err) {
      assert('Browser reuse', false, err.message);
    }

    // Test 6: Concurrent generation
    logger.info('\nTest 6: Concurrent generation (3 PDFs parallel)');
    try {
      const t0 = Date.now();
      const results = await Promise.all([
        pdfService.generatePdfFromHtml(html),
        pdfService.generatePdfFromHtml(html),
        pdfService.generatePdfFromHtml(html),
      ]);
      const elapsed = Date.now() - t0;

      assert('All 3 PDFs generated', results.every(b => Buffer.isBuffer(b) && b.length > 1000));
      logger.info(`  ⏱️  3 concurrent PDFs in ${elapsed}ms`);
    } catch (err) {
      assert('Concurrent generation', false, err.message);
    }

    // Test 7: Storage verification
    logger.info('\nTest 7: Storage verification');
    const storageDir = path.join(__dirname, '../storage/bills');
    try {
      const files = await fs.readdir(storageDir);
      const pdfFiles = files.filter(f => f.endsWith('.pdf'));
      assert('Storage directory exists', true);
      assert('At least 1 PDF file present', pdfFiles.length >= 1, `Files: ${pdfFiles.length}`);
    } catch (err) {
      assert('Storage verification', false, err.message);
    }

    // Test 8: Handlebars helpers
    logger.info('\nTest 8: Handlebars helpers');
    try {
      const handlebars = require('handlebars');

      const currencyResult = handlebars.helpers.formatCurrency(1234567.89);
      assert('formatCurrency Indian style', currencyResult === '12,34,567.89',
        `Got: ${currencyResult}`);

      const dateResult = handlebars.helpers.formatDate(new Date('2026-05-15'));
      assert('formatDate DD/MM/YYYY', dateResult === '15/05/2026',
        `Got: ${dateResult}`);

      const eqResult = handlebars.helpers.eq('a', 'a');
      assert('eq helper', eqResult === true);

      const incResult = handlebars.helpers.inc(5);
      assert('inc helper', incResult === 6);
    } catch (err) {
      assert('Handlebars helpers', false, err.message);
    }

    // Cleanup
    logger.info('\nCleanup');
    await pdfService.closeBrowser();
    logger.info('  ✅ Browser closed');

    logger.info('\n═══════════════════════════════════════');
    logger.info(`📊 PDF Service Tests: ${pass}/${pass + fail} passed`);
    logger.info(`   First PDF: ${firstPdfMs}ms,  Second PDF: ${secondPdfMs}ms`);
    if (failures.length > 0) {
      logger.info('\nFailures:');
      failures.forEach((f, i) => logger.info(`  ${i + 1}. ${f}`));
    }

    logger.info('\n📂 Manually inspect generated PDF:');
    logger.info(`   backend/storage/bills/smoke_test_pdf_service.pdf`);

    process.exit(fail === 0 ? 0 : 1);
  } catch (error) {
    logger.error('Test crashed:', error);
    try { await pdfService.closeBrowser(); } catch (e) {}
    process.exit(1);
  }
};

test();
