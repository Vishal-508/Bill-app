/**
 * Generic client-side CSV export.
 *
 * Triggers a download of the given rows × fields as a CSV file with
 * an ISO-timestamped filename. RFC-4180-style escaping for commas,
 * quotes, and newlines. Returns the number of rows written, or 0 if
 * data was empty (no download triggered).
 *
 * Caller passes the field list explicitly so column order is stable
 * and unwanted fields (e.g. populated objects) don't leak in.
 */
function escapeCell(val) {
  if (val == null) return '';
  // Dates → ISO; objects → JSON; numbers/booleans → String()
  let str;
  if (val instanceof Date) str = val.toISOString();
  else if (typeof val === 'object') str = JSON.stringify(val);
  else str = String(val);

  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function getCell(row, field) {
  // Dot-path support: 'billingAddress.city' → row.billingAddress?.city
  if (field.indexOf('.') === -1) return row[field];
  return field.split('.').reduce(
    (acc, key) => (acc == null ? acc : acc[key]),
    row
  );
}

export function exportToCsv(data, baseFilename, fields, { headerLabels } = {}) {
  if (!data || data.length === 0) {
    // eslint-disable-next-line no-console
    console.warn('exportToCsv: empty data — no file produced');
    return 0;
  }
  if (!Array.isArray(fields) || fields.length === 0) {
    throw new Error('exportToCsv: fields[] is required');
  }

  const headerRow = (headerLabels && headerLabels.length === fields.length
    ? headerLabels
    : fields
  ).map(escapeCell).join(',');

  const bodyRows = data.map(row =>
    fields.map(f => escapeCell(getCell(row, f))).join(',')
  );

  // Excel-friendly: \r\n line endings + UTF-8 BOM so non-ASCII (₹,
  // customer names with accents) renders correctly out-of-the-box.
  const csv = '﻿' + [headerRow, ...bodyRows].join('\r\n');

  if (typeof window === 'undefined') {
    // Test environment — just return the string so callers can inspect.
    return { csv, rowCount: bodyRows.length };
  }

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  link.href = url;
  link.download = `${baseFilename}-${ts}.csv`;
  link.style.visibility = 'hidden';

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  return bodyRows.length;
}

// Exposed for tests
export const _internals = { escapeCell, getCell };
