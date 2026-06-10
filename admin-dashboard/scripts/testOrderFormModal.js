// Section C smoke — gstCalculator pure helpers + orderSchema validation
// + component file structure + wiring checks.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, '..', 'src');

const {
  BUSINESS_STATE_CODE, calculateLineTotal, calculateGST, calculateOrderTotals,
} = await import('../src/utils/gstCalculator.js');
const { orderSchema, orderItemSchema } = await import('../src/utils/validators.js');

let pass = 0, fail = 0;
const failures = [];
function assert(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); failures.push(name); }
}
function read(rel) { return fs.readFileSync(path.join(SRC, rel), 'utf8'); }
function exists(rel) { return fs.existsSync(path.join(SRC, rel)); }

console.log('\n═══ Section C — Order Form Modal Smoke ═══');

// ═══════════════════════════════════════════════
// File structure
// ═══════════════════════════════════════════════
console.log('\n--- File structure ---');
const FILES = [
  'pages/orders/OrderFormModal.jsx',
  'pages/orders/OrderItemsBuilder.jsx',
  'components/forms/ProductPicker.jsx',
  'utils/gstCalculator.js',
];
for (const f of FILES) assert(`${f} exists`, exists(f));
assert('orderSchema present in validators.js',
  read('utils/validators.js').includes('export const orderSchema'));
assert('orderItemSchema present in validators.js',
  read('utils/validators.js').includes('export const orderItemSchema'));

// ═══════════════════════════════════════════════
// gstCalculator — pure functions
// ═══════════════════════════════════════════════
console.log('\n--- gstCalculator helpers ---');
assert('BUSINESS_STATE_CODE is "23" (MP)', BUSINESS_STATE_CODE === '23');

// calculateLineTotal
assert('Line total with no discount: 5 × 100 = 500',
  calculateLineTotal({ quantity: 5, pricePerUnit: 100, discountValue: 0, discountMode: 'percent' }) === 500);
assert('Line total with 10% discount: 5 × 100 − 10% = 450',
  calculateLineTotal({ quantity: 5, pricePerUnit: 100, discountValue: 10, discountMode: 'percent' }) === 450);
assert('Line total with ₹50 amount discount: 5 × 100 − 50 = 450',
  calculateLineTotal({ quantity: 5, pricePerUnit: 100, discountValue: 50, discountMode: 'amount' }) === 450);
assert('Line total with discount > gross: floored at 0',
  calculateLineTotal({ quantity: 1, pricePerUnit: 100, discountValue: 200, discountMode: 'amount' }) === 0);
assert('Line total with non-numeric inputs: returns 0 (no NaN)',
  calculateLineTotal({ quantity: '', pricePerUnit: '', discountValue: '', discountMode: 'percent' }) === 0);

// calculateGST
const intra = calculateGST(1000, 18, '23');
assert('Intra-state GST: CGST = SGST = 90, IGST = 0',
  intra.cgst === 90 && intra.sgst === 90 && intra.igst === 0 && intra.total === 180);
const inter = calculateGST(1000, 18, '27');
assert('Inter-state GST: IGST = 180, CGST = SGST = 0',
  inter.igst === 180 && inter.cgst === 0 && inter.sgst === 0 && inter.total === 180);
const zeroGst = calculateGST(1000, 0, '23');
assert('Zero GST rate → all zeros',
  zeroGst.cgst === 0 && zeroGst.sgst === 0 && zeroGst.igst === 0 && zeroGst.total === 0);
// CGST + SGST adjusts so they sum to totalGst exactly even with half-paisa drift
const halfDrift = calculateGST(100, 9.05, '23');
assert('CGST + SGST always sums to totalGst (no drift)',
  halfDrift.cgst + halfDrift.sgst === halfDrift.total,
  `${halfDrift.cgst} + ${halfDrift.sgst} = ${halfDrift.cgst + halfDrift.sgst} vs total ${halfDrift.total}`);
// stateCode padded — '7' should match nothing (not '23')
const padded = calculateGST(1000, 18, '7');
assert('1-digit state code padded to "07" → inter-state vs business "23"',
  padded.igst === 180);

// calculateOrderTotals
const totals = calculateOrderTotals({
  items: [
    { quantity: 5, pricePerUnit: 100, discountValue: 0, discountMode: 'percent' },
    { quantity: 2, pricePerUnit: 250, discountValue: 0, discountMode: 'percent' },
  ],
  orderDiscount: 0, orderDiscountMode: 'amount',
  gstRatePct: 18, customerStateCode: '23',
  roundOff: false,
});
assert('Order totals: subtotal = 500 + 500 = 1000',
  totals.subtotal === 1000);
assert('Order totals: GST on 1000 @ 18% = 180',
  totals.totalGst === 180);
assert('Order totals: grand total = 1180',
  totals.grandTotal === 1180);
assert('Intra-state flag set when customer matches business state',
  totals.isIntraState === true);

const interOrder = calculateOrderTotals({
  items: [{ quantity: 5, pricePerUnit: 100, discountValue: 0, discountMode: 'percent' }],
  gstRatePct: 18, customerStateCode: '27', roundOff: false,
});
assert('Inter-state order: IGST > 0, CGST = 0',
  interOrder.igst === 90 && interOrder.cgst === 0);

const discounted = calculateOrderTotals({
  items: [{ quantity: 5, pricePerUnit: 100, discountValue: 0, discountMode: 'percent' }],
  orderDiscount: 10, orderDiscountMode: 'percent',
  gstRatePct: 18, customerStateCode: '23', roundOff: false,
});
assert('Order discount % applied to subtotal: 500 − 10% = 450 taxable',
  discounted.taxableAmount === 450);
assert('GST on discounted taxable: 450 × 18% = 81',
  discounted.totalGst === 81);

const rounded = calculateOrderTotals({
  items: [{ quantity: 3, pricePerUnit: 99.33, discountValue: 0, discountMode: 'percent' }],
  gstRatePct: 18, customerStateCode: '23', roundOff: true,
});
assert('Round off: grand total is integer',
  Number.isInteger(rounded.grandTotal));
assert('Round off adjustment recorded',
  typeof rounded.roundOffAdjustment === 'number');

// ═══════════════════════════════════════════════
// orderSchema — validation
// ═══════════════════════════════════════════════
console.log('\n--- orderSchema validation ---');

const okItem = {
  product: '507f1f77bcf86cd799439011',
  quantity: 1, pricePerUnit: 100,
  discountMode: 'percent', discountValue: 0,
};
const okOrder = {
  customer: '507f1f77bcf86cd799439011',
  customerStateCode: '23',
  orderDate: '2026-06-08',
  items: [okItem],
  gstRatePct: 18,
  orderDiscountMode: 'amount', orderDiscountValue: 0,
  roundOff: false,
  hasGstBill: true, deliveryMethod: 'PICKUP', paymentMode: 'FULL_UPFRONT',
};
assert('Valid order parses', orderSchema.safeParse(okOrder).success);

const noItems = { ...okOrder, items: [] };
assert('Empty items rejected (min 1)',
  !orderSchema.safeParse(noItems).success);

const badQty = { ...okOrder, items: [{ ...okItem, quantity: 0 }] };
assert('Quantity = 0 rejected (positive int)',
  !orderSchema.safeParse(badQty).success);

const fracQty = { ...okOrder, items: [{ ...okItem, quantity: 1.5 }] };
assert('Fractional quantity rejected (integer-only)',
  !orderSchema.safeParse(fracQty).success);

const negPrice = { ...okOrder, items: [{ ...okItem, pricePerUnit: -10 }] };
assert('Negative pricePerUnit rejected',
  !orderSchema.safeParse(negPrice).success);

const noCustomer = { ...okOrder, customer: '' };
assert('Empty customer rejected',
  !orderSchema.safeParse(noCustomer).success);

const stringQty = { ...okOrder, items: [{ ...okItem, quantity: '5' }] };
const stringQtyResult = orderSchema.safeParse(stringQty);
assert('String quantity coerced via z.coerce.number',
  stringQtyResult.success && stringQtyResult.data.items[0].quantity === 5);

// Discount-reason superRefine
const discountNoReason = {
  ...okOrder, orderDiscountValue: 100, discountReason: '',
};
assert('Order discount > 0 without reason rejected',
  !orderSchema.safeParse(discountNoReason).success);

const discountWithReason = {
  ...okOrder, orderDiscountValue: 100, discountReason: 'Loyalty discount',
};
assert('Order discount > 0 with reason accepted',
  orderSchema.safeParse(discountWithReason).success);

const badPaymentMode = { ...okOrder, paymentMode: 'CHEQUE' };
assert('Invalid paymentMode enum rejected',
  !orderSchema.safeParse(badPaymentMode).success);

const badDeliveryMethod = { ...okOrder, deliveryMethod: 'COURIER' };
assert('Invalid deliveryMethod enum rejected',
  !orderSchema.safeParse(badDeliveryMethod).success);

const multipleItems = { ...okOrder, items: [okItem, okItem, okItem] };
assert('Multiple items accepted',
  orderSchema.safeParse(multipleItems).success);

// ═══════════════════════════════════════════════
// Component structure
// ═══════════════════════════════════════════════
console.log('\n--- OrderFormModal structure ---');
const formSrc = read('pages/orders/OrderFormModal.jsx');
assert('Default-exports OrderFormModal',
  /export default function OrderFormModal/.test(formSrc));
assert('Uses zodResolver + orderSchema',
  formSrc.includes('zodResolver') && formSrc.includes('orderSchema'));
assert('Uses useForm + FormProvider (for nested useFieldArray)',
  formSrc.includes('useForm') && formSrc.includes('FormProvider'));
assert('Imports CustomerPicker + OrderItemsBuilder',
  formSrc.includes('CustomerPicker') && formSrc.includes('OrderItemsBuilder'));
assert('Imports useCreateOrder + useUpdateOrder',
  formSrc.includes('useCreateOrder') && formSrc.includes('useUpdateOrder'));
assert('Uses calculateOrderTotals for live summary',
  formSrc.includes('calculateOrderTotals'));
assert('Captures customerStateCode from picked customer',
  formSrc.includes('customerStateCode'));
assert('Submit payload includes all GST math fields',
  formSrc.includes('subtotal: totals.subtotal') &&
  formSrc.includes('totalGst: totals.totalGst') &&
  formSrc.includes('totalAmount: totals.grandTotal'));
assert('Submit transforms discountMode → discountPct + discountAmount',
  formSrc.includes('discountPct') && formSrc.includes('discountAmount'));
assert('Pre-fills via buildDefaults(order) for edit mode',
  /buildDefaults\(order\)/.test(formSrc));
assert('Confirms before discarding dirty form',
  /isDirty[\s\S]{0,80}window\.confirm/.test(formSrc));
assert('Sticky bottom summary',
  formSrc.includes('sticky bottom-0'));
assert('Renders Intra-state / Inter-state badge on customer card',
  formSrc.includes('Intra-state') && formSrc.includes('Inter-state'));
assert('Defaults itemType to FULL_SHEET in submit payload',
  /itemType:\s*['"]FULL_SHEET['"]/.test(formSrc));

// ═══════════════════════════════════════════════
// OrderItemsBuilder
// ═══════════════════════════════════════════════
console.log('\n--- OrderItemsBuilder ---');
const itemsSrc = read('pages/orders/OrderItemsBuilder.jsx');
assert('useFieldArray for items', itemsSrc.includes('useFieldArray'));
assert('ProductPicker import + render', itemsSrc.includes('ProductPicker'));
assert('Auto-fills pricePerUnit from product.basePrice on first pick',
  /current\?\.pricePerUnit[\s\S]{0,100}setValue\(`items\.\$\{idx\}\.pricePerUnit`/.test(itemsSrc));
assert('Stock-short warning rendered non-blocking',
  /stockShort[\s\S]{0,400}override/.test(itemsSrc));
assert('"Add item" button uses + Plus icon',
  itemsSrc.includes('Plus') && itemsSrc.includes('Add item'));
assert('Live line-total via calculateLineTotal',
  itemsSrc.includes('calculateLineTotal'));

// ═══════════════════════════════════════════════
// ProductPicker (regression on the picker pattern)
// ═══════════════════════════════════════════════
console.log('\n--- ProductPicker ---');
const pickerSrc = read('components/forms/ProductPicker.jsx');
assert('ProductPicker uses Headless UI Combobox',
  pickerSrc.includes("from '@headlessui/react'") && pickerSrc.includes('Combobox'));
assert('ProductPicker fetches via useProductsList with search param',
  pickerSrc.includes('useProductsList') && /search:\s*debounced/.test(pickerSrc));
assert('ProductPicker debounces input (250ms)',
  /useDebounce\(query,\s*250\)/.test(pickerSrc));
assert('ProductPicker onChange passes FULL product object',
  /onChange\?\.\(p\)/.test(pickerSrc));
assert('ProductPicker shows stock badge inline',
  pickerSrc.includes('stockBadge'));
assert('ProductPicker supports excludeIds (no duplicates)',
  /excludeIds\.includes\(p\._id\)/.test(pickerSrc));

// ═══════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════
console.log('\n═══════════════════════════════════════');
console.log(`📊 Section C: ${pass}/${pass + fail} passed`);
if (failures.length > 0) {
  console.log('\nFailures:');
  failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
}
process.exit(fail === 0 ? 0 : 1);
