import {
  Eye, Pencil, Workflow, FileText, XCircle, Trash2,
} from 'lucide-react';
import { Badge } from '../../components/ui/Badge.jsx';
import { formatINR, formatDate, formatDateTime } from '../../utils/format.js';

/**
 * Order status state machine. Each key is a current status; the value
 * is the array of statuses it can transition to. Empty array = terminal
 * state. Backend's statusChangeSchema enforces the enum at write time,
 * but we honor the same flow client-side so the UI doesn't expose
 * transitions the backend will reject.
 */
export const STATUS_FLOW = Object.freeze({
  PENDING:     ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['CUTTING', 'CANCELLED'],
  CUTTING:     ['BUNDLING', 'CANCELLED'],
  BUNDLING:    ['READY', 'CANCELLED'],
  READY:       ['COMPLETED', 'DELIVERED', 'CANCELLED'],
  COMPLETED:   ['DELIVERED'],
  DELIVERED:   [],
  CANCELLED:   [],
});

export const ALL_STATUSES = Object.keys(STATUS_FLOW);

export const STATUS_BADGE_VARIANT = Object.freeze({
  PENDING:     'warning',
  IN_PROGRESS: 'info',
  CUTTING:     'info',
  BUNDLING:    'info',
  READY:       'info',     // could be 'primary' but neutral-info works
  COMPLETED:   'success',
  DELIVERED:   'success',
  CANCELLED:   'danger',
});

export const PAYMENT_STATUS_VARIANT = Object.freeze({
  UNPAID:    'danger',
  PARTIAL:   'warning',
  PAID:      'success',
  OVERDUE:   'danger',
  CANCELLED: 'neutral',
});

const TERMINAL_STATUSES = new Set(['DELIVERED', 'CANCELLED']);
const EDITABLE_STATUSES = new Set(['PENDING', 'IN_PROGRESS', 'CUTTING', 'BUNDLING', 'READY']);
const BILLABLE_STATUSES = new Set(['READY', 'COMPLETED', 'DELIVERED']);

/** Returns true if `currentStatus` can move to `nextStatus`. */
export function canTransitionTo(currentStatus, nextStatus) {
  const next = STATUS_FLOW[currentStatus] || [];
  return next.includes(nextStatus);
}

/** Returns the array of valid next statuses for `currentStatus`. */
export function getValidNextStatuses(currentStatus) {
  return STATUS_FLOW[currentStatus] || [];
}

export function isTerminal(status) {
  return TERMINAL_STATUSES.has(status);
}

export function isEditable(status) {
  return EDITABLE_STATUSES.has(status);
}

export function canGenerateBill(order) {
  if (!order) return false;
  if (!BILLABLE_STATUSES.has(order.status)) return false;
  // Order with already-linked bill should not regenerate via this UI
  return !order.bill && !order.billId && !order.linkedBillId;
}

// ───────────────────────────────────────────────────────
// DataTable column definitions
// ───────────────────────────────────────────────────────
export function orderColumns() {
  return [
    {
      accessorKey: 'orderNumber',
      header: 'Order #',
      enableSorting: true,
      cell: ({ row }) => (
        <span className="font-mono text-xs text-primary-700">
          {row.original.orderNumber}
        </span>
      ),
    },
    {
      id: 'customer',
      header: 'Customer',
      enableSorting: false,
      cell: ({ row }) => {
        const c = row.original.customer;
        if (!c) return <span className="text-secondary-400">—</span>;
        const name = typeof c === 'object' ? c.customerName : '';
        const company = typeof c === 'object' ? c.companyName : '';
        return (
          <div className="min-w-0">
            <div className="font-medium text-secondary-900 truncate max-w-[200px]">
              {name || '—'}
            </div>
            {company && (
              <div className="text-xs text-secondary-500 truncate max-w-[200px]">
                {company}
              </div>
            )}
          </div>
        );
      },
    },
    {
      accessorKey: 'orderDate',
      header: 'Date',
      enableSorting: true,
      cell: ({ row }) => {
        const d = row.original.orderDate || row.original.createdAt;
        return (
          <span className="text-xs text-secondary-700 whitespace-nowrap"
                title={formatDateTime(d)}>
            {formatDate(d)}
          </span>
        );
      },
    },
    {
      accessorKey: 'status',
      header: 'Status',
      enableSorting: true,
      cell: ({ row }) => (
        <Badge variant={STATUS_BADGE_VARIANT[row.original.status] || 'neutral'} size="sm">
          {row.original.status}
        </Badge>
      ),
    },
    {
      id: 'itemCount',
      header: 'Items',
      enableSorting: false,
      meta: { align: 'center' },
      cell: ({ row }) => (
        <span className="text-secondary-700">
          {Array.isArray(row.original.items) ? row.original.items.length : 0}
        </span>
      ),
    },
    {
      accessorKey: 'totalAmount',
      header: 'Total',
      enableSorting: true,
      meta: { align: 'right' },
      cell: ({ row }) => (
        <span className="font-medium text-secondary-900">
          {formatINR(row.original.totalAmount ?? row.original.grandTotal ?? 0)}
        </span>
      ),
    },
    {
      accessorKey: 'paymentStatus',
      header: 'Payment',
      enableSorting: true,
      cell: ({ row }) => {
        const ps = row.original.paymentStatus || 'UNPAID';
        return (
          <Badge variant={PAYMENT_STATUS_VARIANT[ps] || 'neutral'} size="sm">
            {ps}
          </Badge>
        );
      },
    },
  ];
}

/**
 * Row actions factory.
 * - View is always available
 * - Edit only for non-terminal, non-completed statuses
 * - Change Status emits a per-row callback that opens a sub-menu
 *   selector at the call site (handlers.onChangeStatus(order, nextStatus))
 * - Generate Bill only for billable statuses without a linked bill
 * - Cancel only when not terminal
 * - Soft Delete only after Cancel
 */
export function orderRowActions(handlers) {
  return [
    { label: 'View', icon: Eye, onClick: handlers.onView },
    {
      label: 'Edit',
      icon: Pencil,
      onClick: handlers.onEdit,
      condition: (row) => isEditable(row.status),
    },
    {
      label: 'Change Status',
      icon: Workflow,
      onClick: handlers.onChangeStatus,
      condition: (row) => getValidNextStatuses(row.status).length > 0,
    },
    {
      label: 'Generate Bill',
      icon: FileText,
      onClick: handlers.onGenerateBill,
      condition: (row) => canGenerateBill(row),
    },
    {
      label: 'Cancel',
      icon: XCircle,
      variant: 'danger',
      onClick: handlers.onCancel,
      condition: (row) => !isTerminal(row.status),
    },
    {
      label: 'Soft delete',
      icon: Trash2,
      variant: 'danger',
      onClick: handlers.onDelete,
      condition: (row) => row.status === 'CANCELLED',
    },
  ];
}
