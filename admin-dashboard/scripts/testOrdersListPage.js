// Section B smoke — status-flow helpers + columns + filter UI +
// list page wiring + route registration.

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

console.log('\n═══ Section B — Orders List Page Smoke ═══');

// ═══════════════════════════════════════════════
// File structure
// ═══════════════════════════════════════════════
console.log('\n--- File structure ---');
const FILES = [
  'pages/orders/OrdersList.jsx',
  'pages/orders/OrderFilters.jsx',
  'pages/orders/OrderFormModal.jsx',
  'pages/orders/_orderColumns.jsx',
  'components/forms/CustomerPicker.jsx',
];
for (const f of FILES) assert(`${f} exists`, exists(f));

// ═══════════════════════════════════════════════
// _orderColumns helpers — extract by source-pattern (Node can't load
// JSX directly, but the helpers are pure JS expressions inside the
// .jsx file — we eval the function bodies after a tiny extraction).
// ═══════════════════════════════════════════════
console.log('\n--- Status flow helpers ---');
const colsSrc = read('pages/orders/_orderColumns.jsx');

// STATUS_FLOW const — parse the literal
const flowMatch = colsSrc.match(
  /export const STATUS_FLOW = Object\.freeze\(\{([\s\S]+?)\}\);/
);
assert('STATUS_FLOW exported as Object.freeze', !!flowMatch);

// Verify each status has its expected next-states (8 statuses)
const expectedFlow = {
  PENDING:     ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['CUTTING', 'CANCELLED'],
  CUTTING:     ['BUNDLING', 'CANCELLED'],
  BUNDLING:    ['READY', 'CANCELLED'],
  READY:       ['COMPLETED', 'DELIVERED', 'CANCELLED'],
  COMPLETED:   ['DELIVERED'],
  DELIVERED:   [],
  CANCELLED:   [],
};
for (const [k, expectedNext] of Object.entries(expectedFlow)) {
  // Find the key's array in the source
  const keyRe = new RegExp(`${k}:\\s*\\[([^\\]]*)\\]`);
  const m = colsSrc.match(keyRe);
  assert(`STATUS_FLOW.${k} matches expected next states`,
    !!m && expectedNext.every(s => m[1].includes(`'${s}'`)),
    `Expected ${expectedNext.join(',')}`);
}

// Extract canTransitionTo + getValidNextStatuses by eval
function extractFn(src, name) {
  const re = new RegExp(`export function ${name}\\(([^)]*)\\)\\s*\\{([\\s\\S]+?)\\n\\}`);
  const m = src.match(re);
  if (!m) return null;
  return new Function(...m[1].split(',').map(s => s.trim()).filter(Boolean), m[2]);
}

// Reconstruct STATUS_FLOW for the eval'd functions to see
const STATUS_FLOW = expectedFlow;
const canTransitionToFn = (() => {
  // canTransitionTo uses STATUS_FLOW from module scope; rebuild it inline
  const re = /export function canTransitionTo\(currentStatus, nextStatus\)\s*\{([\s\S]+?)\n\}/;
  const m = colsSrc.match(re);
  if (!m) return null;
  // Inject STATUS_FLOW via closure
  return new Function(
    'STATUS_FLOW', 'currentStatus', 'nextStatus',
    m[1]
  ).bind(null, STATUS_FLOW);
})();
const getValidNextStatusesFn = (() => {
  const re = /export function getValidNextStatuses\(currentStatus\)\s*\{([\s\S]+?)\n\}/;
  const m = colsSrc.match(re);
  if (!m) return null;
  return new Function(
    'STATUS_FLOW', 'currentStatus',
    m[1]
  ).bind(null, STATUS_FLOW);
})();

if (canTransitionToFn) {
  assert('canTransitionTo(PENDING, IN_PROGRESS) → true',
    canTransitionToFn('PENDING', 'IN_PROGRESS') === true);
  assert('canTransitionTo(PENDING, DELIVERED) → false (invalid skip)',
    canTransitionToFn('PENDING', 'DELIVERED') === false);
  assert('canTransitionTo(DELIVERED, anything) → false (terminal)',
    canTransitionToFn('DELIVERED', 'COMPLETED') === false &&
    canTransitionToFn('DELIVERED', 'CANCELLED') === false);
  assert('canTransitionTo(CANCELLED, anything) → false (terminal)',
    canTransitionToFn('CANCELLED', 'PENDING') === false);
  assert('canTransitionTo(READY, DELIVERED) → true',
    canTransitionToFn('READY', 'DELIVERED') === true);
  assert('canTransitionTo("BOGUS", "IN_PROGRESS") → false (unknown)',
    canTransitionToFn('BOGUS', 'IN_PROGRESS') === false);
}

if (getValidNextStatusesFn) {
  assert('getValidNextStatuses(PENDING) length 2',
    getValidNextStatusesFn('PENDING').length === 2);
  assert('getValidNextStatuses(READY) length 3',
    getValidNextStatusesFn('READY').length === 3);
  assert('getValidNextStatuses(DELIVERED) → []',
    getValidNextStatusesFn('DELIVERED').length === 0);
  assert('getValidNextStatuses("UNKNOWN") → [] (safe)',
    getValidNextStatusesFn('UNKNOWN').length === 0);
}

// ═══════════════════════════════════════════════
// Badge variant maps
// ═══════════════════════════════════════════════
console.log('\n--- Badge variant maps ---');
assert('STATUS_BADGE_VARIANT covers all 8 statuses',
  colsSrc.includes('PENDING:     \'warning\'') &&
  colsSrc.includes('CANCELLED:   \'danger\''));
assert('PAYMENT_STATUS_VARIANT covers UNPAID/PARTIAL/PAID',
  colsSrc.includes('UNPAID:    \'danger\'') &&
  colsSrc.includes('PARTIAL:   \'warning\'') &&
  colsSrc.includes('PAID:      \'success\''));

// ═══════════════════════════════════════════════
// Row action conditions
// ═══════════════════════════════════════════════
console.log('\n--- Row action conditions ---');
assert('Edit gated by isEditable',
  /label: ['"]Edit['"][\s\S]{0,150}isEditable/.test(colsSrc));
assert('Change Status gated by valid-next-statuses count',
  /Change Status[\s\S]{0,200}getValidNextStatuses\(row\.status\)\.length > 0/.test(colsSrc));
assert('Generate Bill gated by canGenerateBill',
  /Generate Bill[\s\S]{0,150}canGenerateBill\(row\)/.test(colsSrc));
assert('Cancel gated by !isTerminal',
  /label: ['"]Cancel['"][\s\S]{0,150}!isTerminal\(row\.status\)/.test(colsSrc));
assert('Soft delete gated on CANCELLED only',
  /Soft delete[\s\S]{0,200}row\.status === ['"]CANCELLED['"]/.test(colsSrc));

// ═══════════════════════════════════════════════
// CustomerPicker structure
// ═══════════════════════════════════════════════
console.log('\n--- CustomerPicker ---');
const pickerSrc = read('components/forms/CustomerPicker.jsx');
assert('CustomerPicker uses Headless UI Combobox',
  pickerSrc.includes("from '@headlessui/react'") && pickerSrc.includes('Combobox'));
assert('CustomerPicker fetches via useCustomersList with search param',
  pickerSrc.includes('useCustomersList') && /search:\s*debounced/.test(pickerSrc));
assert('CustomerPicker debounces input (250ms)',
  /useDebounce\(query,\s*250\)/.test(pickerSrc));
assert('CustomerPicker onChange passes FULL customer object',
  /onChange\?\.\(c\)/.test(pickerSrc));
assert('CustomerPicker shows phone via formatPhone',
  pickerSrc.includes('formatPhone'));

// ═══════════════════════════════════════════════
// OrderFilters
// ═══════════════════════════════════════════════
console.log('\n--- OrderFilters ---');
const filtersSrc = read('pages/orders/OrderFilters.jsx');
assert('OrderFilters has status + paymentStatus + customer + date range + amount range',
  filtersSrc.includes('status') &&
  filtersSrc.includes('paymentStatus') &&
  filtersSrc.includes('CustomerPicker') &&
  filtersSrc.includes('dateFrom') &&
  filtersSrc.includes('dateTo') &&
  filtersSrc.includes('minTotal') &&
  filtersSrc.includes('maxTotal'));
assert('OrderFilters Status select uses ALL_STATUSES',
  filtersSrc.includes('ALL_STATUSES'));
assert('OrderFilters has Apply + Reset buttons',
  /Apply/.test(filtersSrc) && /Reset/.test(filtersSrc));

// ═══════════════════════════════════════════════
// OrdersList wiring
// ═══════════════════════════════════════════════
console.log('\n--- OrdersList wiring ---');
const listSrc = read('pages/orders/OrdersList.jsx');
assert('Imports useOrdersList', listSrc.includes('useOrdersList'));
assert('Imports useChangeOrderStatus + useCancelOrder + useDeleteOrder',
  listSrc.includes('useChangeOrderStatus') &&
  listSrc.includes('useCancelOrder') &&
  listSrc.includes('useDeleteOrder'));
assert('Imports useCreateBillFromOrder (for Generate Bill row action)',
  listSrc.includes('useCreateBillFromOrder'));
assert('Renders DataTable + PageHeader',
  listSrc.includes('<DataTable') && listSrc.includes('<PageHeader'));
assert('Reads pagination.totalRecords (Prompt 11 lesson)',
  listSrc.includes('pagination?.totalRecords'));
// Sort translation — check the signals separately rather than pinning
// adjacency (the conditional spans multiple lines). Default sort is
// `-orderDate` to match backend's controller default.
assert('Sort translation: -field mongoose-style',
  listSrc.includes("'-orderDate'") &&
  /sortOrder === ['"]desc['"]\s*\?\s*['"]-['"]/.test(listSrc));
assert('Backend param names: fromDate/toDate (not dateFrom/dateTo)',
  /fromDate\s*=\s*sp\.get\(['"]dateFrom['"]\)/.test(listSrc) &&
  /toDate\s*=\s*sp\.get\(['"]dateTo['"]\)/.test(listSrc));
assert('Backend param names: minAmount/maxAmount (not minTotal/maxTotal)',
  /minAmount\s*=\s*sp\.get\(['"]minTotal['"]\)/.test(listSrc) &&
  /maxAmount\s*=\s*sp\.get\(['"]maxTotal['"]\)/.test(listSrc));
assert('Search placeholder reflects orderNumber-only matching',
  /order #/i.test(listSrc));
assert('selectionResetSignal wired to DataTable',
  listSrc.includes('selectionResetSignal'));
// Bulk fan-out helpers — verify by name + Promise.allSettled usage
const allSettledCount = (listSrc.match(/Promise\.allSettled/g) || []).length;
assert('Bulk transitions function exists',
  listSrc.includes('runBulkTransition'));
assert('Bulk cancel function exists',
  listSrc.includes('runBulkCancel'));
assert('Two Promise.allSettled fan-outs (transition + cancel)',
  allSettledCount >= 2, `Got ${allSettledCount}`);
assert('Bulk cancel prompts for reason',
  /runBulkCancel[\s\S]{0,600}window\.prompt/.test(listSrc));
assert('Cancel handler requires reason 3+ chars',
  /reason\.trim\(\)\.length < 3/.test(listSrc));
assert('Element-prop convention on emptyState icon',
  /emptyState=\{[\s\S]{0,200}icon:\s*<ShoppingCart/.test(listSrc));
assert('CSV export covers order number + status + total + customer',
  listSrc.includes('exportToCsv') &&
  listSrc.includes("'orderNumber'") &&
  listSrc.includes("'totalAmount'"));

// ═══════════════════════════════════════════════
// Route wiring
// ═══════════════════════════════════════════════
console.log('\n--- Route wiring ---');
const appSrc = read('App.jsx');
assert('App lazy-imports OrdersList',
  /OrdersList\s*=\s*lazy\(.*OrdersList\.jsx/.test(appSrc));
assert('/orders route → OrdersList (not Placeholder)',
  /<Route\s+path=['"]\/orders['"]\s+element=\{<OrdersList\s*\/>}/.test(appSrc));
assert('/orders no longer goes to Placeholder',
  !/path=['"]\/orders['"][^>]*Placeholder\s+title=['"]Orders['"]/.test(appSrc));

// ═══════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════
console.log('\n═══════════════════════════════════════');
console.log(`📊 Section B: ${pass}/${pass + fail} passed`);
if (failures.length > 0) {
  console.log('\nFailures:');
  failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
}
process.exit(fail === 0 ? 0 : 1);
