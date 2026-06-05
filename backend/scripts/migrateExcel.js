/**
 * migrateExcel.js (Prompt 9 Section D)
 *
 * Configurable Excel → MongoDB migration. Idempotent, dry-run capable,
 * phase-separable. Workflow:
 *   1. Run scripts/inspectExcel.js to see your sheet/column structure
 *   2. Update MAPPING below to match your column headers
 *   3. Test with `npm run migrate:excel -- --file <file.xlsx> --dry-run --limit 10`
 *   4. Production run: `npm run migrate:excel -- --file <file.xlsx> --force`
 *
 * Module exports `runMigration()` + phase functions so the smoke test can
 * exercise each step directly with synthesized data.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const xlsx = require('xlsx');
const mongoose = require('mongoose');

const {
  normalizePhone, normalizeGstin, normalizeDate, normalizeMoney,
  normalizeAddress, inferBillType, findPlaceholders, PLACEHOLDER_PREFIX,
} = require('./migrationHelpers');

// ─── DEFAULT MAPPING — customize before running ───
// Replace each `_REPLACE_WITH_...` placeholder with your actual column
// header (case-sensitive) after running inspectExcel.js.
exports.DEFAULT_MAPPING = {
  customers: {
    sheetName: '_REPLACE_WITH_YOUR_SHEET_NAME_',
    columns: {
      companyName: '_REPLACE_WITH_COLUMN_NAME_',
      customerName: '_REPLACE_WITH_COLUMN_NAME_',
      phone: '_REPLACE_WITH_COLUMN_NAME_',
      email: '_REPLACE_WITH_COLUMN_NAME_',
      gstin: '_REPLACE_WITH_COLUMN_NAME_',
      addressLine1: '_REPLACE_WITH_COLUMN_NAME_',
      addressLine2: '_REPLACE_WITH_COLUMN_NAME_',
      city: '_REPLACE_WITH_COLUMN_NAME_',
      state: '_REPLACE_WITH_COLUMN_NAME_',
      pincode: '_REPLACE_WITH_COLUMN_NAME_',
    },
  },
  products: {
    sheetName: null, // null = skip phase
    columns: {},
  },
  bills: {
    sheetName: '_REPLACE_WITH_YOUR_SHEET_NAME_',
    columns: {
      invoiceNo: '_REPLACE_WITH_COLUMN_NAME_',
      invoiceDate: '_REPLACE_WITH_COLUMN_NAME_',
      customerPhone: '_REPLACE_WITH_COLUMN_NAME_',
      productDescription: '_REPLACE_WITH_COLUMN_NAME_',
      pieces: '_REPLACE_WITH_COLUMN_NAME_',
      ratePerSqFt: '_REPLACE_WITH_COLUMN_NAME_',
      grandTotal: '_REPLACE_WITH_COLUMN_NAME_',
      billType: '_REPLACE_WITH_COLUMN_NAME_',
    },
  },
};

// ─── CLI arg parsing ───

exports.parseArgs = (argv) => {
  const out = {
    file: null,
    phase: 'all',
    dryRun: false,
    limit: 0,
    force: false,
    help: false,
  };
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--file') { out.file = args[++i]; }
    else if (a === '--phase') { out.phase = args[++i]; }
    else if (a === '--dry-run') { out.dryRun = true; }
    else if (a === '--limit') { out.limit = parseInt(args[++i], 10) || 0; }
    else if (a === '--force') { out.force = true; }
    else if (a === '--help' || a === '-h') { out.help = true; }
  }
  return out;
};

exports.HELP_TEXT = `
Usage: node scripts/migrateExcel.js --file <path> [options]

Options:
  --file <path>            Required. Path to .xlsx/.xlsm file.
  --phase <p>              customers | products | bills | all (default: all)
  --dry-run                Parse + validate without DB writes
  --limit <n>              Process only first N rows per phase (0 = all)
  --force                  Skip the confirmation prompt
  --help, -h               Print this help

Workflow:
  1. Run scripts/inspectExcel.js to see your Excel structure
  2. Update MAPPING in scripts/migrateExcel.js with your column names
  3. Test with: npm run migrate:excel -- --file <file> --dry-run --limit 10
  4. Production run: npm run migrate:excel -- --file <file> --force
`;

// ─── Sheet reader ───

function readSheet(filePath, sheetName) {
  const wb = xlsx.readFile(filePath, { cellDates: true, cellNF: false });
  if (!wb.SheetNames.includes(sheetName)) {
    throw new Error(`Sheet '${sheetName}' not found in ${filePath}. Available: ${wb.SheetNames.join(', ')}`);
  }
  const sheet = wb.Sheets[sheetName];
  return xlsx.utils.sheet_to_json(sheet, { defval: null, raw: true });
}

function cellValue(row, columnHeader) {
  if (!columnHeader) return null;
  // If header contains placeholder text, treat as unmapped
  if (columnHeader.includes(PLACEHOLDER_PREFIX)) return null;
  return row[columnHeader] ?? null;
}

// ─── Phase: customers ───

exports.migrateCustomers = async (rows, mapping, options) => {
  const { dryRun, source, createdBy, Customer } = options;
  const stats = { phase: 'customers', total: rows.length, created: 0, updated: 0, skipped: [], errors: [] };
  const cols = mapping.columns;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const sourceRow = i + 2; // +1 for header row, +1 for 1-based
    try {
      const rawPhone = cellValue(row, cols.phone);
      const phone = normalizePhone(rawPhone);
      if (!phone) {
        stats.skipped.push({ row: sourceRow, reason: 'invalid_phone', value: rawPhone });
        continue;
      }

      const gstin = normalizeGstin(cellValue(row, cols.gstin));
      const address = normalizeAddress({
        line1: cellValue(row, cols.addressLine1),
        line2: cellValue(row, cols.addressLine2),
        city: cellValue(row, cols.city),
        state: cellValue(row, cols.state),
        pincode: cellValue(row, cols.pincode),
      });

      const incoming = {
        customerName: String(cellValue(row, cols.customerName) || '').trim(),
        companyName: String(cellValue(row, cols.companyName) || '').trim() || undefined,
        phone,
        email: String(cellValue(row, cols.email) || '').trim() || undefined,
        gstin: gstin || undefined,
        billingAddress: Object.keys(address).length > 0 ? address : undefined,
      };

      // customerName fallback to companyName if missing
      if (!incoming.customerName) {
        incoming.customerName = incoming.companyName || `Migrated #${sourceRow}`;
      }

      if (dryRun) {
        // Just count what would happen
        const existing = await Customer.findOne({ phone }).select('_id').lean();
        if (existing) stats.updated++;
        else stats.created++;
        continue;
      }

      const existing = await Customer.findOne({ phone });
      if (existing) {
        // Update only empty/missing fields — DON'T overwrite existing data
        let changed = false;
        for (const [k, v] of Object.entries(incoming)) {
          if (k === 'phone') continue;
          if (v == null || v === '') continue;
          if (k === 'billingAddress') {
            existing.billingAddress = existing.billingAddress || {};
            for (const [ak, av] of Object.entries(v)) {
              if (!existing.billingAddress[ak] && av) {
                existing.billingAddress[ak] = av;
                changed = true;
              }
            }
            continue;
          }
          if (!existing[k]) {
            existing[k] = v;
            changed = true;
          }
        }
        if (changed) {
          existing.migrationMeta = { source, sourceRow, importedAt: new Date() };
          existing.updatedBy = createdBy;
          await existing.save();
        }
        stats.updated++;
      } else {
        await Customer.create({
          ...incoming,
          createdBy,
          migrationMeta: { source, sourceRow, importedAt: new Date() },
        });
        stats.created++;
      }
    } catch (err) {
      stats.errors.push({ row: sourceRow, message: err.message });
    }
  }
  return stats;
};

// ─── Phase: bills ───

exports.migrateBills = async (rows, mapping, options) => {
  const { dryRun, source, createdBy, Customer, Order, Bill, SystemSetting } = options;
  const stats = { phase: 'bills', total: rows.length, created: 0, updated: 0, skipped: [], errors: [] };
  const cols = mapping.columns;

  // Snapshot business info once
  const businessName = await SystemSetting.getValue('BUSINESS_NAME', 'Shree Gopal MDF');
  const businessGstin = await SystemSetting.getValue('BUSINESS_GSTIN', '');
  const businessState = await SystemSetting.getValue('BUSINESS_STATE', 'Madhya Pradesh');

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const sourceRow = i + 2;
    try {
      const invoiceNo = String(cellValue(row, cols.invoiceNo) || '').trim();
      if (!invoiceNo) {
        stats.skipped.push({ row: sourceRow, reason: 'no_invoice_no' });
        continue;
      }

      const billNumber = `MIG-${invoiceNo}`;
      const phone = normalizePhone(cellValue(row, cols.customerPhone));
      if (!phone) {
        stats.skipped.push({ row: sourceRow, reason: 'invalid_phone', value: cellValue(row, cols.customerPhone) });
        continue;
      }

      const customer = await Customer.findOne({ phone }).lean();
      if (!customer) {
        stats.skipped.push({ row: sourceRow, reason: 'customer_not_found', phone });
        continue;
      }

      // Idempotency: bail if a bill with this MIG-billNumber already exists
      const existingBill = await Bill.findOne({ billNumber }).select('_id').lean();
      if (existingBill) {
        stats.skipped.push({ row: sourceRow, reason: 'already_migrated', billNumber });
        continue;
      }

      const issueDate = normalizeDate(cellValue(row, cols.invoiceDate)) || new Date();
      const grandTotal = normalizeMoney(cellValue(row, cols.grandTotal)) || 0;
      const pieces = normalizeMoney(cellValue(row, cols.pieces)) || 1;
      const ratePerSqFt = normalizeMoney(cellValue(row, cols.ratePerSqFt)) || 0;
      const productDesc = String(cellValue(row, cols.productDescription) || 'Migrated item').trim();
      const billType = inferBillType(customer.gstin, cellValue(row, cols.billType));

      if (dryRun) {
        stats.created++;
        continue;
      }

      // Order — minimal historical record
      const order = await Order.create({
        orderNumber: `MIG-ORD-${invoiceNo}`,
        fiscalYear: undefined, // pre-save will fill
        customer: customer._id,
        items: [{
          itemType: 'CUSTOM_CUT',
          product: new mongoose.Types.ObjectId(), // synthetic — historical row, product no longer relevant
          quantity: pieces,
          pricePerUnit: ratePerSqFt || 0,
          lineSubtotal: grandTotal,
          notes: productDesc,
        }],
        subtotal: grandTotal,
        taxableAmount: grandTotal,
        gstRatePct: 0,
        cgst: 0, sgst: 0, igst: 0, totalGst: 0,
        totalAmount: grandTotal,
        status: 'COMPLETED',
        paymentStatus: 'PAID',
        amountPaid: grandTotal,
        orderDate: issueDate,
        customerNotes: `Migrated from Excel row ${sourceRow}`,
        createdBy,
        migrationMeta: { source, sourceRow, importedAt: new Date() },
      });

      // Bill — historical record
      await Bill.create({
        billNumber,
        order: order._id,
        orderNumber: order.orderNumber,
        customer: customer._id,
        customerInfo: {
          customerName: customer.customerName,
          companyName: customer.companyName,
          phone: customer.phone,
          email: customer.email,
          gstin: customer.gstin,
          billingAddress: customer.billingAddress,
        },
        businessInfo: {
          name: businessName,
          gstin: businessGstin,
          state: businessState,
        },
        items: [{
          serialNo: 1,
          description: productDesc,
          quantity: pieces,
          pricePerUnit: ratePerSqFt,
          materialCost: grandTotal,
          lineSubtotal: grandTotal,
        }],
        hasGst: billType === 'GST',
        subtotal: grandTotal,
        grandTotal,
        amountPaid: grandTotal, // historical: assume paid
        issueDate,
        status: 'FINALIZED',
        finalizedAt: issueDate,
        createdBy,
        migrationMeta: { source, sourceRow, importedAt: new Date() },
      });

      stats.created++;
    } catch (err) {
      stats.errors.push({ row: sourceRow, message: err.message });
    }
  }
  return stats;
};

// ─── Phase: products ───
exports.migrateProducts = async (/* rows, mapping, options */) => {
  // Optional phase — only runs when explicitly mapped. Stub returns empty stats.
  return { phase: 'products', total: 0, created: 0, updated: 0, skipped: [], errors: [] };
};

// ─── Confirmation prompt ───

exports.confirm = (question) => new Promise((resolve) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question(question, (answer) => {
    rl.close();
    resolve(answer.trim().toLowerCase());
  });
});

// ─── Log writer ───

function timestampStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-` +
         `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

exports.writeLog = (logsDir, logData) => {
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
  const fileName = `migration-log-${timestampStr()}.json`;
  const filePath = path.join(logsDir, fileName);
  fs.writeFileSync(filePath, JSON.stringify(logData, null, 2));
  return filePath;
};

// ─── Top-level orchestration ───

/**
 * Run the migration with the given options. Used by both the CLI entry
 * and the smoke test. Returns the complete log object.
 *
 * Required options:
 *   file, mapping, models: { Customer, Order, Bill, SystemSetting },
 *   createdBy, dryRun, phase, limit, source, logsDir
 */
exports.runMigration = async (options) => {
  const {
    file, mapping, models, createdBy,
    dryRun = false, phase = 'all', limit = 0, source,
    logsDir,
  } = options;

  const startedAt = new Date();
  const log = {
    startedAt: startedAt.toISOString(),
    completedAt: null,
    file,
    phase,
    dryRun,
    source,
    results: {},
    summary: { totalRows: 0, totalCreated: 0, totalUpdated: 0, totalSkipped: 0, totalErrors: 0 },
  };

  const phases = phase === 'all' ? ['customers', 'products', 'bills'] : [phase];

  for (const ph of phases) {
    const cfg = mapping[ph];
    if (!cfg || !cfg.sheetName) {
      log.results[ph] = { phase: ph, skipped: true, reason: 'no_sheet_name' };
      continue;
    }
    // Placeholder skip in dry-run
    const placeholders = findPlaceholders({ [ph]: cfg });
    if (placeholders.length > 0) {
      log.results[ph] = {
        phase: ph, skipped: true,
        reason: 'placeholders_unresolved',
        placeholders,
      };
      continue;
    }

    let rows;
    try {
      rows = readSheet(file, cfg.sheetName);
    } catch (err) {
      log.results[ph] = { phase: ph, skipped: true, reason: 'read_failure', error: err.message };
      continue;
    }
    if (limit > 0) rows = rows.slice(0, limit);

    const phaseOptions = {
      dryRun, source, createdBy,
      Customer: models.Customer,
      Order: models.Order,
      Bill: models.Bill,
      SystemSetting: models.SystemSetting,
    };

    let stats;
    if (ph === 'customers') stats = await exports.migrateCustomers(rows, cfg, phaseOptions);
    else if (ph === 'bills') stats = await exports.migrateBills(rows, cfg, phaseOptions);
    else if (ph === 'products') stats = await exports.migrateProducts(rows, cfg, phaseOptions);
    else stats = { phase: ph, total: 0, created: 0, updated: 0, skipped: [], errors: [] };

    log.results[ph] = stats;
    log.summary.totalRows += stats.total || 0;
    log.summary.totalCreated += stats.created || 0;
    log.summary.totalUpdated += stats.updated || 0;
    log.summary.totalSkipped += (stats.skipped || []).length;
    log.summary.totalErrors += (stats.errors || []).length;
  }

  log.completedAt = new Date().toISOString();

  if (logsDir) {
    try {
      log.logFile = exports.writeLog(logsDir, log);
    } catch (err) {
      log.logWriteError = err.message;
    }
  }

  return log;
};

// ─── CLI entry ───

async function main() {
  const args = exports.parseArgs(process.argv);
  if (args.help) {
    console.log(exports.HELP_TEXT);
    process.exit(0);
  }
  if (!args.file) {
    console.error('Error: --file is required');
    console.error(exports.HELP_TEXT);
    process.exit(1);
  }

  // Safety check (skipped in dry-run)
  if (!args.dryRun) {
    const placeholders = findPlaceholders(exports.DEFAULT_MAPPING);
    if (placeholders.length > 0) {
      console.error('Error: MAPPING not configured.');
      console.error('Run scripts/inspectExcel.js first, then update MAPPING in');
      console.error('scripts/migrateExcel.js with your actual column names.');
      console.error(`Unresolved placeholders (${placeholders.length}):`);
      for (const p of placeholders) console.error(`  - ${p}`);
      console.error('\nOR run with --dry-run to test without writing.');
      process.exit(1);
    }
  }

  // Confirmation
  if (!args.dryRun && !args.force) {
    const answer = await exports.confirm(
      `About to migrate from ${args.file} in phase '${args.phase}'. Continue? (y/N) `
    );
    if (answer !== 'y' && answer !== 'yes') {
      console.log('Migration cancelled.');
      process.exit(0);
    }
  }

  // DB connect
  try {
    await mongoose.connect(process.env.MONGODB_URI);
  } catch (err) {
    console.error('Fatal: Could not connect to MongoDB —', err.message);
    process.exit(1);
  }

  const models = require('../src/models');
  // Use a synthetic created-by — production should accept a user id arg
  const createdBy = new mongoose.Types.ObjectId();

  const log = await exports.runMigration({
    file: args.file,
    mapping: exports.DEFAULT_MAPPING,
    models,
    createdBy,
    dryRun: args.dryRun,
    phase: args.phase,
    limit: args.limit,
    source: path.basename(args.file),
    logsDir: path.join(__dirname, '..', 'data'),
  });

  console.log('');
  console.log(`✅ Migration ${args.dryRun ? 'DRY-RUN ' : ''}complete.`);
  if (log.logFile) console.log(`   Log: ${log.logFile}`);
  for (const [ph, stats] of Object.entries(log.results)) {
    if (stats.skipped) {
      console.log(`   ${ph}: skipped (${stats.reason})`);
    } else {
      console.log(
        `   ${ph}: ${stats.created} created, ${stats.updated} updated, ` +
        `${(stats.skipped || []).length} skipped, ${(stats.errors || []).length} errors`
      );
    }
  }

  await mongoose.disconnect();
  process.exit(0);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal:', err.message);
    process.exit(1);
  });
}
