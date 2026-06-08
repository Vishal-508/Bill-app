// Section C smoke — customerSchema unit tests + indianStates helpers
// + component-file structural checks. Full RHF rendering is left to
// manual browser verification per the spec.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, '..', 'src');

const { customerSchema, addressFieldsSchema, _patterns } =
  await import('../src/utils/validators.js');
const {
  INDIAN_STATES, getStateByCode, getStateByName, deriveStateFromGstin,
} = await import('../src/utils/indianStates.js');

let pass = 0, fail = 0;
const failures = [];
function assert(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); failures.push(name); }
}
function read(rel) { return fs.readFileSync(path.join(SRC, rel), 'utf8'); }
function exists(rel) { return fs.existsSync(path.join(SRC, rel)); }

console.log('\n═══ Section C — Customer Form Modal Smoke ═══');

// ═══════════════════════════════════════════════
// File structure
// ═══════════════════════════════════════════════
console.log('\n--- File structure ---');
assert('pages/customers/CustomerFormModal.jsx exists',
  exists('pages/customers/CustomerFormModal.jsx'));
assert('components/forms/AddressFields.jsx exists',
  exists('components/forms/AddressFields.jsx'));
assert('utils/indianStates.js exists', exists('utils/indianStates.js'));
assert('customerSchema present in validators',
  /export const customerSchema/.test(read('utils/validators.js')));

// ═══════════════════════════════════════════════
// indianStates helpers
// ═══════════════════════════════════════════════
console.log('\n--- indianStates ---');
assert('INDIAN_STATES has 28+ entries (states + UTs)',
  INDIAN_STATES.length >= 28);
assert('Every entry has 2-digit numeric code',
  INDIAN_STATES.every(s => /^\d{2}$/.test(s.code)));
assert('Every entry has a name + short code',
  INDIAN_STATES.every(s => typeof s.name === 'string' && s.name.length > 0
    && typeof s.short === 'string' && s.short.length === 2));
assert('getStateByCode("27") → Maharashtra',
  getStateByCode('27')?.name === 'Maharashtra');
assert('getStateByCode("7") padded to "07" → Delhi',
  getStateByCode('7')?.name === 'Delhi');
assert('getStateByCode("99") → null (unknown)',
  getStateByCode('99') === null);
assert('getStateByName case-insensitive',
  getStateByName('maharashtra')?.code === '27' &&
  getStateByName('MAHARASHTRA')?.code === '27');
assert('deriveStateFromGstin("27ABCDE1234F1Z5") → Maharashtra',
  deriveStateFromGstin('27ABCDE1234F1Z5')?.name === 'Maharashtra');
assert('deriveStateFromGstin("XX") → null',
  deriveStateFromGstin('XX') === null);
assert('deriveStateFromGstin("") → null (empty)',
  deriveStateFromGstin('') === null);
assert('deriveStateFromGstin(null) → null (safe)',
  deriveStateFromGstin(null) === null);

// ═══════════════════════════════════════════════
// customerSchema
// ═══════════════════════════════════════════════
console.log('\n--- customerSchema validation ---');

// Build a known-good NON_GST input
const baseAddress = {
  line1: 'Plot 12, MIDC',
  line2: '',
  city: 'Pune',
  state: 'Maharashtra',
  stateCode: '27',
  pincode: '411001',
};
const okNonGst = {
  customerName: 'Acme Cuts',
  companyName: '',
  phone: '9876543210',
  altPhone: '',
  email: '',
  billType: 'NON_GST',
  gstin: '',
  billingAddress: baseAddress,
  creditLimit: 0,
  notes: '',
};
assert('Valid NON_GST input parses', customerSchema.safeParse(okNonGst).success);

// customerName too short
const shortName = { ...okNonGst, customerName: 'A' };
assert('customerName < 2 chars rejected',
  !customerSchema.safeParse(shortName).success);

// Bad phone
const badPhone = { ...okNonGst, phone: '1234567890' };
assert('Phone not starting [6-9] rejected',
  !customerSchema.safeParse(badPhone).success);

// Good email when provided
const withEmail = { ...okNonGst, email: 'a@b.co' };
assert('Valid email accepted', customerSchema.safeParse(withEmail).success);

// Bad email
const badEmail = { ...okNonGst, email: 'not-an-email' };
assert('Invalid email format rejected',
  !customerSchema.safeParse(badEmail).success);

// Pincode 5 digits → reject
const badPincode = {
  ...okNonGst,
  billingAddress: { ...baseAddress, pincode: '40010' },
};
assert('5-digit pincode rejected',
  !customerSchema.safeParse(badPincode).success);

// stateCode non-2-digit → reject
const badStateCode = {
  ...okNonGst,
  billingAddress: { ...baseAddress, stateCode: '7' },
};
assert('1-digit state code rejected',
  !customerSchema.safeParse(badStateCode).success);

// GST WITHOUT gstin → reject
const gstMissingGstin = { ...okNonGst, billType: 'GST', gstin: '' };
const gstMissingResult = customerSchema.safeParse(gstMissingGstin);
assert('billType=GST with empty gstin rejected',
  !gstMissingResult.success);
if (!gstMissingResult.success) {
  const msg = gstMissingResult.error.issues.find(i => i.path.includes('gstin'))?.message;
  assert('GST-required error mentions GSTIN', /GSTIN/i.test(msg || ''));
}

// GST WITH bad gstin format → reject
const gstBadFormat = { ...okNonGst, billType: 'GST', gstin: 'not-a-gstin' };
assert('billType=GST with bad GSTIN format rejected',
  !customerSchema.safeParse(gstBadFormat).success);

// GST with valid GSTIN → pass
const gstValid = { ...okNonGst, billType: 'GST', gstin: '27ABCDE1234F1Z5' };
assert('billType=GST with valid GSTIN accepted',
  customerSchema.safeParse(gstValid).success);

// NON_GST with empty gstin → pass (gstin is optional when non-GST)
assert('NON_GST with empty gstin accepted',
  customerSchema.safeParse(okNonGst).success);

// Notes > 500 chars → reject
const longNotes = { ...okNonGst, notes: 'x'.repeat(501) };
assert('Notes > 500 chars rejected',
  !customerSchema.safeParse(longNotes).success);

// Negative credit limit → reject
const negCredit = { ...okNonGst, creditLimit: -1 };
assert('Negative creditLimit rejected',
  !customerSchema.safeParse(negCredit).success);

// String creditLimit → coerced to number
const stringCredit = { ...okNonGst, creditLimit: '50000' };
const stringCreditResult = customerSchema.safeParse(stringCredit);
assert('String creditLimit coerced via z.coerce.number',
  stringCreditResult.success && stringCreditResult.data.creditLimit === 50000);

// addressFieldsSchema is exported + usable standalone
assert('addressFieldsSchema parses standalone address',
  addressFieldsSchema.safeParse(baseAddress).success);

// _patterns regexes exported for component-level UX
assert('_patterns exports phoneRegex + gstinRegex',
  _patterns.phoneRegex instanceof RegExp && _patterns.gstinRegex instanceof RegExp);

// ═══════════════════════════════════════════════
// Component file content
// ═══════════════════════════════════════════════
console.log('\n--- Component file content ---');
const formSrc = read('pages/customers/CustomerFormModal.jsx');
assert('CustomerFormModal exports default function',
  /export default function CustomerFormModal/.test(formSrc));
assert('Uses zodResolver + customerSchema',
  formSrc.includes('zodResolver') && formSrc.includes('customerSchema'));
assert('Uses useCreateCustomer + useUpdateCustomer hooks',
  formSrc.includes('useCreateCustomer') && formSrc.includes('useUpdateCustomer'));
assert('Drops billType before sending to API',
  /billType:\s*_bt[\s\S]{0,60}\.\.\.payload/.test(formSrc) ||
  /billType[\s\S]{0,60}\.\.\.payload/.test(formSrc));
assert('GSTIN field is conditional on billType==="GST"',
  /billType === ['"]GST['"][\s\S]{0,400}label=['"]GSTIN['"]/.test(formSrc));
assert('Pre-fills via buildDefaults(customer) for edit mode',
  /buildDefaults\(customer\)/.test(formSrc));
assert('Confirms before discarding dirty form',
  /isDirty[\s\S]{0,80}window\.confirm/.test(formSrc));
assert('Auto-derives state from GSTIN via deriveStateFromGstin',
  formSrc.includes('deriveStateFromGstin'));

// AddressFields component
const addrSrc = read('components/forms/AddressFields.jsx');
assert('AddressFields default-exports a function',
  /export default function AddressFields/.test(addrSrc));
assert('AddressFields uses nested field paths via prefix',
  /register\(`\$\{prefix\}\.line1`\)/.test(addrSrc));
assert('AddressFields locks stateCode when stateCodeLocked',
  /stateCodeLocked/.test(addrSrc) && /readOnly=\{stateCodeLocked\}/.test(addrSrc));
assert('AddressFields auto-fills stateCode on state change',
  /setValue\(`\$\{prefix\}\.stateCode`,\s*match\.code/.test(addrSrc));

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
