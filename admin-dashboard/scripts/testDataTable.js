// Section C smoke — pure-function tests for DataTable styling + paginator
// math, plus file-structure verification. JSX rendering is left for
// Sections D (browser routing) and E (login form exercise).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHARED_DIR = path.join(__dirname, '..', 'src', 'components', 'shared');
const HOOKS_DIR  = path.join(__dirname, '..', 'src', 'hooks');

const styles = await import('../src/components/shared/_dataTableStyles.js');

let pass = 0, fail = 0;
const failures = [];
function assert(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); failures.push(name); }
}

console.log('\n═══ Section C — DataTable Smoke Test ═══');

// ═══════════════════════════════════════════════
// getColumnAlignment
// ═══════════════════════════════════════════════
console.log('\n--- getColumnAlignment ---');
const { getColumnAlignment } = styles;
assert('right → "text-right"',
  getColumnAlignment({ meta: { align: 'right' } }) === 'text-right');
assert('center → "text-center"',
  getColumnAlignment({ meta: { align: 'center' } }) === 'text-center');
assert('left → "text-left"',
  getColumnAlignment({ meta: { align: 'left' } }) === 'text-left');
assert('no meta → "text-left" (default)',
  getColumnAlignment({}) === 'text-left');
assert('undefined column → "text-left"',
  getColumnAlignment(undefined) === 'text-left');

// ═══════════════════════════════════════════════
// getCellPadding
// ═══════════════════════════════════════════════
console.log('\n--- getCellPadding ---');
const { getCellPadding } = styles;
assert('compact → "px-3 py-1.5"',
  getCellPadding('compact') === 'px-3 py-1.5');
assert('normal → "px-4 py-3"',
  getCellPadding('normal') === 'px-4 py-3');
assert('spacious → "px-5 py-4"',
  getCellPadding('spacious') === 'px-5 py-4');
assert('default (undefined) → normal',
  getCellPadding() === 'px-4 py-3');
assert('unknown density → normal (fallback)',
  getCellPadding('mega-spacious') === 'px-4 py-3');

// ═══════════════════════════════════════════════
// getSortIcon
// ═══════════════════════════════════════════════
console.log('\n--- getSortIcon ---');
const { getSortIcon } = styles;
assert('undefined sortState → "none"',
  getSortIcon(undefined) === 'none');
assert('null sortState → "none"',
  getSortIcon(null) === 'none');
assert('{ desc: false } → "asc"',
  getSortIcon({ id: 'name', desc: false }) === 'asc');
assert('{ desc: true } → "desc"',
  getSortIcon({ id: 'name', desc: true }) === 'desc');

// ═══════════════════════════════════════════════
// getPaginationNumbers
// ═══════════════════════════════════════════════
console.log('\n--- getPaginationNumbers ---');
const { getPaginationNumbers } = styles;
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

assert('(1, 1) → [1]',
  eq(getPaginationNumbers(1, 1), [1]));
assert('(1, 3) → [1, 2, 3] (small range, no ellipsis)',
  eq(getPaginationNumbers(1, 3), [1, 2, 3]));
assert('(2, 7) → [1..7] (exactly at threshold)',
  eq(getPaginationNumbers(2, 7), [1, 2, 3, 4, 5, 6, 7]));
assert('(1, 20) → [1, 2, 3, 4, 5, …, 20] (near start)',
  eq(getPaginationNumbers(1, 20), [1, 2, 3, 4, 5, '…', 20]));
assert('(3, 20) → near-start window includes current',
  eq(getPaginationNumbers(3, 20), [1, 2, 3, 4, 5, '…', 20]));
assert('(5, 20) → [1, …, 4, 5, 6, …, 20] (middle)',
  eq(getPaginationNumbers(5, 20), [1, '…', 4, 5, 6, '…', 20]));
assert('(10, 20) → [1, …, 9, 10, 11, …, 20]',
  eq(getPaginationNumbers(10, 20), [1, '…', 9, 10, 11, '…', 20]));
assert('(18, 20) → [1, …, 16, 17, 18, 19, 20] (near end)',
  eq(getPaginationNumbers(18, 20), [1, '…', 16, 17, 18, 19, 20]));
assert('(20, 20) → end-anchored window',
  eq(getPaginationNumbers(20, 20), [1, '…', 16, 17, 18, 19, 20]));
assert('Clamps invalid currentPage (0) to 1',
  eq(getPaginationNumbers(0, 20), [1, 2, 3, 4, 5, '…', 20]));
assert('Clamps invalid currentPage (50, totalPages=20) to 20',
  eq(getPaginationNumbers(50, 20), [1, '…', 16, 17, 18, 19, 20]));

// ═══════════════════════════════════════════════
// getPageRange
// ═══════════════════════════════════════════════
console.log('\n--- getPageRange ---');
const { getPageRange } = styles;
const r1 = getPageRange(1, 20, 245);
assert('Page 1, limit 20, total 245 → from=1 to=20',
  r1.from === 1 && r1.to === 20 && r1.total === 245,
  JSON.stringify(r1));
const r2 = getPageRange(3, 20, 245);
assert('Page 3, limit 20, total 245 → from=41 to=60',
  r2.from === 41 && r2.to === 60);
const r3 = getPageRange(13, 20, 245);
assert('Page 13, limit 20, total 245 → from=241 to=245 (last page partial)',
  r3.from === 241 && r3.to === 245);
const r4 = getPageRange(1, 20, 0);
assert('Total 0 → from=0 to=0 (empty result)',
  r4.from === 0 && r4.to === 0 && r4.total === 0);

// ═══════════════════════════════════════════════
// File structure
// ═══════════════════════════════════════════════
console.log('\n--- File structure ---');
const EXPECTED = [
  'DataTable.jsx',
  'DataTablePagination.jsx',
  'DataTableToolbar.jsx',
  'DataTableSkeleton.jsx',
  '_dataTableStyles.js',
  'index.js',
];
for (const f of EXPECTED) {
  assert(`${f} exists`, fs.existsSync(path.join(SHARED_DIR, f)));
}
assert('hooks/useDebounce.js exists',
  fs.existsSync(path.join(HOOKS_DIR, 'useDebounce.js')));

// ═══════════════════════════════════════════════
// Exports + barrel
// ═══════════════════════════════════════════════
console.log('\n--- Exports + barrel ---');
const NAMED_COMPONENTS = [
  'DataTable', 'DataTablePagination', 'DataTableToolbar', 'DataTableSkeleton',
];
for (const name of NAMED_COMPONENTS) {
  const src = fs.readFileSync(path.join(SHARED_DIR, `${name}.jsx`), 'utf8');
  assert(`${name}.jsx exports named "${name}"`,
    new RegExp(`export function ${name}\\b`).test(src));
}

const barrelSrc = fs.readFileSync(path.join(SHARED_DIR, 'index.js'), 'utf8');
for (const name of NAMED_COMPONENTS) {
  assert(`Barrel re-exports ${name}`, barrelSrc.includes(`{ ${name} }`));
}

// ═══════════════════════════════════════════════
// useDebounce — structural check (can't easily run a React hook in
// Node without renderer; just verify the file shape).
// ═══════════════════════════════════════════════
console.log('\n--- useDebounce hook ---');
const debounceSrc = fs.readFileSync(path.join(HOOKS_DIR, 'useDebounce.js'), 'utf8');
assert('useDebounce.js exports named "useDebounce"',
  /export function useDebounce\b/.test(debounceSrc));
assert('useDebounce uses setTimeout',
  debounceSrc.includes('setTimeout'));
assert('useDebounce returns cleanup (clearTimeout)',
  debounceSrc.includes('clearTimeout'));

// ═══════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════
console.log('\n═══════════════════════════════════════');
console.log(`📊 Section C DataTable: ${pass}/${pass + fail} passed`);
if (failures.length > 0) {
  console.log('\nFailures:');
  failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
}
process.exit(fail === 0 ? 0 : 1);
