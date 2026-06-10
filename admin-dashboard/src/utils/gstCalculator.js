/**
 * Pure GST + order-total calculators.
 *
 * IMPORTANT: backend's POST /api/orders requires CLIENT-COMPUTED totals
 * (subtotal, taxable, CGST/SGST/IGST, grand total). Server does NOT
 * recompute — wrong math from here persists as-is. Test these helpers
 * carefully and never inline the formulas at call sites.
 *
 * Rounding policy: every monetary value is rounded to 2 decimals via
 * `round2`. CGST and SGST split a half-rupee tail predictably — if
 * `totalGst = 100.005`, both halves round to 50.00 each (totaling 100.00)
 * rather than 50.01 + 50.00 = 100.01.
 */

// Madhya Pradesh (Indore) — business establishment state. If a customer's
// billing-address stateCode matches this, GST is intra-state (CGST+SGST);
// otherwise inter-state (IGST). Configurable via env later if the
// business relocates.
export const BUSINESS_STATE_CODE = '23';

function round2(n) {
  // toFixed-rounding has float quirks; this avoids 1.005 → 1.00 issues
  return Math.round(((+n) + Number.EPSILON) * 100) / 100;
}

/**
 * Line total for a single item.
 *   gross = quantity × pricePerUnit
 *   discount: either a percentage of gross OR an absolute amount
 *   returns gross − discount, floored at 0
 *
 * Input is forgiving — non-numeric inputs coerce to 0 so a half-built
 * row in the form doesn't NaN-poison the running total.
 */
export function calculateLineTotal({ quantity, pricePerUnit, discountValue, discountMode }) {
  const q = +quantity || 0;
  const r = +pricePerUnit || 0;
  const dv = +discountValue || 0;
  const gross = q * r;
  const discountAmt = discountMode === 'percent'
    ? (gross * dv) / 100
    : dv;
  return round2(Math.max(0, gross - discountAmt));
}

/**
 * GST split for an already-discounted line total.
 *   intra-state (customer in business state): CGST + SGST 50/50
 *   inter-state: IGST gets the full amount
 *
 * Returns { cgst, sgst, igst, total }. Always exactly 4 fields,
 * non-applicable ones are 0 (not undefined) so callers can sum
 * defensively.
 */
export function calculateGST(taxableAmount, gstRatePct, customerStateCode) {
  const taxable = +taxableAmount || 0;
  const rate = +gstRatePct || 0;
  const totalGst = round2((taxable * rate) / 100);
  const isIntraState = String(customerStateCode || '').padStart(2, '0')
                       === BUSINESS_STATE_CODE;
  if (isIntraState) {
    const half = round2(totalGst / 2);
    // Adjust for floating-point asymmetry — second half absorbs any
    // sub-paisa drift so cgst + sgst === totalGst exactly.
    return { cgst: half, sgst: round2(totalGst - half), igst: 0, total: totalGst };
  }
  return { cgst: 0, sgst: 0, igst: totalGst, total: totalGst };
}

/**
 * Roll up the entire order. Returns every field the backend wants
 * back from POST /api/orders, ready to merge into the submit payload.
 *
 *   items:              array of { quantity, pricePerUnit, discountValue, discountMode }
 *   orderDiscount:      number or empty
 *   orderDiscountMode:  'percent' | 'amount'
 *   gstRatePct:         number (default 18)
 *   customerStateCode:  2-digit string from billing address
 *   roundOff:           boolean — if true, grand total rounds to nearest rupee
 *
 * Output (every value rounded to 2 decimals):
 *   {
 *     subtotal,          // sum of line totals (already discounted)
 *     itemDiscountTotal, // sum of per-item discounts applied
 *     orderDiscountAmt,  // absolute amount from the order-level discount
 *     taxableAmount,     // subtotal − orderDiscountAmt
 *     gstRatePct,
 *     isIntraState,
 *     cgst, sgst, igst, totalGst,
 *     roundOffAdjustment, // +/− amount applied to reach the round figure
 *     grandTotal,        // taxable + totalGst + roundOffAdjustment
 *   }
 */
export function calculateOrderTotals({
  items = [],
  orderDiscount = 0,
  orderDiscountMode = 'amount',
  gstRatePct = 18,
  customerStateCode,
  roundOff = false,
}) {
  let subtotal = 0;
  let itemDiscountTotal = 0;

  for (const it of items) {
    const gross = (+it.quantity || 0) * (+it.pricePerUnit || 0);
    const lineTotal = calculateLineTotal(it);
    subtotal += lineTotal;
    itemDiscountTotal += round2(gross - lineTotal);
  }
  subtotal = round2(subtotal);
  itemDiscountTotal = round2(itemDiscountTotal);

  const orderDiscountAmt = orderDiscountMode === 'percent'
    ? round2((subtotal * (+orderDiscount || 0)) / 100)
    : round2(+orderDiscount || 0);
  const taxableAmount = round2(Math.max(0, subtotal - orderDiscountAmt));

  const gst = calculateGST(taxableAmount, gstRatePct, customerStateCode);

  let grandTotal = round2(taxableAmount + gst.total);
  let roundOffAdjustment = 0;
  if (roundOff) {
    const rounded = Math.round(grandTotal);
    roundOffAdjustment = round2(rounded - grandTotal);
    grandTotal = rounded;
  }

  return {
    subtotal,
    itemDiscountTotal,
    orderDiscountAmt,
    taxableAmount,
    gstRatePct: +gstRatePct || 0,
    isIntraState: gst.igst === 0 && (gst.cgst > 0 || gst.sgst > 0 || taxableAmount === 0),
    cgst: gst.cgst,
    sgst: gst.sgst,
    igst: gst.igst,
    totalGst: gst.total,
    roundOffAdjustment,
    grandTotal,
  };
}

// Exposed for tests
export const _internals = { round2 };
