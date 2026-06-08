import { Pencil, Power, PowerOff, Trash2, Eye } from 'lucide-react';
import { Badge } from '../../components/ui/Badge.jsx';
import { formatPhone, formatDate } from '../../utils/format.js';

/**
 * DataTable column defs for the customer list page. Built as a
 * factory so per-row callbacks (edit/delete handlers) can close over
 * page-level state without leaking into the table component.
 *
 * Note: Customer model has NO `billType` field — it's derived from
 * `gstin` presence (see admin_dashboard_customer_field_shape memory).
 * Phone is formatted via formatPhone for display only; the underlying
 * 10-digit string is what backend persists.
 */
export function customerColumns() {
  return [
    {
      accessorKey: 'customerName',
      header: 'Name',
      enableSorting: true,
      cell: ({ row }) => (
        <div className="font-medium text-secondary-900 truncate max-w-[200px]">
          {row.original.customerName}
        </div>
      ),
    },
    {
      accessorKey: 'companyName',
      header: 'Company',
      enableSorting: false,
      cell: ({ row }) => (
        <span className="text-secondary-700 truncate max-w-[180px] block">
          {row.original.companyName || '—'}
        </span>
      ),
    },
    {
      accessorKey: 'phone',
      header: 'Phone',
      enableSorting: false,
      cell: ({ row }) => (
        <span className="font-mono text-xs">{formatPhone(row.original.phone)}</span>
      ),
    },
    {
      // Derived field — Customer model has no `billType`, so we read
      // from `gstin` presence (canonical convention).
      id: 'billType',
      header: 'Bill Type',
      enableSorting: false,
      cell: ({ row }) => {
        const isGst = !!row.original.gstin;
        return (
          <Badge variant={isGst ? 'info' : 'neutral'} size="sm">
            {isGst ? 'GST' : 'NON_GST'}
          </Badge>
        );
      },
    },
    {
      accessorKey: 'gstin',
      header: 'GSTIN',
      enableSorting: false,
      cell: ({ row }) => (
        <span className="font-mono text-xs text-secondary-600">
          {row.original.gstin || '—'}
        </span>
      ),
    },
    {
      id: 'location',
      header: 'Location',
      enableSorting: false,
      cell: ({ row }) => {
        const a = row.original.billingAddress || {};
        const parts = [a.city, a.state].filter(Boolean);
        return parts.length > 0
          ? <span className="text-secondary-700">{parts.join(', ')}</span>
          : <span className="text-secondary-400">—</span>;
      },
    },
    {
      accessorKey: 'isActive',
      header: 'Status',
      enableSorting: true,
      cell: ({ row }) => (
        <Badge variant={row.original.isActive ? 'success' : 'danger'} size="sm">
          {row.original.isActive ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
    {
      accessorKey: 'createdAt',
      header: 'Added',
      enableSorting: true,
      meta: { align: 'right' },
      cell: ({ row }) => (
        <span className="text-xs text-secondary-500 whitespace-nowrap">
          {formatDate(row.original.createdAt)}
        </span>
      ),
    },
  ];
}

/**
 * Row-actions factory — passed as `rowActions` to DataTable.
 *
 * DataTable's rowActions don't support functions for label/icon/
 * variant, so we use two mutually-exclusive entries (one active-only,
 * one inactive-only) both wired to `onToggleActive`. This makes the
 * menu symmetric — an inactive customer can be re-activated via the
 * row menu without going through bulk or the detail page.
 */
export function customerRowActions({ onView, onEdit, onToggleActive, onDelete }) {
  return [
    { label: 'View', icon: Eye, onClick: onView },
    { label: 'Edit', icon: Pencil, onClick: onEdit },
    {
      label: 'Activate',
      icon: Power,
      variant: 'success',
      onClick: onToggleActive,
      condition: (row) => !row.isActive,
    },
    {
      label: 'Deactivate',
      icon: PowerOff,
      variant: 'danger',
      onClick: onToggleActive,
      condition: (row) => row.isActive,
    },
    {
      // Soft-delete via the DELETE endpoint — distinct from the
      // bulk-update "deactivate" path. Keeps the audit log accurate
      // (this records a deletionReason).
      label: 'Soft delete',
      icon: Trash2,
      variant: 'danger',
      onClick: onDelete,
      condition: (row) => row.isActive,
    },
  ];
}
