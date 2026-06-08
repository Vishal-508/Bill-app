// Section D smoke — file structure + module exports + initials helper
// + structural checks for the customer detail page.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, '..', 'src');

const { getInitials } = await import('../src/utils/initials.js');
// Node can't import .jsx files without a JSX loader — we use source-
// pattern checks below to verify the tab structure instead.

let pass = 0, fail = 0;
const failures = [];
function assert(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); failures.push(name); }
}
function read(rel) { return fs.readFileSync(path.join(SRC, rel), 'utf8'); }
function exists(rel) { return fs.existsSync(path.join(SRC, rel)); }

console.log('\n═══ Section D — Customer Detail Page Smoke ═══');

// ═══════════════════════════════════════════════
// File structure
// ═══════════════════════════════════════════════
console.log('\n--- File structure ---');
const FILES = [
  'pages/customers/CustomerDetail.jsx',
  'pages/customers/CustomerHeader.jsx',
  'pages/customers/CustomerStats.jsx',
  'pages/customers/CustomerTabs.jsx',
  'pages/customers/tabs/OverviewTab.jsx',
  'pages/customers/tabs/OrdersTab.jsx',
  'pages/customers/tabs/BillsTab.jsx',
  'pages/customers/tabs/PaymentsTab.jsx',
  'utils/initials.js',
];
for (const f of FILES) assert(`${f} exists`, exists(f));

// ═══════════════════════════════════════════════
// initials helper
// ═══════════════════════════════════════════════
console.log('\n--- getInitials helper ---');
assert('"Customer Name" → "CN"', getInitials('Customer Name') === 'CN');
assert('"Vishal Sharma" → "VS"', getInitials('Vishal Sharma') === 'VS');
assert('"sharma" → "SH" (single word)', getInitials('sharma') === 'SH');
assert('"A B C" → "AC" (first + last)', getInitials('A B C') === 'AC');
assert('"a" → "A" (single char, no second)', getInitials('a') === 'A');
assert('"" → "??"', getInitials('') === '??');
assert('null → "??"', getInitials(null) === '??');
assert('undefined → "??"', getInitials(undefined) === '??');
assert('"  spaces  trimmed  " → "ST"',
  getInitials('  spaces  trimmed  ') === 'ST');

// ═══════════════════════════════════════════════
// CustomerDetail structure
// ═══════════════════════════════════════════════
console.log('\n--- CustomerDetail.jsx ---');
const detailSrc = read('pages/customers/CustomerDetail.jsx');
assert('Default-exports CustomerDetail',
  /export default function CustomerDetail/.test(detailSrc));
assert('Uses useParams to read :customerId',
  detailSrc.includes('useParams') && detailSrc.includes('customerId'));
assert('Uses useCustomerDetail + useCustomerInsights',
  detailSrc.includes('useCustomerDetail') && detailSrc.includes('useCustomerInsights'));
assert('Edit button opens CustomerFormModal',
  detailSrc.includes('CustomerFormModal') && detailSrc.includes('setEditOpen'));
assert('Deactivate handler uses useUpdateCustomer',
  detailSrc.includes('useUpdateCustomer') && detailSrc.includes('isActive: next'));
assert('Back-to-list nav goes to /customers',
  detailSrc.includes('ROUTES.CUSTOMERS'));
assert('Renders header + stats + tabs',
  detailSrc.includes('<CustomerHeader') &&
  detailSrc.includes('<CustomerStats') &&
  detailSrc.includes('<CustomerTabs'));
assert('Error state shows when customer not found',
  /404/.test(detailSrc) && /not found/i.test(detailSrc));
assert('Loading state renders Spinner',
  detailSrc.includes('Spinner'));
assert('Inactive customers get a warning banner',
  /!customer\.isActive/.test(detailSrc) && /Alert variant=['"]warning['"]/.test(detailSrc));

// ═══════════════════════════════════════════════
// CustomerStats
// ═══════════════════════════════════════════════
console.log('\n--- CustomerStats.jsx ---');
const statsSrc = read('pages/customers/CustomerStats.jsx');
assert('Stats renders 4 StatCard components',
  (statsSrc.match(/<StatCard/g) || []).length === 4);
assert('Stats reads from insights AND financial props',
  statsSrc.includes('insights') && statsSrc.includes('financial'));
assert('Outstanding Dues turns danger when > 0',
  /currentDues[\s\S]{0,80}danger/.test(statsSrc));
assert('Total Spent renders formatINR',
  statsSrc.includes('formatINR'));

// ═══════════════════════════════════════════════
// CustomerTabs
// ═══════════════════════════════════════════════
console.log('\n--- CustomerTabs.jsx ---');
const tabsSrc = read('pages/customers/CustomerTabs.jsx');
assert('Imports Headless UI Tab', tabsSrc.includes("from '@headlessui/react'") && /\bTab\b/.test(tabsSrc));
assert('Active tab persisted via useSearchParams',
  tabsSrc.includes('useSearchParams'));
assert('Default tab is "overview"',
  tabsSrc.includes("'overview'"));
// Verify the 4-tab array from the source itself (Node can't import JSX)
const tabsArrayMatch = tabsSrc.match(
  /const\s+TABS\s*=\s*\[\s*['"]overview['"]\s*,\s*['"]orders['"]\s*,\s*['"]bills['"]\s*,\s*['"]payments['"]\s*\]/
);
assert('Has 4 tabs (overview/orders/bills/payments)', !!tabsArrayMatch);

assert('Orders tab label includes count when available',
  /orderCount[\s\S]{0,200}Orders \(\$\{orderCount\}\)/.test(tabsSrc));

// ═══════════════════════════════════════════════
// Tab content components
// ═══════════════════════════════════════════════
console.log('\n--- Tab content ---');
const overviewSrc = read('pages/customers/tabs/OverviewTab.jsx');
assert('OverviewTab renders billingAddress block',
  overviewSrc.includes('billingAddress') && /Address/i.test(overviewSrc));
assert('OverviewTab shows Bill Type badge from gstin presence',
  /customer\.gstin\s*\?\s*['"]GST['"]/.test(overviewSrc));

const ordersSrc = read('pages/customers/tabs/OrdersTab.jsx');
assert('OrdersTab fetches /orders?customer=:id',
  ordersSrc.includes("/orders") && ordersSrc.includes('customer: customerId'));
assert('OrdersTab has empty state',
  ordersSrc.includes('EmptyState'));
assert('OrdersTab links to /orders?customer=...',
  /to=\{`\/orders\?customer=/.test(ordersSrc));

const billsSrc = read('pages/customers/tabs/BillsTab.jsx');
assert('BillsTab fetches /bills?customer=:id',
  billsSrc.includes("/bills") && billsSrc.includes('customer: customerId'));

const paymentsSrc = read('pages/customers/tabs/PaymentsTab.jsx');
assert('PaymentsTab fetches /payments?customer=:id',
  paymentsSrc.includes("/payments") && paymentsSrc.includes('customer: customerId'));

// ═══════════════════════════════════════════════
// Route wiring
// ═══════════════════════════════════════════════
console.log('\n--- Route wiring ---');
const appSrc = read('App.jsx');
assert('App lazy-imports CustomerDetail',
  /CustomerDetail\s*=\s*lazy\(\s*\(\)\s*=>\s*import\(['"][^'"]+CustomerDetail\.jsx['"]/.test(appSrc));
assert('/customers/:customerId route registered',
  /<Route\s+path=['"]\/customers\/:customerId['"]\s+element=\{<CustomerDetail/.test(appSrc));

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
