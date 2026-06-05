/**
 * generateSampleTemplates.js (Prompt 9 Section E)
 *
 * Idempotent generator that writes two reference Excel files to data/:
 *   - sample-customers.xlsx
 *   - sample-bills.xlsx
 *
 * These templates show users the column layout expected by
 * scripts/migrateExcel.js MAPPING. Overwrites existing files each run.
 *
 * Run: npm run generate:samples
 */

const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');

const DATA_DIR = path.join(__dirname, '..', 'data');

// Realistic but clearly fictional MDF-business data. All phone numbers,
// emails, and GSTINs are contrived — DO NOT use real customer data here.
const CUSTOMERS = [
  ['Customer Name', 'Company', 'Phone', 'Email', 'GSTIN', 'Address', 'City', 'State', 'Pincode'],
  ['Rajesh Kumar', 'Kumar Wood Works', '9876543210', 'rajesh@kumar.example', '23ABCDE0001F1Z5', '12 MG Road', 'Indore', 'Madhya Pradesh', '452001'],
  ['Sunita Sharma', 'Sharma Interiors', '9876543211', 'sunita@sharma.example', '23ABCDE0002G1Z6', '45 Arera Hills', 'Bhopal', 'Madhya Pradesh', '462001'],
  ['Mohammed Khan', '', '9876543212', 'mohd.khan@example.com', '', 'Shop 7, Civil Lines', 'Jaipur', 'Rajasthan', '302001'],
  ['Priya Patel', 'Patel Builders', '9876543213', 'priya@patelbuilders.example', '23ABCDE0004H1Z7', 'Plot 89, Vijay Nagar', 'Indore', 'Madhya Pradesh', '452010'],
  ['Amit Verma', '', '9876543214', '', '', 'House 22, Hoshangabad Rd', 'Bhopal', 'Madhya Pradesh', '462026'],
];

const BILLS = [
  ['Invoice No', 'Date', 'Customer Phone', 'Product Description', 'Pieces', 'Rate', 'Grand Total', 'Bill Type'],
  ['INV-2024-001', new Date('2024-04-10'), '9876543210', 'MDF 18mm 8x4 Interior', 50, 600, 30000, 'GST'],
  ['INV-2024-002', new Date('2024-04-15'), '9876543211', 'MDF 12mm 8x4 Exterior', 25, 400, 10000, 'GST'],
  ['INV-2024-003', new Date('2024-05-20'), '9876543212', 'MDF 6mm 6x3 Pre-cut', 100, 250, 25000, 'NON_GST'],
  ['INV-2024-004', new Date('2024-06-01'), '9876543213', 'MDF 25mm 8x4 HDHMR', 10, 1200, 12000, 'GST'],
  ['INV-2024-005', new Date('2024-06-15'), '9876543214', 'MDF 9mm 6x3 Prelam', 30, 300, 9000, 'NON_GST'],
];

function writeSheet(filePath, sheetName, rows) {
  const wb = xlsx.utils.book_new();
  const ws = xlsx.utils.aoa_to_sheet(rows, { cellDates: true });
  // Set column widths for readability when opened in Excel
  ws['!cols'] = rows[0].map(() => ({ wch: 22 }));
  xlsx.utils.book_append_sheet(wb, ws, sheetName);
  xlsx.writeFile(wb, filePath);
}

function main() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  const customersPath = path.join(DATA_DIR, 'sample-customers.xlsx');
  const billsPath = path.join(DATA_DIR, 'sample-bills.xlsx');

  writeSheet(customersPath, 'Customers', CUSTOMERS);
  console.log(`✅ Wrote ${customersPath} (${CUSTOMERS.length - 1} sample customers)`);

  writeSheet(billsPath, 'Bills', BILLS);
  console.log(`✅ Wrote ${billsPath} (${BILLS.length - 1} sample bills)`);

  console.log('\nNext steps:');
  console.log('  1. Open these in Excel/LibreOffice to see the expected layout');
  console.log('  2. Copy your real .xlsm files into backend/data/');
  console.log('  3. Run: node scripts/inspectExcel.js data/<your-file>.xlsm');
  console.log('  4. Follow docs/MIGRATION_GUIDE.md from there');
}

// Test-only exports — let the smoke test reuse the constants
exports.CUSTOMERS = CUSTOMERS;
exports.BILLS = BILLS;
exports.DATA_DIR = DATA_DIR;
exports.writeSheet = writeSheet;

if (require.main === module) {
  main();
}
