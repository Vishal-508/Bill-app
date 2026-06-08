// Section E smoke — productSchema unit tests + stock-badge helper +
// MAPE-badge helper + file-structure / wiring checks. Live backend
// CRUD for products is exercised by Section F's E2E in the next step.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, '..', 'src');

const { productSchema } = await import('../src/utils/productValidators.js');

let pass = 0, fail = 0;
const failures = [];
function assert(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); failures.push(name); }
}
function read(rel) { return fs.readFileSync(path.join(SRC, rel), 'utf8'); }
function exists(rel) { return fs.existsSync(path.join(SRC, rel)); }

console.log('\n═══ Section E — Products Module Smoke ═══');

// ═══════════════════════════════════════════════
// File structure
// ═══════════════════════════════════════════════
console.log('\n--- File structure ---');
const FILES = [
  'pages/products/ProductsList.jsx',
  'pages/products/ProductFilters.jsx',
  'pages/products/ProductFormModal.jsx',
  'pages/products/ProductDetail.jsx',
  'pages/products/ProductHeader.jsx',
  'pages/products/ProductTabs.jsx',
  'pages/products/_productColumns.jsx',
  'pages/products/tabs/SpecificationsTab.jsx',
  'pages/products/tabs/StockMovementsTab.jsx',
  'pages/products/tabs/ForecastTab.jsx',
  'hooks/queries/useProductGrades.js',
  'utils/productValidators.js',
];
for (const f of FILES) assert(`${f} exists`, exists(f));

// ═══════════════════════════════════════════════
// productSchema (extracted into its own file)
// ═══════════════════════════════════════════════
console.log('\n--- productSchema validation ---');

const okProduct = {
  name: 'MDF 18mm Interior',
  thicknessMM: 18,
  lengthFT: 8,
  widthFT: 4,
  grade: '507f1f77bcf86cd799439011',
  pricingUnit: 'sqft',
  basePrice: 1200,
  currentStock: 50,
  minStockAlert: 10,
  reorderQuantity: 100,
  hsnCode: '4411',
  gstRatePct: 18,
};
assert('Valid product input parses', productSchema.safeParse(okProduct).success);

assert('name < 2 chars rejected',
  !productSchema.safeParse({ ...okProduct, name: 'A' }).success);
assert('thicknessMM < 0.1 rejected',
  !productSchema.safeParse({ ...okProduct, thicknessMM: 0.05 }).success);
assert('thicknessMM > 100 rejected',
  !productSchema.safeParse({ ...okProduct, thicknessMM: 150 }).success);
assert('Negative basePrice rejected',
  !productSchema.safeParse({ ...okProduct, basePrice: -1 }).success);
assert('Empty grade rejected',
  !productSchema.safeParse({ ...okProduct, grade: '' }).success);
assert('Invalid pricingUnit rejected',
  !productSchema.safeParse({ ...okProduct, pricingUnit: 'kg' }).success);
assert('gstRatePct > 100 rejected',
  !productSchema.safeParse({ ...okProduct, gstRatePct: 101 }).success);
assert('currentStock coerces string to number',
  productSchema.safeParse({ ...okProduct, currentStock: '50' }).success);
assert('Float currentStock rejected (integer-only)',
  !productSchema.safeParse({ ...okProduct, currentStock: 5.5 }).success);

// ═══════════════════════════════════════════════
// stockBadge helper
// ═══════════════════════════════════════════════
console.log('\n--- stockBadge helper ---');
const colsSrc = read('pages/products/_productColumns.jsx');
// stockBadge is a JSX file — read & eval the function source for tests
const stockBadgeFn = (() => {
  // Tiny inline eval: extract function body from source
  const match = colsSrc.match(/export function stockBadge[^{]*\{([\s\S]+?)\n\}/);
  if (!match) return null;
  // eslint-disable-next-line no-new-func
  return new Function('currentStock', 'minStockAlert', match[1]);
})();
if (!stockBadgeFn) {
  assert('stockBadge fn extracted from source', false, 'failed to parse');
} else {
  const out0 = stockBadgeFn(0, 10);
  assert('stock=0 → "Out of stock" / danger',
    out0.variant === 'danger' && /out of stock/i.test(out0.label));
  const outLow = stockBadgeFn(5, 10);
  assert('stock=5 ≤ min=10 → danger "Low: 5"',
    outLow.variant === 'danger' && outLow.label.includes('Low'));
  const outMid = stockBadgeFn(15, 10);
  assert('stock=15 (≤ 2×min=20) → warning',
    outMid.variant === 'warning' && outMid.label === '15');
  const outHigh = stockBadgeFn(50, 10);
  assert('stock=50 (> 2×min=20) → success',
    outHigh.variant === 'success' && outHigh.label === '50');
  const outNoMin = stockBadgeFn(100, 0);
  assert('min=0 + stock=100 → success (no min set)',
    outNoMin.variant === 'success');
}

// ═══════════════════════════════════════════════
// mapeBadge helper (ForecastTab)
// ═══════════════════════════════════════════════
console.log('\n--- mapeBadge helper ---');
const forecastSrc = read('pages/products/tabs/ForecastTab.jsx');
const mapeBadgeFn = (() => {
  const match = forecastSrc.match(/function mapeBadge\(mape\)\s*\{([\s\S]+?)\n\}/);
  if (!match) return null;
  return new Function('mape', match[1]);
})();
if (!mapeBadgeFn) {
  assert('mapeBadge fn extracted', false);
} else {
  assert('MAPE 5% → success', mapeBadgeFn(5).variant === 'success');
  assert('MAPE 15% → warning', mapeBadgeFn(15).variant === 'warning');
  assert('MAPE 30% → danger', mapeBadgeFn(30).variant === 'danger');
  assert('MAPE null → neutral', mapeBadgeFn(null).variant === 'neutral');
  assert('MAPE NaN → neutral', mapeBadgeFn(NaN).variant === 'neutral');
}

// ═══════════════════════════════════════════════
// ProductsList wiring
// ═══════════════════════════════════════════════
console.log('\n--- ProductsList ---');
const listSrc = read('pages/products/ProductsList.jsx');
assert('Imports useProductsList', listSrc.includes('useProductsList'));
assert('Uses useDebounce',          listSrc.includes('useDebounce'));
assert('Renders DataTable',          listSrc.includes('<DataTable'));
assert('Reads pagination.totalRecords',
  listSrc.includes('pagination?.totalRecords'));
assert('Translates sort → -field format (mongoose-style)',
  /sort:\s*sortBy/.test(listSrc) || /sortOrder === ['"]desc['"]/.test(listSrc));
assert('Soft delete includes reason in body',
  /body:\s*\{\s*reason:/.test(listSrc));
assert('Inactive-toggle banner present (matches Customer pattern)',
  /Show all \(including inactive\)/.test(listSrc));
assert('Element-prop icon convention for emptyState',
  /emptyState=\{[\s\S]{0,200}icon:\s*<Package/.test(listSrc));
// Bulk fix: products have no backend bulk endpoint → fan out via
// Promise.allSettled. Check the signals individually rather than
// pinning them in a tight character window (the function body is
// ~10 lines, far wider than any reasonable regex span).
assert('Bulk Activate/Deactivate handler exists',
  listSrc.includes('runBulkSetActive') && listSrc.includes('Promise.allSettled'));
assert('Bulk fan-out aggregates pass/fail counts',
  /filter\(r =>\s*r\.status === 'fulfilled'\)/.test(listSrc));
assert('DataTable receives bulkActions',
  /bulkActions=\{\[/.test(listSrc));
assert('bulkActions wires both Activate and Deactivate',
  /runBulkSetActive\(true\)/.test(listSrc) && /runBulkSetActive\(false\)/.test(listSrc));

// ═══════════════════════════════════════════════
// ProductFormModal wiring
// ═══════════════════════════════════════════════
console.log('\n--- ProductFormModal ---');
const formSrc = read('pages/products/ProductFormModal.jsx');
assert('Default-exports ProductFormModal',
  /export default function ProductFormModal/.test(formSrc));
assert('Uses zodResolver + productSchema',
  formSrc.includes('zodResolver') && formSrc.includes('productSchema'));
assert('Uses useCreateProduct + useUpdateProduct',
  formSrc.includes('useCreateProduct') && formSrc.includes('useUpdateProduct'));
assert('Grade dropdown sourced from useProductGrades',
  formSrc.includes('useProductGrades'));
assert('Auto-calculates areaSqFt from length × width',
  /lengthFT[\s\S]{0,50}widthFT/.test(formSrc) && /areaSqFt/.test(formSrc));
assert('SKU is immutable in edit mode (disabled)',
  /disabled=\{isSubmitting\s*\|\|\s*isEdit\}/.test(formSrc));
assert('Confirms before discarding dirty form',
  /isDirty[\s\S]{0,80}window\.confirm/.test(formSrc));

// ═══════════════════════════════════════════════
// ProductDetail wiring
// ═══════════════════════════════════════════════
console.log('\n--- ProductDetail ---');
const detailSrc = read('pages/products/ProductDetail.jsx');
assert('Reads :productId param',
  detailSrc.includes('useParams') && detailSrc.includes('productId'));
assert('Uses useProductDetail hook',
  detailSrc.includes('useProductDetail'));
assert('Edit opens ProductFormModal',
  detailSrc.includes('ProductFormModal'));
assert('Toggle uses useUpdateProduct with isActive payload',
  detailSrc.includes('isActive: next'));
assert('Back navigation prefers history (-1)',
  /navigate\(-1\)/.test(detailSrc));
assert('Inactive product gets a warning banner',
  /!product\.isActive[\s\S]{0,300}Alert\s+variant=['"]warning['"]/.test(detailSrc));

// ═══════════════════════════════════════════════
// Tabs
// ═══════════════════════════════════════════════
console.log('\n--- Product tabs ---');
const tabsSrc = read('pages/products/ProductTabs.jsx');
const tabsArrayMatch = tabsSrc.match(
  /const\s+TABS\s*=\s*\[\s*['"]specs['"]\s*,\s*['"]stock['"]\s*,\s*['"]forecast['"]\s*\]/
);
assert('Has 3 tabs (specs/stock/forecast)', !!tabsArrayMatch);
assert('Uses Headless UI Tab', tabsSrc.includes("from '@headlessui/react'"));
assert('Persists active tab in URL via useSearchParams',
  tabsSrc.includes('useSearchParams'));

const specSrc = read('pages/products/tabs/SpecificationsTab.jsx');
assert('Specifications tab shows thickness/length/width', /thicknessMM[\s\S]{0,200}lengthFT/.test(specSrc));
assert('Specifications tab shows grade + HSN', specSrc.includes('grade') && specSrc.includes('hsnCode'));

const stockSrc = read('pages/products/tabs/StockMovementsTab.jsx');
assert('StockMovementsTab fetches /stock-movements?product=:id',
  stockSrc.includes("'/stock-movements'") && stockSrc.includes('product: productId'));

assert('ForecastTab imports POST /forecast/run/:id',
  forecastSrc.includes('/forecast/run/'));
assert('ForecastTab uses queryClient.invalidateQueries on recompute success',
  forecastSrc.includes('invalidateQueries'));
assert('ForecastTab renders MAPE badge with variant',
  forecastSrc.includes('mapeBadge'));

// ═══════════════════════════════════════════════
// Route wiring
// ═══════════════════════════════════════════════
console.log('\n--- Route wiring ---');
const appSrc = read('App.jsx');
assert('App lazy-imports ProductsList',
  /ProductsList\s*=\s*lazy\(.*ProductsList\.jsx/.test(appSrc));
assert('App lazy-imports ProductDetail',
  /ProductDetail\s*=\s*lazy\(.*ProductDetail\.jsx/.test(appSrc));
assert('/products route → ProductsList',
  /<Route\s+path=['"]\/products['"]\s+element=\{<ProductsList\s*\/>}/.test(appSrc));
assert('/products/:productId route → ProductDetail',
  /<Route\s+path=['"]\/products\/:productId['"]\s+element=\{<ProductDetail\s*\/>}/.test(appSrc));

// ═══════════════════════════════════════════════
// Backend validator fix applied
// ═══════════════════════════════════════════════
console.log('\n--- Backend validator ---');
const backendValidatorPath = path.join(__dirname, '..', '..', 'backend', 'src', 'validators', 'product.validator.js');
const backendValidatorSrc = fs.readFileSync(backendValidatorPath, 'utf8');
assert('Backend createProductSchema accepts isActive (Zod-strip fix)',
  /isActive:\s*z\.boolean\(\)\.optional\(\)/.test(backendValidatorSrc));

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
