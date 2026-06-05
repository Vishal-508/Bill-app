import { useMemo, useState, useCallback } from 'react';
import {
  useReactTable, getCoreRowModel, flexRender,
} from '@tanstack/react-table';
import { ArrowUp, ArrowDown, ChevronsUpDown, MoreVertical } from 'lucide-react';
import { cn } from '../../utils/cn.js';
import { Checkbox } from '../ui/Checkbox.jsx';
import { EmptyState } from '../ui/EmptyState.jsx';
import { DataTableSkeleton } from './DataTableSkeleton.jsx';
import { DataTablePagination } from './DataTablePagination.jsx';
import { DataTableToolbar } from './DataTableToolbar.jsx';
import {
  getColumnAlignment, getCellPadding, getSortIcon,
} from './_dataTableStyles.js';

/**
 * Server-side DataTable. Sorting, pagination, and selection state are
 * controlled by the parent; this component just renders + dispatches
 * change callbacks.
 *
 * See spec at top of components/shared for prop API.
 */
export function DataTable({
  columns,
  data,
  totalCount = 0,
  pagination = { page: 1, limit: 20 },
  onPaginationChange,
  sorting = [],
  onSortingChange,
  loading = false,
  onRowClick,
  rowActions,
  bulkActions,
  searchValue,
  onSearchChange,
  searchPlaceholder,
  selectable = false,
  onSelectionChange,
  emptyState,
  density = 'normal',
  stickyHeader = true,
  className,
}) {
  const [rowSelection, setRowSelection] = useState({});
  const [openActionRow, setOpenActionRow] = useState(null);

  // Build the column set: optional checkbox column + caller's columns +
  // optional actions column. useMemo so tanstack doesn't re-create the
  // table identity every render.
  const tableColumns = useMemo(() => {
    const cols = [];
    if (selectable) {
      cols.push({
        id: '__select__',
        size: 36,
        header: ({ table }) => (
          <Checkbox
            checked={table.getIsAllRowsSelected()}
            onChange={table.getToggleAllRowsSelectedHandler()}
            aria-label="Select all"
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onChange={row.getToggleSelectedHandler()}
            aria-label="Select row"
            // stop row-click handler from firing when the checkbox is clicked
            onClick={(e) => e.stopPropagation()}
          />
        ),
      });
    }
    cols.push(...columns);
    if (rowActions?.length) {
      cols.push({
        id: '__actions__',
        size: 48,
        cell: ({ row }) => {
          const visible = rowActions.filter(a => !a.condition || a.condition(row.original));
          if (visible.length === 0) return null;
          const isOpen = openActionRow === row.id;
          return (
            <div className="relative inline-block text-left">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenActionRow(isOpen ? null : row.id);
                }}
                className="p-1 rounded text-secondary-500 hover:bg-secondary-100
                           focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
                aria-label="Row actions"
                aria-haspopup="menu"
                aria-expanded={isOpen}
              >
                <MoreVertical size={16} />
              </button>
              {isOpen && (
                <div
                  className="absolute right-0 mt-1 w-44 rounded-md bg-white shadow-lg ring-1 ring-black/5 z-10"
                  role="menu"
                  // close on outside click via the global handler below
                >
                  {visible.map((action, i) => {
                    const Icon = action.icon;
                    return (
                      <button
                        key={action.label || i}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenActionRow(null);
                          action.onClick(row.original);
                        }}
                        role="menuitem"
                        className={cn(
                          'w-full flex items-center gap-2 px-3 py-2 text-sm text-left',
                          'hover:bg-secondary-50',
                          action.variant === 'danger' && 'text-danger-700 hover:bg-danger-50',
                        )}
                      >
                        {Icon ? <Icon size={14} /> : null}
                        {action.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        },
      });
    }
    return cols;
  }, [columns, selectable, rowActions, openActionRow]);

  const totalPages = Math.max(1, Math.ceil((totalCount || 0) / (pagination.limit || 20)));

  const table = useReactTable({
    data: data ?? [],
    columns: tableColumns,
    manualPagination: true,
    manualSorting: true,
    pageCount: totalPages,
    enableRowSelection: selectable,
    state: {
      sorting,
      pagination: { pageIndex: (pagination.page || 1) - 1, pageSize: pagination.limit || 20 },
      rowSelection,
    },
    onSortingChange: (updater) => {
      const next = typeof updater === 'function' ? updater(sorting) : updater;
      onSortingChange?.(next);
    },
    onPaginationChange: (updater) => {
      const cur = { pageIndex: (pagination.page || 1) - 1, pageSize: pagination.limit || 20 };
      const next = typeof updater === 'function' ? updater(cur) : updater;
      onPaginationChange?.({ page: next.pageIndex + 1, limit: next.pageSize });
    },
    onRowSelectionChange: (updater) => {
      const next = typeof updater === 'function' ? updater(rowSelection) : updater;
      setRowSelection(next);
      if (onSelectionChange) {
        const selectedRows = table
          .getRowModel().rows.filter(r => next[r.id]).map(r => r.original);
        onSelectionChange(selectedRows);
      }
    },
    getCoreRowModel: getCoreRowModel(),
  });

  const handleHeaderClick = useCallback((header) => {
    if (!header.column.getCanSort()) return;
    const current = sorting[0];
    const id = header.column.id;
    if (!current || current.id !== id) {
      onSortingChange?.([{ id, desc: false }]);
    } else if (current.desc === false) {
      onSortingChange?.([{ id, desc: true }]);
    } else {
      onSortingChange?.([]);
    }
  }, [sorting, onSortingChange]);

  const padCls = getCellPadding(density);
  const selectedCount = Object.keys(rowSelection).filter(k => rowSelection[k]).length;

  return (
    <div className={cn('bg-white rounded-lg shadow-card border border-secondary-200', className)}>
      <DataTableToolbar
        searchValue={searchValue}
        onSearchChange={onSearchChange}
        searchPlaceholder={searchPlaceholder}
        bulkActions={bulkActions}
        selectedCount={selectedCount}
      />

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className={cn('bg-secondary-50 text-secondary-600', stickyHeader && 'sticky top-0 z-[1]')}>
            {table.getHeaderGroups().map(headerGroup => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map(header => {
                  const canSort = header.column.getCanSort();
                  const sortState = sorting.find(s => s.id === header.column.id);
                  const sortIcon = getSortIcon(sortState);
                  const align = getColumnAlignment(header.column.columnDef);
                  return (
                    <th
                      key={header.id}
                      onClick={canSort ? () => handleHeaderClick(header) : undefined}
                      className={cn(
                        padCls, align,
                        'text-xs font-semibold uppercase tracking-wide',
                        canSort && 'cursor-pointer select-none hover:bg-secondary-100',
                      )}
                      aria-sort={
                        sortIcon === 'asc' ? 'ascending'
                        : sortIcon === 'desc' ? 'descending'
                        : canSort ? 'none' : undefined
                      }
                    >
                      <span className="inline-flex items-center gap-1">
                        {header.isPlaceholder
                          ? null
                          : flexRender(header.column.columnDef.header, header.getContext())}
                        {canSort && (
                          sortIcon === 'asc'  ? <ArrowUp size={12} /> :
                          sortIcon === 'desc' ? <ArrowDown size={12} /> :
                          <ChevronsUpDown size={12} className="text-secondary-400" />
                        )}
                      </span>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>

          {loading ? (
            <DataTableSkeleton
              columnCount={tableColumns.length}
              rowCount={pagination.limit || 10}
              density={density}
            />
          ) : data.length === 0 ? (
            <tbody>
              <tr>
                <td colSpan={tableColumns.length} className="px-4 py-8">
                  <EmptyState
                    icon={emptyState?.icon}
                    title={emptyState?.title || 'No results'}
                    description={emptyState?.description}
                    action={emptyState?.action}
                  />
                </td>
              </tr>
            </tbody>
          ) : (
            <tbody>
              {table.getRowModel().rows.map(row => (
                <tr
                  key={row.id}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  className={cn(
                    'border-t border-secondary-200',
                    onRowClick && 'cursor-pointer hover:bg-secondary-50',
                  )}
                >
                  {row.getVisibleCells().map(cell => (
                    <td
                      key={cell.id}
                      className={cn(
                        padCls,
                        getColumnAlignment(cell.column.columnDef),
                        'text-secondary-900',
                      )}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          )}
        </table>
      </div>

      <DataTablePagination
        currentPage={pagination.page || 1}
        pageLimit={pagination.limit || 20}
        totalCount={totalCount}
        onPageChange={(p) => onPaginationChange?.({ ...pagination, page: p })}
        onLimitChange={(l) => onPaginationChange?.({ page: 1, limit: l })}
      />
    </div>
  );
}

export default DataTable;
