// Section B smoke test — pure-JS verification of UI library:
//   1. cn() helper behavior
//   2. Variant → class string mappers (pure functions in _styles.js)
//   3. File existence + barrel completeness for all 13 components
// JSX files aren't directly importable in Node without a JSX loader,
// so component rendering is left for Section D (browser-level checks)
// and Section E (live login form exercise).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UI_DIR = path.join(__dirname, '..', 'src', 'components', 'ui');

const { cn } = await import('../src/utils/cn.js');
const styles = await import('../src/components/ui/_styles.js');

let pass = 0, fail = 0;
const failures = [];
function assert(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); failures.push(name); }
}

console.log('\n═══ Section B — UI Components Smoke Test ═══');

// ═══════════════════════════════════════════════
// cn() helper
// ═══════════════════════════════════════════════
console.log('\n--- cn() helper ---');
assert('cn("a", "b") → "a b"', cn('a', 'b') === 'a b');
assert('cn("a", null, "b") → "a b" (skips falsy)',
  cn('a', null, 'b') === 'a b');
assert('cn() → "" (no args)', cn() === '');
assert('cn({ "foo": true, "bar": false }) → "foo"',
  cn({ foo: true, bar: false }) === 'foo');
assert('cn("base", true && "active") → "base active"',
  cn('base', true && 'active') === 'base active');
assert('cn(["a", "b"]) → "a b" (arrays flatten)',
  cn(['a', 'b']) === 'a b');

// ═══════════════════════════════════════════════
// getButtonClasses
// ═══════════════════════════════════════════════
console.log('\n--- getButtonClasses ---');
const { getButtonClasses } = styles;
const btnPrimaryMd = getButtonClasses({ variant: 'primary', size: 'md' });
assert('primary md → includes "bg-primary-600"',
  btnPrimaryMd.includes('bg-primary-600'));
assert('primary md → includes h-10 (md height)',
  btnPrimaryMd.includes('h-10'));
assert('primary md → includes focus-visible:ring-primary-500',
  btnPrimaryMd.includes('focus-visible:ring-primary-500'));

const btnDangerSm = getButtonClasses({ variant: 'danger', size: 'sm' });
assert('danger sm → includes "bg-danger-600"',
  btnDangerSm.includes('bg-danger-600'));
assert('danger sm → includes h-8',
  btnDangerSm.includes('h-8'));

const btnGhostLg = getButtonClasses({ variant: 'ghost', size: 'lg' });
assert('ghost lg → includes "bg-transparent"',
  btnGhostLg.includes('bg-transparent'));
assert('ghost lg → includes h-12',
  btnGhostLg.includes('h-12'));

const btnOutline = getButtonClasses({ variant: 'outline' });
assert('outline → includes "border border-secondary-300"',
  btnOutline.includes('border-secondary-300'));

const btnFullWidth = getButtonClasses({ fullWidth: true });
assert('fullWidth: true → includes "w-full"',
  btnFullWidth.includes('w-full'));
assert('fullWidth omitted → no "w-full"',
  !getButtonClasses({}).includes('w-full'));

const btnUnknown = getButtonClasses({ variant: 'nonsense' });
assert('Unknown variant falls back to primary',
  btnUnknown.includes('bg-primary-600'));

// ═══════════════════════════════════════════════
// getBadgeClasses
// ═══════════════════════════════════════════════
console.log('\n--- getBadgeClasses ---');
const { getBadgeClasses } = styles;
assert('success badge has bg-success-100 + text-success-800',
  getBadgeClasses({ variant: 'success' }).includes('bg-success-100') &&
  getBadgeClasses({ variant: 'success' }).includes('text-success-800'));
assert('warning badge has bg-warning-100',
  getBadgeClasses({ variant: 'warning' }).includes('bg-warning-100'));
assert('danger badge has bg-danger-100',
  getBadgeClasses({ variant: 'danger' }).includes('bg-danger-100'));
assert('info badge has bg-info-100',
  getBadgeClasses({ variant: 'info' }).includes('bg-info-100'));
assert('neutral badge has bg-secondary-100 (default)',
  getBadgeClasses({}).includes('bg-secondary-100'));
assert('sm badge has px-2 py-0.5',
  getBadgeClasses({ size: 'sm' }).includes('px-2 py-0.5'));
assert('md badge has px-2.5 py-1',
  getBadgeClasses({ size: 'md' }).includes('px-2.5 py-1'));

// ═══════════════════════════════════════════════
// getAlertClasses
// ═══════════════════════════════════════════════
console.log('\n--- getAlertClasses ---');
const { getAlertClasses } = styles;
assert('info alert has bg-info-50 + border-info-300',
  getAlertClasses({ variant: 'info' }).includes('bg-info-50') &&
  getAlertClasses({ variant: 'info' }).includes('border-info-300'));
assert('success alert has bg-success-50',
  getAlertClasses({ variant: 'success' }).includes('bg-success-50'));
assert('warning alert has bg-warning-50',
  getAlertClasses({ variant: 'warning' }).includes('bg-warning-50'));
assert('error alert has bg-danger-50',
  getAlertClasses({ variant: 'error' }).includes('bg-danger-50'));
assert('All alert variants use border-l-4',
  ['info', 'success', 'warning', 'error']
    .every(v => getAlertClasses({ variant: v }).includes('border-l-4')));

// ═══════════════════════════════════════════════
// getInputClasses
// ═══════════════════════════════════════════════
console.log('\n--- getInputClasses ---');
const { getInputClasses } = styles;
assert('Default input has secondary-300 border',
  getInputClasses({}).includes('border-secondary-300'));
assert('Error state switches to danger border',
  getInputClasses({ error: true }).includes('border-danger-400'));
assert('Sm size → h-8', getInputClasses({ size: 'sm' }).includes('h-8'));
assert('Md size → h-10', getInputClasses({ size: 'md' }).includes('h-10'));
assert('Lg size → h-12 + text-base',
  getInputClasses({ size: 'lg' }).includes('h-12') &&
  getInputClasses({ size: 'lg' }).includes('text-base'));

// ═══════════════════════════════════════════════
// Spinner + Modal size mappers
// ═══════════════════════════════════════════════
console.log('\n--- Spinner + Modal mappers ---');
const { getSpinnerSizeClass, getSpinnerColorClass, getModalSizeClass } = styles;
assert('Spinner sm → h-4 w-4', getSpinnerSizeClass('sm') === 'h-4 w-4');
assert('Spinner md → h-5 w-5', getSpinnerSizeClass('md') === 'h-5 w-5');
assert('Spinner lg → h-8 w-8', getSpinnerSizeClass('lg') === 'h-8 w-8');
assert('Spinner white → text-white',
  getSpinnerColorClass('white') === 'text-white');
assert('Spinner default → text-primary-600',
  getSpinnerColorClass('primary') === 'text-primary-600');
assert('Modal sm → max-w-sm', getModalSizeClass('sm') === 'max-w-sm');
assert('Modal lg → max-w-2xl', getModalSizeClass('lg') === 'max-w-2xl');
assert('Modal full → max-w-[95vw]',
  getModalSizeClass('full') === 'max-w-[95vw]');

// ═══════════════════════════════════════════════
// File-structure check
// ═══════════════════════════════════════════════
console.log('\n--- File structure ---');
const EXPECTED_FILES = [
  'Button.jsx', 'Input.jsx', 'Select.jsx', 'Textarea.jsx',
  'Checkbox.jsx', 'Radio.jsx', 'Modal.jsx', 'Badge.jsx',
  'Card.jsx', 'Spinner.jsx', 'EmptyState.jsx', 'Alert.jsx', 'Tooltip.jsx',
];
for (const f of EXPECTED_FILES) {
  const p = path.join(UI_DIR, f);
  assert(`${f} exists`, fs.existsSync(p), p);
}
assert(`_styles.js exists`, fs.existsSync(path.join(UI_DIR, '_styles.js')));
assert(`index.js (barrel) exists`, fs.existsSync(path.join(UI_DIR, 'index.js')));

// ═══════════════════════════════════════════════
// Barrel completeness — every component file is re-exported
// ═══════════════════════════════════════════════
console.log('\n--- Barrel completeness ---');
const barrelSrc = fs.readFileSync(path.join(UI_DIR, 'index.js'), 'utf8');
for (const f of EXPECTED_FILES) {
  const name = f.replace('.jsx', '');
  assert(`Barrel re-exports ${name}`, barrelSrc.includes(`{ ${name} }`));
}

// ═══════════════════════════════════════════════
// Each component file has at least one named export matching its name
// ═══════════════════════════════════════════════
console.log('\n--- Component exports ---');
for (const f of EXPECTED_FILES) {
  const name = f.replace('.jsx', '');
  const src = fs.readFileSync(path.join(UI_DIR, f), 'utf8');
  // Match either "export function Foo" or "export const Foo"
  const hasNamedExport = new RegExp(
    `export (function|const) ${name}\\b`
  ).test(src);
  assert(`${name}.jsx exports named "${name}"`, hasNamedExport);
}

// ═══════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════
console.log('\n═══════════════════════════════════════');
console.log(`📊 Section B UI components: ${pass}/${pass + fail} passed`);
if (failures.length > 0) {
  console.log('\nFailures:');
  failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
}
process.exit(fail === 0 ? 0 : 1);
