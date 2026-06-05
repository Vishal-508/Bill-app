/**
 * Pure helpers for DataTable styling + layout decisions.
 * Kept .js (not .jsx) so smoke tests can import + assert without JSX.
 */

// ─── Cell alignment via column.meta.align ───
export function getColumnAlignment(column) {
  const align = column?.meta?.align;
  if (align === 'right')  return 'text-right';
  if (align === 'center') return 'text-center';
  return 'text-left';
}

// ─── Row density (future-facing prop; MVP uses 'normal') ───
const PADDING_MAP = {
  compact:   'px-3 py-1.5',
  normal:    'px-4 py-3',
  spacious:  'px-5 py-4',
};
export function getCellPadding(density = 'normal') {
  return PADDING_MAP[density] || PADDING_MAP.normal;
}

// ─── Sort state → icon key for the column header ───
export function getSortIcon(sortState) {
  if (!sortState) return 'none';
  if (sortState.desc === true)  return 'desc';
  if (sortState.desc === false) return 'asc';
  return 'none';
}

/**
 * Compute a paginator-friendly array of page numbers + '…' separators.
 *
 * Rules:
 *   - totalPages <= 7 → [1..n] (no ellipses needed)
 *   - currentPage near start (1..4) → [1, 2, 3, 4, 5, '…', n]
 *   - currentPage near end (n-3..n) → [1, '…', n-4, n-3, n-2, n-1, n]
 *   - otherwise (middle)          → [1, '…', p-1, p, p+1, '…', n]
 *
 * Always returns at most 7 entries.
 */
export function getPaginationNumbers(currentPage, totalPages) {
  const safeTotal = Math.max(1, totalPages | 0);
  const safeCurrent = Math.min(Math.max(1, currentPage | 0), safeTotal);

  if (safeTotal <= 7) {
    return Array.from({ length: safeTotal }, (_, i) => i + 1);
  }
  if (safeCurrent <= 4) {
    return [1, 2, 3, 4, 5, '…', safeTotal];
  }
  if (safeCurrent >= safeTotal - 3) {
    return [1, '…', safeTotal - 4, safeTotal - 3, safeTotal - 2, safeTotal - 1, safeTotal];
  }
  return [1, '…', safeCurrent - 1, safeCurrent, safeCurrent + 1, '…', safeTotal];
}

/**
 * "Showing 1-20 of 245" helper. Returns { from, to, total }.
 */
export function getPageRange(currentPage, pageLimit, totalCount) {
  const total = Math.max(0, totalCount | 0);
  if (total === 0) return { from: 0, to: 0, total: 0 };
  const from = (Math.max(1, currentPage | 0) - 1) * (pageLimit | 0) + 1;
  const to = Math.min(total, from + (pageLimit | 0) - 1);
  return { from, to, total };
}

export const _internals = {
  PADDING_MAP,
};
