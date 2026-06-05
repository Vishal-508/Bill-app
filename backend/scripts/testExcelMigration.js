require('dotenv').config();
if (process.env.NODE_ENV !== 'production') {
  const dns = require('dns');
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
}

const fs = require('fs');
const os = require('os');
const path = require('path');
const xlsx = require('xlsx');
const mongoose = require('mongoose');
const logger = require('../src/config/logger');
const models = require('../src/models');
const { Customer, Order, Bill, SystemSetting, User } = models;

const helpers = require('./migrationHelpers');
const migrator = require('./migrateExcel');

const TAG = 'TEST_MIGRATE';
const SOURCE_PREFIX = `${TAG}_`;

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

  const createdFiles = [];
  let createdByUserId;
  const logsDir = path.join(os.tmpdir(), `${TAG}_logs_${Date.now()}`);
  fs.mkdirSync(logsDir, { recursive: true });

  const synthesize = (sheetName, rows, suffix) => {
    const wb = xlsx.utils.book_new();
    const ws = xlsx.utils.aoa_to_sheet(rows, { cellDates: true });
    xlsx.utils.book_append_sheet(wb, ws, sheetName);
    const filePath = path.join(os.tmpdir(),
      `${TAG}-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.xlsx`);
    xlsx.writeFile(wb, filePath);
    createdFiles.push(filePath);
    return filePath;
  };

  const cleanup = async () => {
    // Delete by migrationMeta.source prefix
    const sourceFilter = { 'migrationMeta.source': { $regex: `^${SOURCE_PREFIX}` } };
    await Bill.deleteMany(sourceFilter);
    await Order.deleteMany(sourceFilter);
    await Customer.deleteMany(sourceFilter);
    // Also files
    for (const f of createdFiles) {
      try { fs.unlinkSync(f); } catch {}
    }
    try {
      const files = fs.readdirSync(logsDir);
      for (const f of files) fs.unlinkSync(path.join(logsDir, f));
      fs.rmdirSync(logsDir);
    } catch {}
  };

  try {
    logger.info('\n═══ SECTION D — Excel Migration Smoke Test ═══');

    // Use existing admin user for createdBy
    const adminUser = await User.findOne({ email: 'testadmin@shreegopal.com' }).select('_id').lean();
    if (!adminUser) throw new Error('testadmin@shreegopal.com not found — run seed:admin first');
    createdByUserId = adminUser._id;

    // ═══════════════════════════════════════════════
    // Helper functions (5 tests)
    // ═══════════════════════════════════════════════
    logger.info('\n--- Helper functions ---');

    logger.info('\nT1: normalizePhone(\'+91 98765-43210\') → \'9876543210\'');
    assert('Strips +91, spaces, hyphens',
      helpers.normalizePhone('+91 98765-43210') === '9876543210');

    logger.info('\nT2: normalizePhone(\'5555555555\') → null (invalid first digit)');
    assert('Rejects phone starting with 5',
      helpers.normalizePhone('5555555555') === null);
    assert('Returns null for empty',
      helpers.normalizePhone('') === null);

    logger.info('\nT3: normalizeGstin uppercases + trims');
    assert('Lowercase → uppercase',
      helpers.normalizeGstin(' 23abcde1234f1z5 ') === '23ABCDE1234F1Z5');
    assert('Invalid format → null',
      helpers.normalizeGstin('garbage') === null);

    logger.info('\nT4: normalizeDate handles Excel serials, ISO, dd/mm/yyyy');
    const d1 = helpers.normalizeDate(45000); // Excel serial for ~2023-03-15
    assert('Excel serial 45000 → Date instance',
      d1 instanceof Date && !Number.isNaN(d1.getTime()));
    const d2 = helpers.normalizeDate('15/03/2023');
    assert('dd/mm/yyyy → Date',
      d2 instanceof Date && d2.getFullYear() === 2023 && d2.getMonth() === 2,
      `Got year=${d2?.getFullYear()} month=${d2?.getMonth()}`);
    const d3 = helpers.normalizeDate('2023-03-15');
    assert('ISO → Date',
      d3 instanceof Date && d3.getFullYear() === 2023);
    assert('Invalid → null', helpers.normalizeDate('not a date') === null);

    logger.info('\nT5: normalizeMoney strips currency symbols');
    assert('₹ 12,345.67 → 12345.67',
      helpers.normalizeMoney('₹ 12,345.67') === 12345.67);
    assert('Number passthrough', helpers.normalizeMoney(100) === 100);
    assert('Garbage → null', helpers.normalizeMoney('free') === null);

    // ═══════════════════════════════════════════════
    // Helpers: address + billType + placeholders (extra)
    // ═══════════════════════════════════════════════
    logger.info('\n--- Helpers: address + billType + placeholders ---');
    const addr = helpers.normalizeAddress({
      line1: ' Plot 14 ', city: 'Indore', state: 'Madhya Pradesh', pincode: '452001',
    });
    assert('Address normalize: line1 trimmed', addr.addressLine1 === 'Plot 14');
    assert('Address normalize: stateCode resolved',
      addr.stateCode === '23' && addr.state === 'Madhya Pradesh');
    assert('Address abbreviation lookup', helpers.normalizeAddress({ state: 'MP' }).stateCode === '23');

    assert('inferBillType: gstin present → GST',
      helpers.inferBillType('23ABCDE1234F1Z5') === 'GST');
    assert('inferBillType: no gstin → NON_GST',
      helpers.inferBillType(null) === 'NON_GST');
    assert('inferBillType: raw NON-GST normalized',
      helpers.inferBillType(null, 'Non-GST') === 'NON_GST');

    const placeholders = helpers.findPlaceholders(migrator.DEFAULT_MAPPING);
    assert('Default mapping has placeholders',
      placeholders.length > 0,
      `Found ${placeholders.length}`);

    // ═══════════════════════════════════════════════
    // Safety + dry-run (3 tests)
    // ═══════════════════════════════════════════════
    logger.info('\n--- Safety + dry-run ---');

    logger.info('\nT6: runMigration with default placeholder mapping → phases skipped');
    const dummyFile = synthesize('AnySheet', [['a'], [1]], 't6dummy');
    const log6 = await migrator.runMigration({
      file: dummyFile,
      mapping: migrator.DEFAULT_MAPPING,
      models,
      createdBy: createdByUserId,
      dryRun: true,
      phase: 'all',
      limit: 0,
      source: `${SOURCE_PREFIX}t6`,
      logsDir,
    });
    assert('customers phase skipped: placeholders_unresolved',
      log6.results.customers?.reason === 'placeholders_unresolved');
    assert('bills phase skipped: placeholders_unresolved',
      log6.results.bills?.reason === 'placeholders_unresolved');

    logger.info('\nT7: parseArgs handles flags');
    const args1 = migrator.parseArgs(['node', 's.js', '--file', 'a.xlsx', '--dry-run', '--limit', '50', '--force', '--phase', 'customers']);
    assert('parseArgs read all flags',
      args1.file === 'a.xlsx' && args1.dryRun === true && args1.limit === 50 &&
      args1.force === true && args1.phase === 'customers');

    logger.info('\nT8: --help flag detected');
    const args2 = migrator.parseArgs(['node', 's.js', '-h']);
    assert('Help flag honored', args2.help === true);

    // ═══════════════════════════════════════════════
    // Customer migration (6 tests)
    // ═══════════════════════════════════════════════
    logger.info('\n--- Customer migration ---');

    const customerSource = `${SOURCE_PREFIX}customers`;
    const custMapping = {
      customers: {
        sheetName: 'Customers',
        columns: {
          companyName: 'Company', customerName: 'Name',
          phone: 'Phone', email: 'Email', gstin: 'GSTIN',
          addressLine1: 'Address1', city: 'City', state: 'State', pincode: 'Pincode',
        },
      },
    };

    // Use clearly test-only phones AND test-only GSTINs (no overlap with
    // any seeded fixtures from earlier prompts — which use 23ABCDE1234F1Z5
    // as the canonical test GSTIN). Pre-clean explicitly by both indexes.
    const TEST_PHONES = ['9888777611', '9888777622', '9888777633'];
    const TEST_GSTINS = ['23TMIGR0001M1Z7', '23TMIGR0002M1Z8'];
    await Customer.deleteMany({
      $or: [
        { phone: { $in: TEST_PHONES } },
        { gstin: { $in: TEST_GSTINS } },
      ],
    });

    const customerRows = [
      ['Company', 'Name', 'Phone', 'Email', 'GSTIN', 'Address1', 'City', 'State', 'Pincode'],
      ['Acme Pvt Ltd', 'Alice Verma', `+91 ${TEST_PHONES[0].slice(0,5)}-${TEST_PHONES[0].slice(5)}`, 'alice@acme.test', TEST_GSTINS[0], 'Plot 1', 'Indore', 'MP', '452001'],
      ['Beta LLC', 'Bob Singh', TEST_PHONES[1], 'bob@beta.test', '', 'Plot 2', 'Bhopal', 'MP', '462001'],
      ['Gamma Co', 'Charlie Patel', TEST_PHONES[2], '', TEST_GSTINS[1], 'Plot 3', 'Jaipur', 'RJ', '302001'],
      // Invalid phone (starts with 5)
      ['Delta', 'Dan Bad', '5111222333', '', '', '', '', '', ''],
    ];
    const custFile = synthesize('Customers', customerRows, 'cust');

    logger.info('\nT9: Migrate 3 valid customers');
    const log9 = await migrator.runMigration({
      file: custFile, mapping: custMapping, models,
      createdBy: createdByUserId, dryRun: false,
      phase: 'customers', limit: 0,
      source: customerSource, logsDir,
    });
    logger.info(`  [debug] customers stats: ${JSON.stringify(log9.results.customers)}`);
    assert('3 created (4 rows, 1 invalid phone skipped)',
      log9.results.customers?.created === 3,
      `Got ${log9.results.customers?.created}`);
    assert('1 skipped with invalid_phone reason',
      log9.results.customers?.skipped.length === 1 &&
      log9.results.customers.skipped[0].reason === 'invalid_phone');

    logger.info('\nT10: Re-run same migration → 0 created, 3 updated (idempotent)');
    const log10 = await migrator.runMigration({
      file: custFile, mapping: custMapping, models,
      createdBy: createdByUserId, dryRun: false,
      phase: 'customers', limit: 0,
      source: customerSource, logsDir,
    });
    assert('Idempotency: 0 created',
      log10.results.customers?.created === 0,
      `Got ${log10.results.customers?.created}`);

    logger.info('\nT11: GSTIN uppercase stored');
    const cust1 = await Customer.findOne({ phone: TEST_PHONES[0] }).lean();
    assert('Customer found by normalized phone', cust1 != null);
    assert('GSTIN stored uppercase', cust1?.gstin === TEST_GSTINS[0]);
    assert('Address normalized (stateCode added)',
      cust1?.billingAddress?.stateCode === '23');

    logger.info('\nT12: migrationMeta tagged correctly');
    assert('migrationMeta.source set',
      cust1?.migrationMeta?.source === customerSource);
    assert('migrationMeta.sourceRow set',
      typeof cust1?.migrationMeta?.sourceRow === 'number');

    logger.info('\nT13: Update only fills empty fields (non-destructive)');
    // Manually set notes to a known value, then re-migrate. The notes
    // should remain untouched because the Excel doesn't include it.
    await Customer.updateOne({ _id: cust1._id }, { $set: { notes: 'manual entry preserved' } });
    await migrator.runMigration({
      file: custFile, mapping: custMapping, models,
      createdBy: createdByUserId, dryRun: false,
      phase: 'customers', limit: 0,
      source: customerSource, logsDir,
    });
    const cust1Re = await Customer.findById(cust1._id).lean();
    assert('Manually-set notes preserved across re-migration',
      cust1Re.notes === 'manual entry preserved');

    logger.info('\nT14: Customer without gstin still migrates');
    const cust2 = await Customer.findOne({ phone: TEST_PHONES[1] }).lean();
    assert('Bob created without gstin', cust2 != null && !cust2.gstin);

    // ═══════════════════════════════════════════════
    // Bill migration (5 tests)
    // ═══════════════════════════════════════════════
    logger.info('\n--- Bill migration ---');

    const billSource = `${SOURCE_PREFIX}bills`;
    const billMapping = {
      bills: {
        sheetName: 'Bills',
        columns: {
          invoiceNo: 'InvNo', invoiceDate: 'InvDate',
          customerPhone: 'CustPhone', productDescription: 'Desc',
          pieces: 'Pcs', ratePerSqFt: 'Rate',
          grandTotal: 'Total', billType: 'BillType',
        },
      },
    };
    const billRows = [
      ['InvNo', 'InvDate', 'CustPhone', 'Desc', 'Pcs', 'Rate', 'Total', 'BillType'],
      ['INV-MIG-001', new Date('2024-04-10'), TEST_PHONES[0], 'MDF 18mm 8x4', 50, 600, 30000, 'GST'],
      ['INV-MIG-002', new Date('2024-04-15'), TEST_PHONES[1], 'MDF 12mm 8x4', 25, 400, 10000, 'NON_GST'],
      ['INV-MIG-003', new Date('2024-05-20'), TEST_PHONES[2], 'MDF 6mm 6x3', 100, 250, 25000, ''],
      ['INV-MIG-004', new Date('2024-06-01'), TEST_PHONES[0], 'MDF 25mm 8x4', 10, 1200, 12000, 'GST'],
      // Unknown phone → should skip
      ['INV-MIG-005', new Date('2024-06-15'), '9000000000', 'Unknown', 5, 100, 500, ''],
    ];
    const billFile = synthesize('Bills', billRows, 'bills');

    logger.info('\nT15: Migrate 4 bills (5th has unknown customer)');
    const log15 = await migrator.runMigration({
      file: billFile, mapping: billMapping, models,
      createdBy: createdByUserId, dryRun: false,
      phase: 'bills', limit: 0,
      source: billSource, logsDir,
    });
    logger.info(`  [debug] bills stats: ${JSON.stringify(log15.results.bills).slice(0, 800)}`);
    assert('4 bills created',
      log15.results.bills?.created === 4,
      `Got ${log15.results.bills?.created}`);
    assert('1 skipped with customer_not_found reason',
      log15.results.bills?.skipped.some(s => s.reason === 'customer_not_found'));

    logger.info('\nT16: Re-run bill migration → 0 created (idempotent via MIG- billNumber)');
    const log16 = await migrator.runMigration({
      file: billFile, mapping: billMapping, models,
      createdBy: createdByUserId, dryRun: false,
      phase: 'bills', limit: 0,
      source: billSource, logsDir,
    });
    assert('Re-run created 0 bills', log16.results.bills?.created === 0);
    assert('Re-run skipped 4 with already_migrated reason',
      log16.results.bills?.skipped.filter(s => s.reason === 'already_migrated').length === 4);

    logger.info('\nT17: Bill issueDate matches Excel date (not now())');
    const bill1 = await Bill.findOne({ billNumber: 'MIG-INV-MIG-001' }).lean();
    assert('Bill found by MIG- prefix', bill1 != null);
    const issueYear = new Date(bill1.issueDate).getFullYear();
    assert('issueDate preserved from Excel (year 2024)',
      issueYear === 2024,
      `Got year ${issueYear}`);

    logger.info('\nT18: Bill is PAID + FINALIZED (historical)');
    assert('Bill status = FINALIZED', bill1.status === 'FINALIZED');
    assert('Bill paymentStatus derived as PAID',
      bill1.paymentStatus === 'PAID',
      `Got ${bill1.paymentStatus}`);
    assert('Bill amountPaid = grandTotal',
      bill1.amountPaid === bill1.grandTotal);

    logger.info('\nT19: Bills tagged with migrationMeta');
    assert('Bill migrationMeta.source set',
      bill1.migrationMeta?.source === billSource);

    // ═══════════════════════════════════════════════
    // Phase + limit + log (5 tests)
    // ═══════════════════════════════════════════════
    logger.info('\n--- Phase filter + limit + log file ---');

    logger.info('\nT20: --phase bills runs only that phase');
    const log20 = await migrator.runMigration({
      file: billFile, mapping: billMapping, models,
      createdBy: createdByUserId, dryRun: true,
      phase: 'bills', limit: 0,
      source: `${SOURCE_PREFIX}t20`, logsDir,
    });
    assert('customers phase NOT in results',
      !log20.results.customers && log20.results.bills);

    logger.info('\nT21: --limit 2 → only first 2 rows processed');
    const customerSource21 = `${SOURCE_PREFIX}t21`;
    const log21 = await migrator.runMigration({
      file: custFile, mapping: custMapping, models,
      createdBy: createdByUserId, dryRun: true,
      phase: 'customers', limit: 2,
      source: customerSource21, logsDir,
    });
    assert('Total rows in stats = 2', log21.results.customers?.total === 2,
      `Got ${log21.results.customers?.total}`);

    logger.info('\nT22: dry-run → no DB writes');
    const beforeCount = await Customer.countDocuments({
      'migrationMeta.source': customerSource21,
    });
    assert('No new customers from dry-run', beforeCount === 0);

    logger.info('\nT23: Migration log file written with valid JSON');
    assert('log.logFile path returned', typeof log9.logFile === 'string');
    assert('log file exists', fs.existsSync(log9.logFile));
    const logJson = JSON.parse(fs.readFileSync(log9.logFile, 'utf8'));
    assert('log JSON has results + summary',
      logJson.results && logJson.summary &&
      typeof logJson.summary.totalCreated === 'number');

    logger.info('\nT24: Per-row error does not halt batch');
    // Construct a customer row with valid phone but malformed data that
    // triggers a Customer.create validation error mid-batch. Test that
    // the OTHER valid row still gets created.
    const errorRows = [
      ['Name', 'Phone'],
      ['Alice Good', '9111222333'],
      // Massive customerName → exceeds maxlength 100 → save error
      [String('X').repeat(500), '9211222333'],
      ['Charlie Good', '9311222333'],
    ];
    const errorFile = synthesize('Customers', errorRows, 'errors');
    const errorMapping = {
      customers: {
        sheetName: 'Customers',
        columns: { customerName: 'Name', phone: 'Phone' },
      },
    };
    const log24Source = `${SOURCE_PREFIX}t24`;
    const log24 = await migrator.runMigration({
      file: errorFile, mapping: errorMapping, models,
      createdBy: createdByUserId, dryRun: false,
      phase: 'customers', limit: 0,
      source: log24Source, logsDir,
    });
    // 2 valid + 1 invalid → 2 created + 1 error (batch did NOT halt)
    assert('Batch did not halt — 2 valid rows created',
      log24.results.customers?.created === 2,
      `Got ${log24.results.customers?.created}`);
    assert('1 error captured in errors[]',
      log24.results.customers?.errors.length === 1,
      `Got ${log24.results.customers?.errors.length}`);

    logger.info('\nT25: parseArgs handles --force flag');
    const args25 = migrator.parseArgs(['node', 's.js', '--file', 'x.xlsx', '--force']);
    assert('Force flag captured', args25.force === true);

    // ─── Cleanup ───
    logger.info('\nCleanup');
    await cleanup();
    logger.info('  Test entities + files + logs deleted');

    await mongoose.disconnect();

    logger.info('\n═══════════════════════════════════════');
    logger.info(`📊 Excel Migration (Section D): ${pass}/${pass + fail} passed`);
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
