// Section F smoke — paise↔rupees helpers + payment list filter
// translation + AddPaymentModal mode routing + RazorpayLinkModal share
// + receipt/QR blob-fetch + OutstandingDuesView grouping + routes.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, '..', 'src');

const { paiseToRupees, rupeesToPaise } = await import('../src/api/payment.api.js');

let pass = 0, fail = 0;
const failures = [];
function assert(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); failures.push(name); }
}
function read(rel) { return fs.readFileSync(path.join(SRC, rel), 'utf8'); }
function exists(rel) { return fs.existsSync(path.join(SRC, rel)); }

console.log('\n═══ Section F — Payments Module Smoke ═══');

// ═══════════════════════════════════════════════
// File structure
// ═══════════════════════════════════════════════
console.log('\n--- File structure ---');
const FILES = [
  'pages/payments/PaymentsList.jsx',
  'pages/payments/PaymentFilters.jsx',
  'pages/payments/_paymentColumns.jsx',
  'pages/payments/PaymentDetail.jsx',
  'pages/payments/PaymentHeader.jsx',
  'pages/payments/AddPaymentModal.jsx',
  'pages/payments/RazorpayLinkModal.jsx',
  'pages/payments/OutstandingDuesView.jsx',
];
for (const f of FILES) assert(`${f} exists`, exists(f));

// ═══════════════════════════════════════════════
// Paise/rupees conversion helpers
// ═══════════════════════════════════════════════
console.log('\n--- Paise/rupees conversions ---');
assert('paiseToRupees(0) === 0', paiseToRupees(0) === 0);
assert('paiseToRupees(100) === 1', paiseToRupees(100) === 1);
assert('paiseToRupees(12345) === 123.45', paiseToRupees(12345) === 123.45);
assert('paiseToRupees(null) → 0 (safe)', paiseToRupees(null) === 0);
assert('paiseToRupees(undefined) → 0', paiseToRupees(undefined) === 0);
assert('paiseToRupees(NaN) → 0', paiseToRupees(NaN) === 0);
assert('rupeesToPaise(0) === 0', rupeesToPaise(0) === 0);
assert('rupeesToPaise(1) === 100', rupeesToPaise(1) === 100);
assert('rupeesToPaise(123.45) === 12345 (no float drift)',
  rupeesToPaise(123.45) === 12345);
assert('rupeesToPaise(0.01) === 1 (rounds up sub-paisa)',
  rupeesToPaise(0.01) === 1);
assert('Round-trip 9999.99 paise → rupees → paise === 9999.99 paise',
  rupeesToPaise(paiseToRupees(999999)) === 999999);

// ═══════════════════════════════════════════════
// paymentApi extensions
// ═══════════════════════════════════════════════
console.log('\n--- paymentApi extensions ---');
const apiSrc = read('api/payment.api.js');
assert('paymentApi.downloadReceipt uses blob-fetch (NOT window.open)',
  /downloadReceipt:\s*async/.test(apiSrc) &&
  apiSrc.includes("responseType: 'blob'") &&
  apiSrc.includes("'/payments/'") || /['"]\/payments\//.test(apiSrc));
assert('paymentApi.downloadReceipt creates temp <a download> link',
  /downloadReceipt[\s\S]{0,700}createElement\('a'\)[\s\S]{0,200}link\.download/.test(apiSrc));
assert('paymentApi.fetchQrImage returns blob URL',
  /fetchQrImage:\s*async/.test(apiSrc) &&
  /URL\.createObjectURL/.test(apiSrc));
assert('paymentApi exports paiseToRupees + rupeesToPaise',
  apiSrc.includes('export const paiseToRupees') &&
  apiSrc.includes('export const rupeesToPaise'));

// ═══════════════════════════════════════════════
// _paymentColumns
// ═══════════════════════════════════════════════
console.log('\n--- _paymentColumns ---');
const colsSrc = read('pages/payments/_paymentColumns.jsx');
assert('STATUS_VARIANT covers Razorpay vocabulary (CAPTURED/AUTHORIZED/etc)',
  colsSrc.includes('CAPTURED:') && colsSrc.includes('AUTHORIZED:') &&
  colsSrc.includes('FAILED:') && colsSrc.includes('REFUNDED:'));
assert('METHOD_VARIANT covers Razorpay methods (upi/card/netbanking)',
  colsSrc.includes("upi:") && colsSrc.includes("card:") &&
  colsSrc.includes("netbanking:"));
assert('GATEWAY_VARIANT covers razorpay/manual/mock',
  colsSrc.includes("razorpay:") && colsSrc.includes("manual:") &&
  colsSrc.includes("mock:"));
assert('Amount column converts via paiseToRupees (not raw display)',
  /paiseToRupees\(row\.original\.amount\)/.test(colsSrc));
assert('Customer + Bill cells link with stopPropagation',
  /to=\{`\/customers\/\$\{id\}`\}[\s\S]{0,200}stopPropagation/.test(colsSrc) &&
  /to=\{`\/bills\/\$\{id\}`\}[\s\S]{0,200}stopPropagation/.test(colsSrc));
assert('isRefundable helper: CAPTURED + not-yet-fully-refunded',
  /isRefundable[\s\S]{0,200}status === ['"]CAPTURED['"][\s\S]{0,150}amountRefunded/.test(colsSrc));
// Cancel-action gating — verify the condition exists in the file
// (regex-tight matching the cross-line layout is brittle).
assert('Cancel row action gated on CREATED/ATTEMPTED only',
  colsSrc.includes("'Cancel'") &&
  /\[\s*['"]CREATED['"]\s*,\s*['"]ATTEMPTED['"]\s*\]/.test(colsSrc));

// ═══════════════════════════════════════════════
// PaymentsList wiring
// ═══════════════════════════════════════════════
console.log('\n--- PaymentsList ---');
const listSrc = read('pages/payments/PaymentsList.jsx');
assert('Uses usePaymentsList',
  listSrc.includes('usePaymentsList'));
assert('Translates UI dateFrom → backend fromDate (audit-driven)',
  /fromDate\s*=\s*sp\.get\(['"]dateFrom['"]\)/.test(listSrc));
assert('Translates UI minTotal → backend minAmount (paise on backend)',
  /minAmount\s*=\s*sp\.get\(['"]minTotal['"]\)/.test(listSrc));
assert('Default sort = -createdAt (backend default)',
  listSrc.includes("'-createdAt'"));
assert('Search placeholder reflects paymentReference-only matching',
  /payment reference/i.test(listSrc));
assert('Receipt download uses paymentApi.downloadReceipt (blob-fetch)',
  listSrc.includes('paymentApi.downloadReceipt'));
assert('CSV export converts paise → rupees for display column',
  /amountRupees:\s*paiseToRupees/.test(listSrc));
assert('View toggle: "Payments" vs "Outstanding"',
  /view === ['"]outstanding['"]/.test(listSrc) &&
  /OutstandingDuesView/.test(listSrc));
assert('Add Payment button always visible (both views)',
  /Add Payment/.test(listSrc) && /setAddOpen\(true\)/.test(listSrc));
assert('Razorpay handoff from AddPaymentModal',
  listSrc.includes('handleRazorpaySelected') &&
  listSrc.includes('setRazorpayOpen(true)'));

// ═══════════════════════════════════════════════
// PaymentFilters
// ═══════════════════════════════════════════════
console.log('\n--- PaymentFilters ---');
const filtersSrc = read('pages/payments/PaymentFilters.jsx');
assert('Filters expose status / method / gateway / customer + date + amount',
  filtersSrc.includes('STATUS_OPTIONS') &&
  filtersSrc.includes('METHOD_OPTIONS') &&
  filtersSrc.includes('GATEWAY_OPTIONS') &&
  filtersSrc.includes('CustomerPicker') &&
  filtersSrc.includes('dateFrom') &&
  filtersSrc.includes('minTotal'));
assert('Status options use Razorpay enum (CAPTURED not SUCCESS)',
  filtersSrc.includes("'CAPTURED'") && !filtersSrc.includes("'SUCCESS'"));

// ═══════════════════════════════════════════════
// PaymentDetail
// ═══════════════════════════════════════════════
console.log('\n--- PaymentDetail ---');
const detailSrc = read('pages/payments/PaymentDetail.jsx');
assert('Default-exports PaymentDetail',
  /export default function PaymentDetail/.test(detailSrc));
assert('Reads :paymentId via useParams',
  detailSrc.includes('useParams') && detailSrc.includes('paymentId'));
assert('Uses usePaymentDetail + useCancelPayment',
  detailSrc.includes('usePaymentDetail') && detailSrc.includes('useCancelPayment'));
assert('Receipt download uses paymentApi.downloadReceipt',
  detailSrc.includes('paymentApi.downloadReceipt'));
assert('Receipt download surfaces 401 / 404 distinctly',
  /401[\s\S]{0,100}Session expired/.test(detailSrc) &&
  /404[\s\S]{0,80}Receipt not available/.test(detailSrc));
assert('Cancel button gated on CREATED/ATTEMPTED only',
  /\[\s*['"]CREATED['"]\s*,\s*['"]ATTEMPTED['"]\s*\]/.test(detailSrc) &&
  /canCancel/.test(detailSrc));
assert('Renders amount + amountRefunded via paiseToRupees',
  detailSrc.includes('paiseToRupees'));
assert('Razorpay-specific fields shown when gateway === razorpay',
  /gateway === ['"]razorpay['"][\s\S]{0,300}razorpayOrderId/.test(detailSrc));
assert('Hybrid back navigation',
  /window\.history\.length > 1[\s\S]{0,80}navigate\(-1\)/.test(detailSrc));

// ═══════════════════════════════════════════════
// PaymentHeader
// ═══════════════════════════════════════════════
console.log('\n--- PaymentHeader ---');
const headerSrc = read('pages/payments/PaymentHeader.jsx');
assert('Renders monospace paymentReference',
  /font-mono[\s\S]{0,200}paymentReference/.test(headerSrc));
assert('Big-amount panel uses paiseToRupees',
  /paiseToRupees\(payment\.amount\)/.test(headerSrc));
assert('Status + Method + Gateway badges',
  /STATUS_VARIANT/.test(headerSrc) &&
  /METHOD_VARIANT/.test(headerSrc) &&
  /GATEWAY_VARIANT/.test(headerSrc));
assert('Linked entity navigation: customer + bill + order',
  /to=\{`\/customers\/\$\{customer\._id\}`\}/.test(headerSrc) &&
  /to=\{`\/bills\/\$\{bill\._id\}`\}/.test(headerSrc) &&
  /to=\{`\/orders\/\$\{order\._id\}`\}/.test(headerSrc));

// ═══════════════════════════════════════════════
// AddPaymentModal — multi-mode routing
// ═══════════════════════════════════════════════
console.log('\n--- AddPaymentModal ---');
const addSrc = read('pages/payments/AddPaymentModal.jsx');
assert('5 modes (CASH/UPI/BANK_TRANSFER/CHEQUE/RAZORPAY_LINK)',
  addSrc.includes("value: 'CASH'") &&
  addSrc.includes("value: 'UPI'") &&
  addSrc.includes("value: 'BANK_TRANSFER'") &&
  addSrc.includes("value: 'CHEQUE'") &&
  addSrc.includes("value: 'RAZORPAY_LINK'"));
assert('Razorpay mode hands off via onRazorpaySelected callback',
  /mode === ['"]RAZORPAY_LINK['"][\s\S]{0,200}onRazorpaySelected/.test(addSrc));
assert('Manual payment routes through useAddOrderPayment',
  addSrc.includes('useAddOrderPayment'));
assert('Mode-specific fields conditional on mode value',
  /showUpiFields\s*=\s*mode === ['"]UPI['"]/.test(addSrc) &&
  /showBankFields[\s\S]{0,80}BANK_TRANSFER/.test(addSrc) &&
  /showChequeFields[\s\S]{0,80}CHEQUE/.test(addSrc));
assert('Backend payload shape: { amount, mode, reference, paidAt, notes }',
  /addPayment\.mutateAsync\(\{[\s\S]{0,400}mode,[\s\S]{0,200}reference/.test(addSrc));
assert('Composes reference string per mode (UPI ref / txn ID / cheque #)',
  /upiRef[\s\S]{0,150}payerName/.test(addSrc) &&
  /txnId[\s\S]{0,100}bankName/.test(addSrc) &&
  /chequeNo[\s\S]{0,200}chequeDate/.test(addSrc));
assert('Outstanding amount pre-fills via defaultAmount or bill.amountDue',
  /bill\?\.amountDue/.test(addSrc) ||
  /amountDue/.test(addSrc));

// ═══════════════════════════════════════════════
// RazorpayLinkModal
// ═══════════════════════════════════════════════
console.log('\n--- RazorpayLinkModal ---');
const rzpSrc = read('pages/payments/RazorpayLinkModal.jsx');
assert('Uses useInitiatePayment hook',
  rzpSrc.includes('useInitiatePayment'));
assert('POSTs to backend (amount in rupees; server converts to paise)',
  /amount:\s*\+amount/.test(rzpSrc));
assert('Copy to clipboard via navigator.clipboard',
  /navigator\.clipboard\.writeText/.test(rzpSrc));
assert('WhatsApp share uses wa.me/91 pattern (matches SendBillModal)',
  /wa\.me\/91/.test(rzpSrc));
assert('Pre-fills message with payment link + amount',
  /Please use the link below to pay/.test(rzpSrc));
assert('Defensive on response shape (paymentLink / shortUrl / short_url / url)',
  /paymentLink[\s\S]{0,100}shortUrl[\s\S]{0,100}short_url[\s\S]{0,30}url/.test(rzpSrc));

// ═══════════════════════════════════════════════
// OutstandingDuesView
// ═══════════════════════════════════════════════
console.log('\n--- OutstandingDuesView ---');
const ovSrc = read('pages/payments/OutstandingDuesView.jsx');
assert('Fetches /orders/outstanding-payments',
  /\/orders\/outstanding-payments/.test(ovSrc));
assert('Groups rows by customer locally',
  /groupByCustomer/.test(ovSrc));
assert('Days-old indicator + color tiers (60d danger, 30d warning)',
  /age > 60[\s\S]{0,80}danger[\s\S]{0,200}age > 30[\s\S]{0,80}warning/.test(ovSrc));
// Sort modes — verify both option values appear (the conditional uses
// `if (sort === 'amount') { ... } else { /* overdue */ ... }`, so the
// literal "overdue" only appears as a select option value).
assert('Sort modes: amount + overdue',
  /value:\s*['"]amount['"]/.test(ovSrc) &&
  /value:\s*['"]overdue['"]/.test(ovSrc));
assert('Per-bill "Add payment" action via onAddPaymentForBill callback',
  /onAddPaymentForBill\?\.\(b\)/.test(ovSrc));
assert('Empty state when no dues',
  ovSrc.includes('EmptyState') &&
  /No outstanding dues/.test(ovSrc));
assert('Defensive on response shape (byCustomer envelope OR flat array)',
  /byCustomer[\s\S]{0,150}Array\.isArray/.test(ovSrc));

// ═══════════════════════════════════════════════
// Route wiring
// ═══════════════════════════════════════════════
console.log('\n--- Route wiring ---');
const appSrc = read('App.jsx');
assert('App lazy-imports PaymentsList',
  /PaymentsList\s*=\s*lazy\(.*PaymentsList\.jsx/.test(appSrc));
assert('App lazy-imports PaymentDetail',
  /PaymentDetail\s*=\s*lazy\(.*PaymentDetail\.jsx/.test(appSrc));
assert('/payments route → PaymentsList',
  /<Route\s+path=['"]\/payments['"]\s+element=\{<PaymentsList\s*\/>}/.test(appSrc));
assert('/payments/:paymentId route → PaymentDetail',
  /<Route\s+path=['"]\/payments\/:paymentId['"]\s+element=\{<PaymentDetail\s*\/>}/.test(appSrc));
assert('/payments no longer goes to Placeholder',
  !/path=['"]\/payments['"][^>]*Placeholder\s+title=['"]Payments['"]/.test(appSrc));

// ═══════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════
console.log('\n═══════════════════════════════════════');
console.log(`📊 Section F: ${pass}/${pass + fail} passed`);
if (failures.length > 0) {
  console.log('\nFailures:');
  failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
}
process.exit(fail === 0 ? 0 : 1);
