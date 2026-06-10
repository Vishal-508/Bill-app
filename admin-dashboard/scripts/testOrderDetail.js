// Section D smoke — Order Detail page structure + StatusChangeButton
// gating + tab content wiring.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, '..', 'src');

let pass = 0, fail = 0;
const failures = [];
function assert(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); failures.push(name); }
}
function read(rel) { return fs.readFileSync(path.join(SRC, rel), 'utf8'); }
function exists(rel) { return fs.existsSync(path.join(SRC, rel)); }

console.log('\n═══ Section D — Order Detail Page Smoke ═══');

// ═══════════════════════════════════════════════
// File structure
// ═══════════════════════════════════════════════
console.log('\n--- File structure ---');
const FILES = [
  'pages/orders/OrderDetail.jsx',
  'pages/orders/OrderHeader.jsx',
  'pages/orders/OrderStats.jsx',
  'pages/orders/OrderTabs.jsx',
  'pages/orders/StatusChangeButton.jsx',
  'pages/orders/tabs/ItemsTab.jsx',
  'pages/orders/tabs/BillsTab.jsx',
  'pages/orders/tabs/PaymentsTab.jsx',
  'pages/orders/tabs/TimelineTab.jsx',
];
for (const f of FILES) assert(`${f} exists`, exists(f));

// ═══════════════════════════════════════════════
// OrderDetail wiring
// ═══════════════════════════════════════════════
console.log('\n--- OrderDetail ---');
const detailSrc = read('pages/orders/OrderDetail.jsx');
assert('Default-exports OrderDetail',
  /export default function OrderDetail/.test(detailSrc));
assert('Reads :orderId from useParams',
  detailSrc.includes('useParams') && detailSrc.includes('orderId'));
assert('Uses useOrderDetail hook',
  detailSrc.includes('useOrderDetail'));
assert('Uses useCreateBillFromOrder for Generate Bill action',
  detailSrc.includes('useCreateBillFromOrder'));
assert('Renders OrderHeader + OrderStats + OrderTabs',
  detailSrc.includes('<OrderHeader') &&
  detailSrc.includes('<OrderStats') &&
  detailSrc.includes('<OrderTabs'));
assert('Edit button opens OrderFormModal',
  detailSrc.includes('OrderFormModal') && detailSrc.includes('setEditOpen'));
assert('Edit button disabled when status is non-editable',
  /isEditable\(order\.status\)/.test(detailSrc) &&
  /disabled=\{!editable\}/.test(detailSrc));
assert('Generate Bill button disabled via canGenerateBill',
  detailSrc.includes('canGenerateBill') &&
  /disabled=\{!billable\}/.test(detailSrc));
assert('404 vs network error distinguished',
  /404/.test(detailSrc) && /not found/i.test(detailSrc));
assert('Loading state renders Spinner',
  detailSrc.includes('Spinner'));
assert('Back navigation uses navigate(-1) hybrid (history-then-fallback)',
  /window\.history\.length > 1[\s\S]{0,80}navigate\(-1\)/.test(detailSrc));

// ═══════════════════════════════════════════════
// OrderHeader
// ═══════════════════════════════════════════════
console.log('\n--- OrderHeader ---');
const headerSrc = read('pages/orders/OrderHeader.jsx');
assert('Renders monospace orderNumber',
  /font-mono[\s\S]{0,200}order\.orderNumber/.test(headerSrc));
assert('Customer name links to /customers/:id',
  /to=\{`\/customers\/\$\{customer\._id\}`\}/.test(headerSrc));
assert('Renders StatusChangeButton',
  headerSrc.includes('StatusChangeButton'));
assert('Renders cancellation reason banner when CANCELLED',
  /CANCELLED[\s\S]{0,200}cancellationReason/.test(headerSrc));

// ═══════════════════════════════════════════════
// OrderStats
// ═══════════════════════════════════════════════
console.log('\n--- OrderStats ---');
const statsSrc = read('pages/orders/OrderStats.jsx');
assert('Renders 5 StatCard components',
  (statsSrc.match(/<StatCard/g) || []).length === 5);
assert('Stats labels include Items / Subtotal / Total GST / Grand Total / Outstanding',
  statsSrc.includes('"Items"') &&
  statsSrc.includes('"Subtotal"') &&
  statsSrc.includes('"Total GST"') &&
  statsSrc.includes('"Grand Total"') &&
  statsSrc.includes('"Outstanding"'));
assert('Outstanding turns danger when > 0',
  /amountDue > 0[\s\S]{0,80}['"]danger['"]/.test(statsSrc));
assert('GST subtitle reflects isIntraState (CGST+SGST vs IGST)',
  /CGST \+ SGST[\s\S]{0,50}IGST/.test(statsSrc));

// ═══════════════════════════════════════════════
// OrderTabs
// ═══════════════════════════════════════════════
console.log('\n--- OrderTabs ---');
const tabsSrc = read('pages/orders/OrderTabs.jsx');
const tabsArrayMatch = tabsSrc.match(
  /const\s+TABS\s*=\s*\[\s*['"]items['"]\s*,\s*['"]bills['"]\s*,\s*['"]payments['"]\s*,\s*['"]timeline['"]\s*\]/
);
assert('Has 4 tabs (items/bills/payments/timeline)', !!tabsArrayMatch);
assert('Uses Headless UI Tab', tabsSrc.includes("from '@headlessui/react'"));
assert('Persists active tab in URL via useSearchParams + replace:true',
  tabsSrc.includes('useSearchParams') && tabsSrc.includes('replace: true'));

// ═══════════════════════════════════════════════
// StatusChangeButton
// ═══════════════════════════════════════════════
console.log('\n--- StatusChangeButton ---');
const sbSrc = read('pages/orders/StatusChangeButton.jsx');
assert('Imports useChangeOrderStatus + useCancelOrder',
  sbSrc.includes('useChangeOrderStatus') && sbSrc.includes('useCancelOrder'));
assert('Uses getValidNextStatuses to gate options',
  sbSrc.includes('getValidNextStatuses'));
assert('CANCELLED routes through cancelOrder.mutateAsync (collects reason)',
  /next === ['"]CANCELLED['"][\s\S]{0,400}cancelOrder\.mutateAsync/.test(sbSrc));
assert('Other transitions use changeStatus.mutateAsync',
  /changeStatus\.mutateAsync\(\{[\s\S]{0,80}status:\s*next/.test(sbSrc));
assert('Confirms before heavy transitions (COMPLETED/DELIVERED)',
  /COMPLETED[\s\S]{0,80}DELIVERED[\s\S]{0,80}window\.confirm/.test(sbSrc));
assert('Disabled for terminal states (isTerminal)',
  sbSrc.includes('isTerminal') && /disabled=\{disabled/.test(sbSrc));
assert('Cancel reason requires 3+ chars',
  /reason\.trim\(\)\.length < 3/.test(sbSrc));

// ═══════════════════════════════════════════════
// ItemsTab
// ═══════════════════════════════════════════════
console.log('\n--- ItemsTab ---');
const itemsSrc = read('pages/orders/tabs/ItemsTab.jsx');
assert('ItemsTab table has 7 columns (SKU/Product/Spec/Qty/Rate/Discount/Subtotal)',
  itemsSrc.includes('SKU') &&
  itemsSrc.includes('Product') &&
  itemsSrc.includes('Spec') &&
  itemsSrc.includes('Qty') &&
  itemsSrc.includes('Rate') &&
  itemsSrc.includes('Discount') &&
  itemsSrc.includes('Subtotal'));
assert('Table footer shows Subtotal / GST / Grand Total',
  itemsSrc.includes('tfoot') &&
  /Grand Total/.test(itemsSrc));
assert('Discount renders % OR ₹ based on discountPct vs discountAmount',
  /discountPct[\s\S]{0,150}discountAmount/.test(itemsSrc));

// ═══════════════════════════════════════════════
// BillsTab
// ═══════════════════════════════════════════════
console.log('\n--- BillsTab ---');
const billsSrc = read('pages/orders/tabs/BillsTab.jsx');
assert('Uses useBillsByOrder hook',
  billsSrc.includes('useBillsByOrder'));
assert('Uses useCreateBillFromOrder for the inline Generate button',
  billsSrc.includes('useCreateBillFromOrder'));
assert('Renders Generate Bill button when canGenerateBill',
  /canGenerateBill\(order\)[\s\S]{0,400}Generate Bill/.test(billsSrc));
assert('Row click navigates to /bills/:id',
  /navigate\(`\/bills\/\$\{b\._id\}`\)/.test(billsSrc));
assert('Normalizes array vs single-bill response shape',
  /Array\.isArray\(raw\)[\s\S]{0,100}raw\._id/.test(billsSrc));

// ═══════════════════════════════════════════════
// PaymentsTab
// ═══════════════════════════════════════════════
console.log('\n--- PaymentsTab ---');
const paySrc = read('pages/orders/tabs/PaymentsTab.jsx');
assert('Uses useOrderPayments hook',
  paySrc.includes('useOrderPayments'));
assert('Computes totalPaid + outstanding',
  paySrc.includes('totalPaid') && paySrc.includes('outstanding'));
assert('Falls back to order.payments if hook returns nothing',
  /order\?\.payments/.test(paySrc));
assert('Mode badges color-coded (CASH=success, RAZORPAY=info, etc.)',
  paySrc.includes('CASH:           \'success\'') &&
  paySrc.includes('RAZORPAY:       \'info\''));

// ═══════════════════════════════════════════════
// TimelineTab
// ═══════════════════════════════════════════════
console.log('\n--- TimelineTab ---');
const tlSrc = read('pages/orders/tabs/TimelineTab.jsx');
assert('Reads order.statusHistory',
  tlSrc.includes('order.statusHistory'));
assert('Reverses history so latest is at top',
  /\[\.\.\.history\]\.reverse\(\)/.test(tlSrc));
assert('Renders lifecycle strip via ALL_STATUSES',
  tlSrc.includes('ALL_STATUSES'));
assert('Current status highlighted in lifecycle strip',
  /s === order\.status/.test(tlSrc));
assert('Empty-state when no history',
  tlSrc.includes('EmptyState'));

// ═══════════════════════════════════════════════
// Route wiring
// ═══════════════════════════════════════════════
console.log('\n--- Route wiring ---');
const appSrc = read('App.jsx');
assert('App lazy-imports OrderDetail',
  /OrderDetail\s*=\s*lazy\(.*OrderDetail\.jsx/.test(appSrc));
assert('/orders/:orderId route → OrderDetail',
  /<Route\s+path=['"]\/orders\/:orderId['"]\s+element=\{<OrderDetail\s*\/>}/.test(appSrc));

// ═══════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════
console.log('\n═══════════════════════════════════════');
console.log(`📊 Section D: ${pass}/${pass + fail} passed`);
if (failures.length > 0) {
  console.log('\nFailures:');
  failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
}
process.exit(fail === 0 ? 0 : 1);
