const mongoose = require('mongoose');
const { getFinancialYear } = require('./orderNumberGenerator');

/**
 * Generate a purchase order number tied to the Indian fiscal year.
 * Format: PO-YY-YY-NNNNN (e.g., PO-25-26-00001 for FY 2025-26)
 *
 * Lookup at call time via mongoose.model('Purchase') to avoid circular
 * import (same pattern as orderNumberGenerator).
 *
 * Concurrency: For typical MDF business (~10-50 POs/month), serialization
 * via Mongoose findOne+sort is sufficient. Future: atomic counter collection
 * if PO volume spikes.
 */
exports.generatePurchaseNumber = async () => {
  const Purchase = mongoose.model('Purchase');

  const fy = getFinancialYear(); // e.g. "2025-26"
  const prefix = `PO-${fy}-`;

  const lastPO = await Purchase.findOne({
    purchaseNo: { $regex: `^${prefix}` },
  })
    .sort({ purchaseNo: -1 })
    .select('purchaseNo')
    .lean();

  let sequence = 1;
  if (lastPO) {
    const match = lastPO.purchaseNo.match(/(\d+)$/);
    if (match) {
      sequence = parseInt(match[1], 10) + 1;
    }
  }

  const sequenceStr = String(sequence).padStart(5, '0');
  return `${prefix}${sequenceStr}`;
};
