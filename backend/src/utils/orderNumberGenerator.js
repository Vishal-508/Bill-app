const mongoose = require('mongoose');

/**
 * Generate sequential order number based on year.
 * Format: ORD-YYYY-NNN (e.g., ORD-2026-001, ORD-2026-002, ...)
 *
 * Uses mongoose.model() to fetch Order at call time, avoiding circular
 * dependency at module load time.
 *
 * Concurrency note: For very high-throughput systems, this could have
 * race conditions. For typical MDF business (~50-100 orders/day max),
 * this approach is fine. Future: switch to atomic counter collection
 * if needed.
 */
exports.generateOrderNumber = async () => {
  const Order = mongoose.model('Order');  // Lookup at call time

  const now = new Date();
  const year = now.getFullYear();
  const prefix = `ORD-${year}-`;

  const lastOrder = await Order.findOne({
    orderNumber: { $regex: `^${prefix}` },
  })
    .sort({ orderNumber: -1 })
    .select('orderNumber')
    .lean();

  let sequence = 1;
  if (lastOrder) {
    const match = lastOrder.orderNumber.match(/(\d+)$/);
    if (match) {
      sequence = parseInt(match[1], 10) + 1;
    }
  }

  const sequenceStr = sequence < 1000 ? String(sequence).padStart(3, '0') : String(sequence);

  return `${prefix}${sequenceStr}`;
};

/**
 * Compute financial year from a date.
 * Indian FY runs April 1 to March 31.
 * Format: "2025-26" (means April 2025 - March 2026)
 *
 * Pure function — no DB dependency, safe to require anywhere.
 */
exports.getFinancialYear = (date = new Date()) => {
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
