/**
 * Locale-aware formatters for INR currency, Indian mobile numbers,
 * and dates. Pure functions — safe to import anywhere.
 */

/**
 * Format a number as Indian Rupees with lakhs/crores grouping.
 *   123456.78 → "₹1,23,456.78"
 *   1234567.89 → "₹12,34,567.89"
 *   0 → "₹0.00"
 *   null/undefined/NaN → "₹0.00"
 */
export function formatINR(value, { decimals = 2 } = {}) {
  const num = Number(value);
  const safe = Number.isFinite(num) ? num : 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(safe);
}

/**
 * Format an Indian 10-digit mobile as "+91 98765-43210".
 * Accepts loose input ("+91 9876543210", "919876543210", "9876543210").
 * Returns the input unchanged if it doesn't look like an Indian mobile.
 */
export function formatPhone(raw) {
  if (raw == null) return '';
  const digits = String(raw).replace(/\D/g, '');
  const last10 = digits.length >= 10 ? digits.slice(-10) : digits;
  if (!/^[6-9]\d{9}$/.test(last10)) return String(raw);
  return `+91 ${last10.slice(0, 5)}-${last10.slice(5)}`;
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                     'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pad2(n) { return n < 10 ? `0${n}` : String(n); }

/**
 * Format a date as "05 Jun 2026" (dd MMM yyyy).
 * Accepts Date instance, ISO string, or epoch ms.
 */
export function formatDate(value) {
  if (value == null) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad2(d.getDate())} ${MONTH_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * Format date + time as "05 Jun 2026, 14:32".
 */
export function formatDateTime(value) {
  if (value == null) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return `${formatDate(d)}, ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * Truncate a string to maxLen chars + "…" if longer.
 */
export function truncate(s, maxLen = 50) {
  if (s == null) return '';
  const str = String(s);
  return str.length <= maxLen ? str : `${str.slice(0, maxLen - 1)}…`;
}
