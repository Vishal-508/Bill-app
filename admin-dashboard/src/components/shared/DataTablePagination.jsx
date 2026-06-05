import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '../../utils/cn.js';
import { Select } from '../ui/Select.jsx';
import { getPaginationNumbers, getPageRange } from './_dataTableStyles.js';

const PAGE_LIMIT_OPTIONS = [
  { value: 10, label: '10' },
  { value: 20, label: '20' },
  { value: 50, label: '50' },
  { value: 100, label: '100' },
];

export function DataTablePagination({
  currentPage,
  pageLimit,
  totalCount,
  onPageChange,
  onLimitChange,
}) {
  const totalPages = Math.max(1, Math.ceil((totalCount || 0) / (pageLimit || 20)));
  const { from, to, total } = getPageRange(currentPage, pageLimit, totalCount);
  const pages = getPaginationNumbers(currentPage, totalPages);

  return (
    <div className="flex flex-col gap-3 px-4 py-3 border-t border-secondary-200 bg-secondary-50/50
                    sm:flex-row sm:items-center sm:justify-between">
      <div className="text-xs text-secondary-600">
        Showing <span className="font-medium text-secondary-900">{from}</span>–
        <span className="font-medium text-secondary-900">{to}</span> of{' '}
        <span className="font-medium text-secondary-900">{total}</span>
      </div>

      <div className="flex items-center gap-3">
        <label className="hidden sm:flex items-center gap-2 text-xs text-secondary-600">
          Rows per page
          <Select
            value={pageLimit}
            size="sm"
            options={PAGE_LIMIT_OPTIONS}
            className="w-16"
            onChange={(e) => onLimitChange(Number(e.target.value))}
          />
        </label>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onPageChange(currentPage - 1)}
            disabled={currentPage <= 1}
            className="h-8 w-8 inline-flex items-center justify-center rounded text-secondary-700
                       hover:bg-secondary-100 disabled:opacity-40 disabled:cursor-not-allowed
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            aria-label="Previous page"
          >
            <ChevronLeft size={16} />
          </button>

          {pages.map((p, i) =>
            p === '…' ? (
              <span key={`ellipsis-${i}`} className="px-2 text-secondary-400 select-none">…</span>
            ) : (
              <button
                key={p}
                type="button"
                onClick={() => onPageChange(p)}
                aria-current={p === currentPage ? 'page' : undefined}
                className={cn(
                  'h-8 min-w-8 px-2 inline-flex items-center justify-center rounded text-xs font-medium',
                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                  p === currentPage
                    ? 'bg-primary-600 text-white'
                    : 'text-secondary-700 hover:bg-secondary-100',
                )}
              >
                {p}
              </button>
            )
          )}

          <button
            type="button"
            onClick={() => onPageChange(currentPage + 1)}
            disabled={currentPage >= totalPages}
            className="h-8 w-8 inline-flex items-center justify-center rounded text-secondary-700
                       hover:bg-secondary-100 disabled:opacity-40 disabled:cursor-not-allowed
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            aria-label="Next page"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default DataTablePagination;
