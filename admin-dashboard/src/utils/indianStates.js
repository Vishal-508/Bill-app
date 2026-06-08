/**
 * Indian States + Union Territories with GSTIN state codes.
 * GSTIN's first 2 digits are the state code, so this table powers
 * both the State dropdown AND auto-derivation from a typed GSTIN.
 *
 * Codes confirmed against GSTN documentation (CBIC).
 */
export const INDIAN_STATES = [
  { code: '01', short: 'JK', name: 'Jammu & Kashmir' },
  { code: '02', short: 'HP', name: 'Himachal Pradesh' },
  { code: '03', short: 'PB', name: 'Punjab' },
  { code: '04', short: 'CH', name: 'Chandigarh' },
  { code: '05', short: 'UK', name: 'Uttarakhand' },
  { code: '06', short: 'HR', name: 'Haryana' },
  { code: '07', short: 'DL', name: 'Delhi' },
  { code: '08', short: 'RJ', name: 'Rajasthan' },
  { code: '09', short: 'UP', name: 'Uttar Pradesh' },
  { code: '10', short: 'BR', name: 'Bihar' },
  { code: '11', short: 'SK', name: 'Sikkim' },
  { code: '12', short: 'AR', name: 'Arunachal Pradesh' },
  { code: '13', short: 'NL', name: 'Nagaland' },
  { code: '14', short: 'MN', name: 'Manipur' },
  { code: '15', short: 'MZ', name: 'Mizoram' },
  { code: '16', short: 'TR', name: 'Tripura' },
  { code: '17', short: 'ML', name: 'Meghalaya' },
  { code: '18', short: 'AS', name: 'Assam' },
  { code: '19', short: 'WB', name: 'West Bengal' },
  { code: '20', short: 'JH', name: 'Jharkhand' },
  { code: '21', short: 'OD', name: 'Odisha' },
  { code: '22', short: 'CG', name: 'Chhattisgarh' },
  { code: '23', short: 'MP', name: 'Madhya Pradesh' },
  { code: '24', short: 'GJ', name: 'Gujarat' },
  { code: '25', short: 'DD', name: 'Daman & Diu' },
  { code: '26', short: 'DN', name: 'Dadra & Nagar Haveli' },
  { code: '27', short: 'MH', name: 'Maharashtra' },
  { code: '28', short: 'AP', name: 'Andhra Pradesh (Old)' },
  { code: '29', short: 'KA', name: 'Karnataka' },
  { code: '30', short: 'GA', name: 'Goa' },
  { code: '31', short: 'LD', name: 'Lakshadweep' },
  { code: '32', short: 'KL', name: 'Kerala' },
  { code: '33', short: 'TN', name: 'Tamil Nadu' },
  { code: '34', short: 'PY', name: 'Puducherry' },
  { code: '35', short: 'AN', name: 'Andaman & Nicobar Islands' },
  { code: '36', short: 'TG', name: 'Telangana' },
  { code: '37', short: 'AP', name: 'Andhra Pradesh' },
  { code: '38', short: 'LA', name: 'Ladakh' },
];

const _byCode = new Map(INDIAN_STATES.map(s => [s.code, s]));
const _byName = new Map(INDIAN_STATES.map(s => [s.name.toLowerCase(), s]));

export function getStateByCode(code) {
  if (!code) return null;
  return _byCode.get(String(code).padStart(2, '0')) || null;
}

export function getStateByName(name) {
  if (!name) return null;
  return _byName.get(String(name).trim().toLowerCase()) || null;
}

/**
 * Derive the Indian state from a GSTIN. GSTIN format is
 * `<2-digit-state-code><10-PAN><1-entity><Z><1-checksum>` — so the
 * first 2 chars are always the state. Returns null on too-short
 * input or unknown code (no throw — caller decides the UX).
 */
export function deriveStateFromGstin(gstin) {
  if (!gstin || typeof gstin !== 'string') return null;
  const trimmed = gstin.trim();
  if (trimmed.length < 2) return null;
  return getStateByCode(trimmed.slice(0, 2));
}
