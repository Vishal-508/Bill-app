/**
 * migrationHelpers.js (Prompt 9 Section D)
 *
 * Pure data-normalization utilities used by scripts/migrateExcel.js.
 * NO database access. NO file I/O (except date-fns lazily).
 *
 * Functions return cleanly normalized values OR null when input cannot
 * be coerced. Never throw — the migration script needs to keep processing
 * the next row even if this one is unrecognizable.
 */

const PHONE_REGEX = /^[6-9]\d{9}$/;
const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[0-9A-Z]{1}Z[0-9A-Z]{1}$/;
const PINCODE_REGEX = /^[1-9][0-9]{5}$/;

// State abbreviations + GST state codes commonly seen in MP-based business
const STATE_TABLE = {
  'andhra pradesh': { abbr: 'AP', code: '37' },
  'arunachal pradesh': { abbr: 'AR', code: '12' },
  'assam': { abbr: 'AS', code: '18' },
  'bihar': { abbr: 'BR', code: '10' },
  'chhattisgarh': { abbr: 'CG', code: '22' },
  'goa': { abbr: 'GA', code: '30' },
  'gujarat': { abbr: 'GJ', code: '24' },
  'haryana': { abbr: 'HR', code: '06' },
  'himachal pradesh': { abbr: 'HP', code: '02' },
  'jharkhand': { abbr: 'JH', code: '20' },
  'karnataka': { abbr: 'KA', code: '29' },
  'kerala': { abbr: 'KL', code: '32' },
  'madhya pradesh': { abbr: 'MP', code: '23' },
  'maharashtra': { abbr: 'MH', code: '27' },
  'manipur': { abbr: 'MN', code: '14' },
  'meghalaya': { abbr: 'ML', code: '17' },
  'mizoram': { abbr: 'MZ', code: '15' },
  'nagaland': { abbr: 'NL', code: '13' },
  'odisha': { abbr: 'OD', code: '21' },
  'punjab': { abbr: 'PB', code: '03' },
  'rajasthan': { abbr: 'RJ', code: '08' },
  'sikkim': { abbr: 'SK', code: '11' },
  'tamil nadu': { abbr: 'TN', code: '33' },
  'telangana': { abbr: 'TS', code: '36' },
  'tripura': { abbr: 'TR', code: '16' },
  'uttar pradesh': { abbr: 'UP', code: '09' },
  'uttarakhand': { abbr: 'UK', code: '05' },
  'west bengal': { abbr: 'WB', code: '19' },
  'delhi': { abbr: 'DL', code: '07' },
  'jammu and kashmir': { abbr: 'JK', code: '01' },
};

// ─── Phone ───

/**
 * Normalize an Indian mobile number.
 * - Strips non-digits → '+91 98765-43210' becomes '919876543210'
 * - Takes last 10 digits → drops country code prefix
 * - Validates against /^[6-9]\d{9}$/
 * Returns the 10-digit string or null when invalid.
 */
exports.normalizePhone = (raw) => {
  if (raw === null || raw === undefined) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length < 10) return null;
  const last10 = digits.slice(-10);
  if (!PHONE_REGEX.test(last10)) return null;
  return last10;
};

// ─── GSTIN ───

exports.normalizeGstin = (raw) => {
  if (raw === null || raw === undefined || raw === '') return null;
  const trimmed = String(raw).trim().toUpperCase();
  if (!GSTIN_REGEX.test(trimmed)) return null;
  return trimmed;
};

// ─── Date ───

/**
 * Parse a value from an Excel cell into a Date instance.
 * Accepts:
 *   - Date instance (when xlsx is read with cellDates: true)
 *   - ISO 8601 string
 *   - dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy
 *   - Excel serial number (days since 1900-01-00, 1900 leap-year bug
 *     compensated as long as the value > 60)
 * Returns Date instance or null.
 */
exports.normalizeDate = (raw) => {
  if (raw === null || raw === undefined || raw === '') return null;

  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? null : raw;
  }

  if (typeof raw === 'number') {
    // Excel serial. 1 = 1900-01-01 in Excel; but 1900 is incorrectly
    // treated as a leap year (1900-02-29 doesn't exist). Adjust serial
    // > 60 to account for the phantom day.
    if (!Number.isFinite(raw) || raw < 1) return null;
    const serial = raw > 60 ? raw - 1 : raw;
    const ms = (serial - 25569) * 86400 * 1000; // 25569 = 1970-01-01 in Excel
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const s = String(raw).trim();
  if (!s) return null;

  // ISO 8601 (or anything Date constructor parses naturally)
  const iso = new Date(s);
  if (!Number.isNaN(iso.getTime()) && /^\d{4}-\d{2}-\d{2}/.test(s)) {
    return iso;
  }

  // dd/mm/yyyy or dd-mm-yyyy or dd.mm.yyyy
  const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) {
    let [, dd, mm, yyyy] = m;
    if (yyyy.length === 2) yyyy = (parseInt(yyyy, 10) >= 50 ? '19' : '20') + yyyy;
    const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // Fallback: try Date.parse without strict format check
  const fallback = new Date(s);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
};

// ─── Money ───

/**
 * Strip currency symbols + thousands separators, return a number.
 * Examples:
 *   '₹ 12,345.67' → 12345.67
 *   'Rs 1,000'    → 1000
 *   '1500'        → 1500
 *   'free'        → null
 */
exports.normalizeMoney = (raw) => {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  // Strip everything except digits, dot (decimal), minus (negative).
  // Note: don't put '.' in a strip-list — that kills the decimal point.
  const cleaned = String(raw).replace(/[^\d.\-]/g, '');
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
};

// ─── Pincode ───

exports.normalizePincode = (raw) => {
  if (raw === null || raw === undefined || raw === '') return null;
  const s = String(raw).replace(/\D/g, '');
  if (!PINCODE_REGEX.test(s)) return null;
  return s;
};

// ─── Address ───

exports.normalizeAddress = (parts = {}) => {
  const out = {};
  if (parts.line1) out.addressLine1 = String(parts.line1).trim();
  if (parts.line2) out.addressLine2 = String(parts.line2).trim();
  if (parts.city) out.city = String(parts.city).trim();
  if (parts.pincode) {
    const p = exports.normalizePincode(parts.pincode);
    if (p) out.pincode = p;
  }
  if (parts.state) {
    const raw = String(parts.state).trim();
    const key = raw.toLowerCase();
    const known = STATE_TABLE[key];
    if (known) {
      out.state = raw.replace(/\b\w/g, (c) => c.toUpperCase()); // Title Case
      out.stateCode = known.code;
    } else if (raw.length === 2 && /^[A-Z]+$/i.test(raw)) {
      // Already an abbreviation — find by abbr
      const found = Object.entries(STATE_TABLE).find(
        ([, v]) => v.abbr === raw.toUpperCase()
      );
      if (found) {
        out.state = found[0].replace(/\b\w/g, (c) => c.toUpperCase());
        out.stateCode = found[1].code;
      } else {
        out.state = raw.toUpperCase();
      }
    } else {
      out.state = raw;
    }
  }
  return out;
};

// ─── Bill type inference ───

/**
 * Decide whether a bill should be created as GST or NON_GST.
 *   - Use rawBillType from Excel if it's one of GST / NON_GST
 *   - Else infer from GSTIN presence (gstin → GST, no gstin → NON_GST)
 */
exports.inferBillType = (gstin, rawBillType) => {
  if (rawBillType) {
    const t = String(rawBillType).trim().toUpperCase().replace(/[\s-]+/g, '_');
    if (t === 'GST' || t === 'NON_GST' || t === 'NONGST') {
      return t === 'NONGST' ? 'NON_GST' : t;
    }
  }
  return gstin ? 'GST' : 'NON_GST';
};

// ─── Mapping validation ───

const PLACEHOLDER_PREFIX = '_REPLACE_WITH_';

/**
 * Test whether a mapping object contains placeholder values. Returns
 * an array of "phase.field" paths that still need to be filled in.
 *
 * Empty / null sheetName for a phase means the phase is intentionally
 * disabled — not treated as a placeholder.
 */
exports.findPlaceholders = (mapping) => {
  const placeholders = [];
  for (const [phase, cfg] of Object.entries(mapping || {})) {
    if (!cfg) continue;
    if (cfg.sheetName == null || cfg.sheetName === '') continue;
    if (typeof cfg.sheetName === 'string' && cfg.sheetName.includes(PLACEHOLDER_PREFIX)) {
      placeholders.push(`${phase}.sheetName`);
    }
    for (const [col, val] of Object.entries(cfg.columns || {})) {
      if (typeof val === 'string' && val.includes(PLACEHOLDER_PREFIX)) {
        placeholders.push(`${phase}.columns.${col}`);
      }
    }
  }
  return placeholders;
};

exports.PLACEHOLDER_PREFIX = PLACEHOLDER_PREFIX;
exports._STATE_TABLE = STATE_TABLE;
