require('dotenv').config();
if (process.env.NODE_ENV !== 'production') {
  const dns = require('dns');
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
}

const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const mongoose = require('mongoose');
const logger = require('../src/config/logger');
const models = require('../src/models');
const { User } = models;

const generator = require('./generateSampleTemplates');
const inspector = require('./inspectExcel');
const migrator = require('./migrateExcel');

const TAG = 'DOCS_E_TEST';
const BACKEND_ROOT = path.join(__dirname, '..');
const DOCS_PATH = path.join(BACKEND_ROOT, 'docs', 'MIGRATION_GUIDE.md');
const DATA_DIR = path.join(BACKEND_ROOT, 'data');
const CUSTOMERS_XLSX = path.join(DATA_DIR, 'sample-customers.xlsx');
const BILLS_XLSX = path.join(DATA_DIR, 'sample-bills.xlsx');

const test = async () => {
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

  await mongoose.connect(process.env.MONGODB_URI);

  const generatedLogPaths = [];

  const cleanup = async () => {
    // Generated migration log files from any dry-run during T7
    for (const p of generatedLogPaths) {
      try { fs.unlinkSync(p); } catch {}
    }
  };

  try {
    logger.info('\n═══ SECTION E — Migration Docs + Templates Smoke Test ═══');

    // Ensure samples exist before the test runs (idempotent re-generate)
    logger.info('\nSetup: regenerate sample templates');
    generator.writeSheet(CUSTOMERS_XLSX, 'Customers', generator.CUSTOMERS);
    generator.writeSheet(BILLS_XLSX, 'Bills', generator.BILLS);

    // ═══════════════════════════════════════════════
    // T1: MIGRATION_GUIDE.md exists + non-empty
    // ═══════════════════════════════════════════════
    logger.info('\nT1: MIGRATION_GUIDE.md exists + non-empty');
    let guideStat;
    try { guideStat = fs.statSync(DOCS_PATH); } catch {}
    assert('docs/MIGRATION_GUIDE.md exists', guideStat?.isFile?.() === true,
      DOCS_PATH);
    assert('Guide has substantial content (> 2 KB)',
      (guideStat?.size || 0) > 2048,
      `Size: ${guideStat?.size}`);

    // ═══════════════════════════════════════════════
    // T2: Guide contains key sections
    // ═══════════════════════════════════════════════
    logger.info('\nT2: Guide covers key sections');
    const guide = fs.readFileSync(DOCS_PATH, 'utf8');
    const required = [
      'Prerequisites',
      'Step 1', 'Step 2', 'Step 3', 'Step 4', 'Step 5', 'Step 6', 'Step 7',
      'Idempotency',
      'Common Issues',
      'Limitations',
    ];
    const missing = required.filter(s => !guide.includes(s));
    assert(`All ${required.length} required sections present`,
      missing.length === 0,
      `Missing: ${missing.join(', ')}`);
    assert('Guide mentions --dry-run flag',
      guide.includes('--dry-run'));
    assert('Guide mentions migrationMeta.source',
      guide.includes('migrationMeta.source'));

    // ═══════════════════════════════════════════════
    // T3-T4: Sample customers template
    // ═══════════════════════════════════════════════
    logger.info('\nT3: sample-customers.xlsx exists + readable');
    let custStat;
    try { custStat = fs.statSync(CUSTOMERS_XLSX); } catch {}
    assert('sample-customers.xlsx exists',
      custStat?.isFile?.() === true,
      CUSTOMERS_XLSX);
    assert('sample-customers.xlsx non-empty',
      (custStat?.size || 0) > 1000);

    logger.info('\nT4: sample-customers.xlsx has expected columns');
    const custAnalysis = inspector.inspectFile(CUSTOMERS_XLSX);
    assert('1 sheet in customers template',
      custAnalysis.sheets.length === 1);
    const custSheet = custAnalysis.sheets[0];
    assert('Sheet named "Customers"',
      custSheet.name === 'Customers');
    const expectedCustHeaders = [
      'Customer Name', 'Company', 'Phone', 'Email', 'GSTIN',
      'Address', 'City', 'State', 'Pincode',
    ];
    const missingHeaders = expectedCustHeaders.filter(
      h => !custSheet.headers.includes(h)
    );
    assert(`All ${expectedCustHeaders.length} expected columns present`,
      missingHeaders.length === 0,
      `Missing: ${missingHeaders.join(', ')} ; Got: ${custSheet.headers.join(', ')}`);
    assert('5 data rows in customers template',
      custSheet.dataRowCount === 5,
      `Got ${custSheet.dataRowCount}`);

    // ═══════════════════════════════════════════════
    // T5: Sample bills + cross-reference with customers
    // ═══════════════════════════════════════════════
    logger.info('\nT5: sample-bills.xlsx + phone cross-reference');
    let billsStat;
    try { billsStat = fs.statSync(BILLS_XLSX); } catch {}
    assert('sample-bills.xlsx exists', billsStat?.isFile?.() === true);

    const billsAnalysis = inspector.inspectFile(BILLS_XLSX);
    const billsSheet = billsAnalysis.sheets[0];
    assert('Bills sheet named "Bills"', billsSheet.name === 'Bills');
    const expectedBillHeaders = [
      'Invoice No', 'Date', 'Customer Phone', 'Product Description',
      'Pieces', 'Rate', 'Grand Total', 'Bill Type',
    ];
    const missingBillHeaders = expectedBillHeaders.filter(
      h => !billsSheet.headers.includes(h)
    );
    assert(`All ${expectedBillHeaders.length} expected bill columns present`,
      missingBillHeaders.length === 0,
      `Missing: ${missingBillHeaders.join(', ')}`);

    // Cross-ref: every phone in bills should appear in customers
    const custPhones = new Set(
      generator.CUSTOMERS.slice(1).map(row => String(row[2])) // Phone column
    );
    const billPhones = generator.BILLS.slice(1).map(row => String(row[2]));
    const orphans = billPhones.filter(p => !custPhones.has(p));
    assert('All bill phones exist in customer phones (cross-ref consistent)',
      orphans.length === 0,
      `Orphans: ${orphans.join(', ')}`);

    // ═══════════════════════════════════════════════
    // T6: Inspect output matches what the guide describes
    // ═══════════════════════════════════════════════
    logger.info('\nT6: inspectExcel produces expected structure on sample');
    const report = inspector.formatReport(custAnalysis);
    assert('Report contains expected file path',
      report.includes(CUSTOMERS_XLSX));
    assert('Report mentions "Sample rows"',
      report.includes('Sample rows'));
    // Should detect Bill Type as enum-like (low cardinality) in the bills sample
    const billTypeCol = billsSheet.columns.find(c => c.header === 'Bill Type');
    assert('Bill Type column has uniqueValues listed (low cardinality)',
      Array.isArray(billTypeCol?.uniqueValues) &&
      billTypeCol.uniqueValues.includes('GST'));

    // ═══════════════════════════════════════════════
    // T7: Dry-run migration against sample-customers.xlsx
    // ═══════════════════════════════════════════════
    logger.info('\nT7: Dry-run migration on sample-customers.xlsx');
    const adminUser = await User.findOne({ email: 'testadmin@shreegopal.com' }).select('_id').lean();
    if (!adminUser) throw new Error('testadmin user not found');

    const sampleMapping = {
      customers: {
        sheetName: 'Customers',
        columns: {
          customerName: 'Customer Name',
          companyName: 'Company',
          phone: 'Phone',
          email: 'Email',
          gstin: 'GSTIN',
          addressLine1: 'Address',
          city: 'City',
          state: 'State',
          pincode: 'Pincode',
        },
      },
    };

    const dryLog = await migrator.runMigration({
      file: CUSTOMERS_XLSX,
      mapping: sampleMapping,
      models,
      createdBy: adminUser._id,
      dryRun: true,
      phase: 'customers',
      limit: 0,
      source: `${TAG}_dryrun`,
      logsDir: DATA_DIR,
    });
    if (dryLog.logFile) generatedLogPaths.push(dryLog.logFile);
    // Dry-run should count 5 customers as would-be created OR updated
    const counted = (dryLog.results.customers?.created || 0) +
                    (dryLog.results.customers?.updated || 0);
    assert('Dry-run counted 5 rows would be migrated',
      counted === 5, `Got ${counted}`);
    assert('Dry-run has total = 5',
      dryLog.results.customers?.total === 5,
      `Got ${dryLog.results.customers?.total}`);

    // ─── Cleanup ───
    logger.info('\nCleanup');
    await cleanup();
    logger.info('  Dry-run log files removed');

    await mongoose.disconnect();

    logger.info('\n═══════════════════════════════════════');
    logger.info(`📊 Migration Docs + Templates (Section E): ${pass}/${pass + fail} passed`);
    if (failures.length > 0) {
      logger.info('\nFailures:');
      failures.forEach((f, i) => logger.info(`  ${i + 1}. ${f}`));
    }
    process.exit(fail === 0 ? 0 : 1);
  } catch (error) {
    logger.error('Test crashed:', error.message);
    logger.error(error.stack);
    try { await cleanup(); } catch {}
    try { await mongoose.disconnect(); } catch {}
    process.exit(1);
  }
};

test();
