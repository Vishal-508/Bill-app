// Section B smoke — file structure + exports + CSV helper logic +
// column-def shape. UI rendering verified separately in the browser.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, '..', 'src');

const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(SRC, rel));

let pass = 0, fail = 0;
const failures = [];
function assert(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); failures.push(name); }
}

// CSV helper is pure JS — Node can import & exercise directly
const csv = await import('../src/utils/csvExport.js');

console.log('\n═══ Section B — Customers List Page Smoke ═══');

// ═══════════════════════════════════════════════
// File structure
// ═══════════════════════════════════════════════
console.log('\n--- File structure ---');
const FILES = [
  'pages/customers/CustomersList.jsx',
  'pages/customers/CustomerFilters.jsx',
  'pages/customers/CustomerFormModal.jsx',
  'pages/customers/_customerColumns.jsx',
  'utils/csvExport.js',
  'components/ui/PageHeader.jsx',
];
for (const f of FILES) assert(`${f} exists`, exists(f));

// ═══════════════════════════════════════════════
// CSV export — pure logic
// ═══════════════════════════════════════════════
console.log('\n--- exportToCsv logic ---');
const { exportToCsv, _internals } = csv;
const { escapeCell, getCell } = _internals;

// Cell escaping
assert('escapeCell plain string passes through', escapeCell('hello') === 'hello');
assert('escapeCell null → empty', escapeCell(null) === '');
assert('escapeCell undefined → empty', escapeCell(undefined) === '');
assert('escapeCell wraps comma-containing values in quotes',
  escapeCell('Mumbai, MH') === '"Mumbai, MH"');
assert('escapeCell escapes inner quotes by doubling',
  escapeCell('She said "hi"') === '"She said ""hi"""');
assert('escapeCell wraps newline-containing values',
  escapeCell('line1\nline2') === '"line1\nline2"');
assert('escapeCell handles numbers', escapeCell(42) === '42');
assert('escapeCell handles booleans', escapeCell(true) === 'true');
// Objects → JSON.stringify → quoted content needs CSV-escaping too,
// so the result is the wrapped form with doubled quotes.
assert('escapeCell stringifies + escapes object content',
  escapeCell({ x: 1 }) === '"{""x"":1}"');
assert('escapeCell converts Date → ISO',
  /^\d{4}-\d{2}-\d{2}T/.test(escapeCell(new Date('2026-01-15T10:00:00Z'))));

// Dot-path cell extraction
assert('getCell flat field', getCell({ name: 'A' }, 'name') === 'A');
assert('getCell dot-path resolves',
  getCell({ a: { b: { c: 'deep' } } }, 'a.b.c') === 'deep');
assert('getCell missing intermediate → undefined',
  getCell({ a: {} }, 'a.b.c') === undefined);

// Full CSV generation (Node mode — returns {csv, rowCount})
const rows = [
  { customerName: 'Alpha, Co.', phone: '9876543210', billingAddress: { city: 'Mumbai' } },
  { customerName: 'Beta', phone: '9123456780', billingAddress: { city: 'Pune' } },
];
const out = exportToCsv(rows, 'test', ['customerName', 'phone', 'billingAddress.city']);
assert('exportToCsv returns object in Node (no window)',
  typeof out === 'object' && typeof out.csv === 'string');
assert('CSV contains the BOM marker for Excel UTF-8',
  out.csv.charCodeAt(0) === 0xFEFF);
assert('CSV has header + 2 data rows',
  out.rowCount === 2 && out.csv.split('\r\n').length === 3);
assert('CSV escapes the comma in "Alpha, Co."',
  out.csv.includes('"Alpha, Co."'));
assert('CSV uses dot-path for nested billingAddress.city',
  out.csv.includes('Mumbai') && out.csv.includes('Pune'));

// Empty data
const emptyOut = exportToCsv([], 'test', ['name']);
assert('Empty data → returns 0 (no crash)', emptyOut === 0);

// ═══════════════════════════════════════════════
// Customer columns + row actions
// ═══════════════════════════════════════════════
console.log('\n--- Customer columns + actions ---');
const colsSrc = read('pages/customers/_customerColumns.jsx');
assert('customerColumns export present',
  /export\s+function\s+customerColumns/.test(colsSrc));
assert('customerRowActions export present',
  /export\s+function\s+customerRowActions/.test(colsSrc));
assert('Phone column uses formatPhone',
  colsSrc.includes('formatPhone'));
assert('Status column renders Badge',
  /<Badge/.test(colsSrc) && colsSrc.includes("isActive ? 'Active'"));
assert('billType column derives from gstin (no fake field)',
  /id:\s*['"]billType['"][\s\S]{0,300}!!row\.original\.gstin/.test(colsSrc));
assert('createdAt column has enableSorting',
  /accessorKey:\s*['"]createdAt['"][\s\S]{0,200}enableSorting:\s*true/.test(colsSrc));
assert('Location column reads billingAddress.city + state',
  colsSrc.includes('billingAddress') && colsSrc.includes('city'));
assert('Delete row action has variant: danger',
  /label:\s*['"]Deactivate['"][\s\S]{0,200}variant:\s*['"]danger['"]/.test(colsSrc));
assert('Delete row action has condition (only for active rows)',
  /condition:[\s\S]{0,100}row\.isActive/.test(colsSrc));

// ═══════════════════════════════════════════════
// CustomersList — wiring
// ═══════════════════════════════════════════════
console.log('\n--- CustomersList wiring ---');
const listSrc = read('pages/customers/CustomersList.jsx');
assert('Imports useCustomersList', listSrc.includes('useCustomersList'));
assert('Imports DataTable', listSrc.includes('DataTable'));
assert('Uses useDebounce for search',
  listSrc.includes('useDebounce'));
assert('Translates sortBy/sortOrder → backend sort=-field format',
  /sort:\s*`\$\{[^}]*sortOrder/.test(listSrc) ||
  /sort:\s*`\$\{[^`]*\?\s*'-'\s*:\s*''\}\$\{[^`]*\}`/.test(listSrc));
// `pagination?.totalRecords` contains the substring `pagination?.total`
// — use a word-boundary regex that won't match when followed by an
// identifier char like "R" (totalRecords).
assert('Reads pagination.totalRecords (NOT pagination.total)',
  listSrc.includes('pagination?.totalRecords') &&
  !/pagination\?\.total(?![A-Za-z])/.test(listSrc));
// hasGstin may legitimately appear in JSDoc explaining the rename;
// only flag if it's used as an actual identifier (after `.`, `=`, or
// as an object key).
assert('Uses hasGST (NOT hasGstin) as identifier',
  /\bhasGST\b/.test(listSrc) &&
  !/[.=]\s*hasGstin\b|\bhasGstin\s*:|\bhasGstin\s*=/.test(listSrc));
assert('updateMutation hoisted at top-level (not inside handler)',
  /const\s+updateMutation\s*=\s*useUpdateCustomer\(\)/.test(listSrc));
assert('Soft-delete includes a reason in body',
  /body:\s*\{\s*reason:/.test(listSrc));
// Backend's bulkUpdateSchema expects { customerIds, updates } —
// NOT { ids, update }. Caught in browser as "Validation failed".
assert('Bulk update payload uses { customerIds, updates } shape',
  /customerIds:[\s\S]{0,120}updates:\s*\{\s*isActive/.test(listSrc));
assert('Inactive-toggle banner present (Bug 2 fix)',
  /Show all \(including inactive\)/.test(listSrc));
const colsSrc2 = read('pages/customers/_customerColumns.jsx');
assert('Symmetric Activate row action (Bug 3 fix)',
  /label:\s*['"]Activate['"][\s\S]{0,200}condition:[\s\S]{0,80}!row\.isActive/.test(colsSrc2));
assert('emptyState icon passed as ELEMENT (element-prop convention)',
  /icon:\s*<Users\b/.test(listSrc));
assert('Row click navigates to /customers/:id',
  /navigate\(`\/customers\/\$\{[^}]+\._id\}`\)/.test(listSrc));

// ═══════════════════════════════════════════════
// App.jsx route wiring
// ═══════════════════════════════════════════════
console.log('\n--- Route wiring ---');
const appSrc = read('App.jsx');
assert('CustomersList lazy-imported in App',
  appSrc.includes("import('./pages/customers/CustomersList.jsx')"));
assert('/customers route bound to <CustomersList />',
  /path=['"]\/customers['"]\s+element=\{<CustomersList\s*\/>/.test(appSrc));
assert('/customers no longer goes to Placeholder',
  !/path=['"]\/customers['"][\s\S]{0,80}Placeholder\s+title=['"]Customers['"]/.test(appSrc));

// ═══════════════════════════════════════════════
// PageHeader + barrel
// ═══════════════════════════════════════════════
console.log('\n--- PageHeader ---');
const phSrc = read('components/ui/PageHeader.jsx');
assert('PageHeader exports a named function',
  /export\s+function\s+PageHeader/.test(phSrc));
const barrelSrc = read('components/ui/index.js');
assert('UI barrel re-exports PageHeader',
  barrelSrc.includes("export { PageHeader }"));

// ═══════════════════════════════════════════════
// CustomerFilters
// ═══════════════════════════════════════════════
console.log('\n--- CustomerFilters ---');
const filtersSrc = read('pages/customers/CustomerFilters.jsx');
assert('Filters expose hasGST (not billType)',
  filtersSrc.includes('hasGST') && !/['"]billType['"]/.test(filtersSrc));
assert('Filters expose state + isActive + size selects',
  filtersSrc.includes("'state'") && filtersSrc.includes("'isActive'") && filtersSrc.includes("'size'"));
assert('Apply + Reset buttons present',
  /onClick=\{handleApply\}/.test(filtersSrc) && /onClick=\{handleReset\}/.test(filtersSrc));

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
