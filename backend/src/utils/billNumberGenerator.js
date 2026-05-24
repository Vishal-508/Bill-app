const mongoose = require('mongoose');

/**
 * Generate sequential invoice number based on financial year.
 * Format: INV-YYYY-NNN (e.g., INV-2026-001)
 * Year resets in April (Indian Financial Year, configurable).
 * Separate sequence from Order numbers.
 */
exports.generateBillNumber = async () => {
  const Bill = mongoose.model('Bill');
  const SystemSetting = mongoose.model('SystemSetting');

  const prefix = await SystemSetting.getValue('INVOICE_PREFIX', 'INV');

  const now = new Date();
  const fyStartMonth = await SystemSetting.getValue('FINANCIAL_YEAR_START_MONTH', 4);

  let fyYear;
  if (now.getMonth() + 1 >= fyStartMonth) {
    fyYear = now.getFullYear();
  } else {
    fyYear = now.getFullYear() - 1;
  }

  const fullPrefix = `${prefix}-${fyYear}-`;

  const lastBill = await Bill.findOne({
    billNumber: { $regex: `^${fullPrefix}` },
  })
    .sort({ billNumber: -1 })
    .select('billNumber')
    .lean();

  let sequence = 1;
  if (lastBill) {
    const match = lastBill.billNumber.match(/(\d+)$/);
    if (match) {
      sequence = parseInt(match[1], 10) + 1;
    }
  }

  const sequenceStr = sequence < 1000 ? String(sequence).padStart(3, '0') : String(sequence);
  return `${fullPrefix}${sequenceStr}`;
};

/**
 * Compute fiscal year string for India (April-March).
 * Examples: June 2026 -> "2026-27", February 2026 -> "2025-26"
 */
exports.getFiscalYear = (date = new Date()) => {
  const year = date.getFullYear();
  const month = date.getMonth();

  let startYear, endYear;
  if (month >= 3) {
    startYear = year;
    endYear = year + 1;
  } else {
    startYear = year - 1;
    endYear = year;
  }

  return `${startYear}-${String(endYear).slice(-2)}`;
};
