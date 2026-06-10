import {
  Eye, Download, Send, Check, MessageSquare, Mail,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge.jsx';
import { formatINR, formatDate } from '../../utils/format.js';

/**
 * Bill workflow status — matches backend's bill.status enum.
 *   DRAFT     → editable, can be finalized or cancelled
 *   FINAL     → locked, only sends / payments allowed
 *   CANCELLED → terminal, no further changes
 */
export const BILL_STATUS_VARIANT = Object.freeze({
  DRAFT:     'warning',
  FINAL:     'info',
  CANCELLED: 'danger',
});

export const PAYMENT_STATUS_VARIANT = Object.freeze({
  UNPAID:    'danger',
  PARTIAL:   'warning',
  PAID:      'success',
  OVERDUE:   'danger',
  CANCELLED: 'neutral',
});

export function isDraft(bill)       { return bill?.status === 'DRAFT'; }
export function isFinal(bill)       { return bill?.status === 'FINAL'; }
export function isCancelled(bill)   { return bill?.status === 'CANCELLED'; }
export function isLocked(bill)      { return isFinal(bill) || isCancelled(bill); }

/**
 * Sent-channel detection. Backend stores send events in `bill.events`
 * with `channel` ∈ {'email','whatsapp','print','in-person'}. We render
 * small icons in the list for the digital channels (whatsapp + email).
 */
export function sentChannels(bill) {
  const events = Array.isArray(bill?.events) ? bill.events : [];
  const sent = new Set();
  for (const e of events) {
    if (e?.type === 'SENT' || e?.action === 'SENT' || e?.channel) {
      const c = e.channel;
      if (c === 'whatsapp' || c === 'email') sent.add(c);
    }
  }
  return sent;
}

export function billColumns() {
  return [
    {
      accessorKey: 'billNumber',
      header: 'Invoice #',
      enableSorting: true,
      cell: ({ row }) => (
        <span className="font-mono text-xs text-primary-700">{row.original.billNumber}</span>
      ),
    },
    {
      accessorKey: 'issueDate',
      header: 'Date',
      enableSorting: true,
      cell: ({ row }) => (
        <span className="text-xs text-secondary-700 whitespace-nowrap">
          {formatDate(row.original.issueDate || row.original.createdAt)}
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
        const id = typeof c === 'object' ? c._id : null;
        return id
          ? (
            <Link
              to={`/customers/${id}`}
              onClick={(e) => e.stopPropagation()}
              className="font-medium text-secondary-900 hover:text-primary-700 truncate max-w-[200px] block"
            >
              {name}
            </Link>
          )
          : <span className="font-medium text-secondary-900 truncate max-w-[200px] block">{name}</span>;
      },
    },
    {
      id: 'type',
      header: 'Type',
      enableSorting: false,
      cell: ({ row }) => (
        <Badge variant={row.original.hasGst ? 'info' : 'neutral'} size="sm">
          {row.original.hasGst ? 'GST' : 'NON_GST'}
        </Badge>
      ),
    },
    {
      accessorKey: 'status',
      header: 'Status',
      enableSorting: true,
      cell: ({ row }) => (
        <Badge variant={BILL_STATUS_VARIANT[row.original.status] || 'neutral'} size="sm">
          {row.original.status}
        </Badge>
      ),
    },
    {
      accessorKey: 'grandTotal',
      header: 'Total',
      enableSorting: true,
      meta: { align: 'right' },
      cell: ({ row }) => (
        <span className="font-medium text-secondary-900">
          {formatINR(row.original.grandTotal ?? 0)}
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
    {
      id: 'sent',
      header: 'Sent',
      enableSorting: false,
      cell: ({ row }) => {
        const sent = sentChannels(row.original);
        if (sent.size === 0) return <span className="text-secondary-400 text-xs">—</span>;
        return (
          <div className="flex items-center gap-1">
            {sent.has('whatsapp') && (
              <span title="Sent via WhatsApp" className="text-success-700">
                <MessageSquare size={14} />
              </span>
            )}
            {sent.has('email') && (
              <span title="Sent via Email" className="text-info-700">
                <Mail size={14} />
              </span>
            )}
          </div>
        );
      },
    },
  ];
}

/**
 * Row actions. Send / Mark-sent are separate entries by design:
 *   - "Send via …" opens a guided dialog that launches the external
 *     channel (whatsapp:// or mailto:) AND records the event after.
 *   - "Mark sent" is a standalone record-only flow for when the admin
 *     used some other channel (phone call, in-person) outside the app.
 *
 * NOTE: No "Edit" action — bills are immutable snapshots of their source
 * order. To change items/totals, edit the source order and regenerate.
 * The backend's PUT /bills/:id only mutates auxiliary fields (notes,
 * dueDate, T&C, transport), not the financial substance. Exposing an
 * "Edit" entry that hits that endpoint would suggest more capability
 * than the system actually has — better to omit per the "no dead
 * controls" principle.
 */
export function billRowActions({
  onView, onDownloadPdf, onSend, onMarkSent, onAddPayment,
}) {
  return [
    { label: 'View',         icon: Eye,      onClick: onView },
    { label: 'Download PDF', icon: Download, onClick: onDownloadPdf },
    {
      label: 'Send to customer',
      icon: Send,
      onClick: onSend,
      condition: (row) => !isCancelled(row),
    },
    {
      label: 'Mark sent',
      icon: Check,
      onClick: onMarkSent,
      condition: (row) => !isCancelled(row),
    },
    {
      label: 'Add payment',
      icon: Download,  // placeholder icon; Section F wires the modal
      onClick: onAddPayment,
      condition: (row) => row.paymentStatus !== 'PAID' && !isCancelled(row),
    },
  ];
}
