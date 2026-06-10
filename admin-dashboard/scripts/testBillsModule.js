// Section E smoke — Bills list + detail page + Send/Mark-sent modals
// + filter param translation + route wiring.

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

console.log('\n═══ Section E — Bills Module Smoke ═══');

// ═══════════════════════════════════════════════
// File structure
// ═══════════════════════════════════════════════
console.log('\n--- File structure ---');
const FILES = [
  'pages/bills/BillsList.jsx',
  'pages/bills/BillFilters.jsx',
  'pages/bills/_billColumns.jsx',
  'pages/bills/BillDetail.jsx',
  'pages/bills/BillHeader.jsx',
  'pages/bills/BillStats.jsx',
  'pages/bills/BillTabs.jsx',
  'pages/bills/tabs/BillItemsTab.jsx',
  'pages/bills/tabs/BillPaymentsTab.jsx',
  'pages/bills/SendBillModal.jsx',
  'pages/bills/MarkSentModal.jsx',
];
for (const f of FILES) assert(`${f} exists`, exists(f));

// ═══════════════════════════════════════════════
// _billColumns helpers
// ═══════════════════════════════════════════════
console.log('\n--- _billColumns ---');
const colsSrc = read('pages/bills/_billColumns.jsx');
assert('BILL_STATUS_VARIANT exported (DRAFT/FINAL/CANCELLED)',
  /BILL_STATUS_VARIANT = Object\.freeze/.test(colsSrc) &&
  colsSrc.includes('DRAFT:') && colsSrc.includes('FINAL:') && colsSrc.includes('CANCELLED:'));
assert('PAYMENT_STATUS_VARIANT covers UNPAID/PARTIAL/PAID',
  colsSrc.includes('UNPAID:') && colsSrc.includes('PARTIAL:') && colsSrc.includes('PAID:'));
assert('isDraft + isFinal + isCancelled + isLocked helpers exist',
  /export function isDraft/.test(colsSrc) &&
  /export function isFinal/.test(colsSrc) &&
  /export function isCancelled/.test(colsSrc) &&
  /export function isLocked/.test(colsSrc));
// sentChannels uses a local `c = e.channel` then compares; check both
// the literal strings exist in the helper without pinning the LHS.
assert('sentChannels helper detects whatsapp + email from events',
  /export function sentChannels/.test(colsSrc) &&
  /=== ['"]whatsapp['"]/.test(colsSrc) &&
  /=== ['"]email['"]/.test(colsSrc));
// "Edit" intentionally absent — bills are immutable snapshots.
// Edits flow through the source order (verified by inline rationale).
assert('No Edit row action (honest — bills are snapshots)',
  !/label:\s*['"]Edit['"]/.test(colsSrc));
assert('Rationale comment explains the omission',
  /no dead controls|immutable snapshot/i.test(colsSrc));
assert('Row actions: Download PDF always available',
  /label: ['"]Download PDF['"]/.test(colsSrc));
assert('Customer cell links to /customers/:id',
  /to=\{`\/customers\/\$\{id\}`\}/.test(colsSrc));

// ═══════════════════════════════════════════════
// BillsList wiring
// ═══════════════════════════════════════════════
console.log('\n--- BillsList ---');
const listSrc = read('pages/bills/BillsList.jsx');
assert('Uses useBillsList', listSrc.includes('useBillsList'));
assert('Translates UI dateFrom → backend fromDate (audit-driven)',
  /fromDate\s*=\s*sp\.get\(['"]dateFrom['"]\)/.test(listSrc));
assert('Translates UI dateTo → backend toDate',
  /toDate\s*=\s*sp\.get\(['"]dateTo['"]\)/.test(listSrc));
assert('Translates UI minTotal → backend minAmount',
  /minAmount\s*=\s*sp\.get\(['"]minTotal['"]\)/.test(listSrc));
assert('Translates UI maxTotal → backend maxAmount',
  /maxAmount\s*=\s*sp\.get\(['"]maxTotal['"]\)/.test(listSrc));
assert('Default sort = -issueDate (backend default)',
  listSrc.includes("'-issueDate'"));
assert('Search placeholder reflects billNumber-only matching',
  /invoice #/i.test(listSrc));
// "No Create Bill button" — strip comments before checking; the
// source comment explaining the absence shouldn't trigger this.
const listSrcNoComments = listSrc
  .replace(/\/\*[\s\S]*?\*\//g, '')          // block comments
  .replace(/^\s*\/\/.*$/gm, '');              // line comments
assert('No "Create Bill" / "New Bill" button (bills come from orders)',
  !/Create Bill|New Bill/i.test(listSrcNoComments));
assert('Empty-state CTA points to /orders',
  listSrc.includes("'/orders'") && /View Orders/.test(listSrc));
// PDF download uses the authenticated blob-based helper (Bug 2 fix).
// window.open(pdfUrl) failed in browser — backend needs Bearer header.
assert('PDF download uses authenticated billApi.downloadPdf (blob)',
  /billApi\.downloadPdf\(bill\._id\)/.test(listSrc));
assert('PDF download surfaces 401 / 404 distinctly via toast',
  /401[\s\S]{0,100}Session expired/.test(listSrc) &&
  /404[\s\S]{0,100}not found/i.test(listSrc));
assert('Send modal opens via setSendingBill',
  listSrc.includes('setSendingBill'));
assert('Mark-sent modal opens via setMarkingBill',
  listSrc.includes('setMarkingBill'));

// ═══════════════════════════════════════════════
// BillFilters
// ═══════════════════════════════════════════════
console.log('\n--- BillFilters ---');
const filtersSrc = read('pages/bills/BillFilters.jsx');
assert('Has status + paymentStatus + hasGst + customer + date + amount filters',
  filtersSrc.includes('status') &&
  filtersSrc.includes('paymentStatus') &&
  filtersSrc.includes('hasGst') &&
  filtersSrc.includes('CustomerPicker') &&
  filtersSrc.includes('dateFrom') &&
  filtersSrc.includes('minTotal'));
assert('Status options: DRAFT/FINAL/CANCELLED',
  filtersSrc.includes("'DRAFT'") &&
  filtersSrc.includes("'FINAL'") &&
  filtersSrc.includes("'CANCELLED'"));

// ═══════════════════════════════════════════════
// BillDetail
// ═══════════════════════════════════════════════
console.log('\n--- BillDetail ---');
const detailSrc = read('pages/bills/BillDetail.jsx');
assert('Default-exports BillDetail',
  /export default function BillDetail/.test(detailSrc));
assert('Reads :billId from useParams',
  detailSrc.includes('useParams') && detailSrc.includes('billId'));
assert('Uses useBillDetail hook',
  detailSrc.includes('useBillDetail'));
assert('Uses useFinalizeBill + useCancelBill',
  detailSrc.includes('useFinalizeBill') && detailSrc.includes('useCancelBill'));
assert('Renders BillHeader + BillStats + BillTabs',
  detailSrc.includes('<BillHeader') &&
  detailSrc.includes('<BillStats') &&
  detailSrc.includes('<BillTabs'));
assert('Finalize button gated on isDraft (canFinalize)',
  /isDraft\(bill\)/.test(detailSrc));
assert('Finalize confirms before mutating',
  /Finalize[\s\S]{0,150}window\.confirm/.test(detailSrc));
assert('Cancel collects reason via prompt (3+ chars)',
  /Cancel[\s\S]{0,150}window\.prompt[\s\S]{0,200}length < 3/.test(detailSrc));
assert('Send + Mark-sent buttons disabled when CANCELLED',
  /Send[\s\S]{0,200}disabled=\{bill\.status === ['"]CANCELLED['"]\}/.test(detailSrc));
assert('Hybrid back navigation (-1 then fallback)',
  /window\.history\.length > 1[\s\S]{0,80}navigate\(-1\)/.test(detailSrc));
assert('404 distinguished in error state',
  /404/.test(detailSrc));

// ═══════════════════════════════════════════════
// BillHeader
// ═══════════════════════════════════════════════
console.log('\n--- BillHeader ---');
const headerSrc = read('pages/bills/BillHeader.jsx');
assert('Renders monospace billNumber',
  /font-mono[\s\S]{0,200}bill\.billNumber/.test(headerSrc));
assert('Customer link → /customers/:id',
  /to=\{`\/customers\/\$\{customer\._id\}`\}/.test(headerSrc));
assert('Order link → /orders/:id (when from-order)',
  /to=\{`\/orders\/\$\{order\._id\}`\}/.test(headerSrc));
assert('Renders 3 badges: status + type + paymentStatus',
  (headerSrc.match(/<Badge/g) || []).length >= 3);
assert('Cancellation banner when CANCELLED with reason',
  /isCancelled\(bill\)[\s\S]{0,200}cancellationReason/.test(headerSrc));

// ═══════════════════════════════════════════════
// BillStats
// ═══════════════════════════════════════════════
console.log('\n--- BillStats ---');
const statsSrc = read('pages/bills/BillStats.jsx');
assert('Renders 5 StatCards',
  (statsSrc.match(/<StatCard/g) || []).length === 5);
assert('Outstanding danger accent when > 0',
  /amountDue > 0[\s\S]{0,80}['"]danger['"]/.test(statsSrc));
assert('GST subtitle reflects isIntraState',
  /CGST \+ SGST[\s\S]{0,50}IGST/.test(statsSrc));

// ═══════════════════════════════════════════════
// BillTabs
// ═══════════════════════════════════════════════
console.log('\n--- BillTabs ---');
const tabsSrc = read('pages/bills/BillTabs.jsx');
const tabsArrayMatch = tabsSrc.match(
  /const\s+TABS\s*=\s*\[\s*['"]items['"]\s*,\s*['"]payments['"]\s*\]/
);
assert('Has 2 tabs (items/payments)', !!tabsArrayMatch);
assert('Headless UI Tab + URL persist',
  tabsSrc.includes("'@headlessui/react'") &&
  tabsSrc.includes('useSearchParams') &&
  tabsSrc.includes('replace: true'));

// ═══════════════════════════════════════════════
// Items + Payments tabs
// ═══════════════════════════════════════════════
console.log('\n--- Items + Payments tabs ---');
const itemsSrc = read('pages/bills/tabs/BillItemsTab.jsx');
assert('BillItemsTab includes HSN column (key bill detail)',
  itemsSrc.includes('HSN'));
assert('BillItemsTab footer shows Subtotal/GST/Grand Total',
  itemsSrc.includes('tfoot') && /Grand Total/.test(itemsSrc));

const payTabSrc = read('pages/bills/tabs/BillPaymentsTab.jsx');
assert('BillPaymentsTab fetches /payments?bill=:id (verified backend filter)',
  payTabSrc.includes("'/payments'") && /bill:\s*bill\._id/.test(payTabSrc));
assert('BillPaymentsTab computes totalPaid + outstanding',
  payTabSrc.includes('totalPaid') && payTabSrc.includes('outstanding'));

// ═══════════════════════════════════════════════
// SendBillModal (channel-pick → open external → mark-sent)
// ═══════════════════════════════════════════════
console.log('\n--- SendBillModal ---');
const sendSrc = read('pages/bills/SendBillModal.jsx');
assert('SendBillModal supports WhatsApp + Email channels',
  /channel === ['"]whatsapp['"]/.test(sendSrc) && /channel === ['"]email['"]/.test(sendSrc));
assert('WhatsApp link uses wa.me with +91',
  /wa\.me\/91/.test(sendSrc));
assert('Email link uses mailto: with subject + body',
  /mailto:\$\{[\s\S]{0,30}\?subject=\$\{[\s\S]{0,30}&body=/.test(sendSrc));
assert('Pre-filled message includes bill PDF URL',
  /billApi\.pdfUrl\(/.test(sendSrc));
assert('Mark-sent button disabled until channel opened',
  /disabled=\{!opened/.test(sendSrc));
assert('Calls useMarkBillSent on confirm',
  sendSrc.includes('useMarkBillSent'));

// ═══════════════════════════════════════════════
// MarkSentModal (standalone record-only)
// ═══════════════════════════════════════════════
console.log('\n--- MarkSentModal ---');
const markSrc = read('pages/bills/MarkSentModal.jsx');
assert('MarkSentModal exposes all 4 channels (whatsapp/email/print/in-person)',
  markSrc.includes("'whatsapp'") &&
  markSrc.includes("'email'") &&
  markSrc.includes("'print'") &&
  markSrc.includes("'in-person'"));
assert('Calls useMarkBillSent with channel + recipientInfo + notes',
  /useMarkBillSent[\s\S]{0,500}channel,\s*notes:[\s\S]{0,80}recipientInfo:/.test(markSrc));
assert('Explains: records, does not trigger transmission',
  /doesn['"]?t trigger|records that you|record the act/i.test(markSrc));

// ═══════════════════════════════════════════════
// Route wiring
// ═══════════════════════════════════════════════
console.log('\n--- Route wiring ---');
const appSrc = read('App.jsx');
assert('App lazy-imports BillsList',
  /BillsList\s*=\s*lazy\(.*BillsList\.jsx/.test(appSrc));
assert('App lazy-imports BillDetail',
  /BillDetail\s*=\s*lazy\(.*BillDetail\.jsx/.test(appSrc));
assert('/bills route → BillsList',
  /<Route\s+path=['"]\/bills['"]\s+element=\{<BillsList\s*\/>}/.test(appSrc));
assert('/bills/:billId route → BillDetail',
  /<Route\s+path=['"]\/bills\/:billId['"]\s+element=\{<BillDetail\s*\/>}/.test(appSrc));
assert('/bills no longer goes to Placeholder',
  !/path=['"]\/bills['"][^>]*Placeholder\s+title=['"]Bills['"]/.test(appSrc));

// ═══════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════
console.log('\n═══════════════════════════════════════');
console.log(`📊 Section E: ${pass}/${pass + fail} passed`);
if (failures.length > 0) {
  console.log('\nFailures:');
  failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
}
process.exit(fail === 0 ? 0 : 1);
