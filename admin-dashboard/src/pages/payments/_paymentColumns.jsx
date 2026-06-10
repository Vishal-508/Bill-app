import { Eye, Download, XCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge } from '../../components/ui/Badge.jsx';
import { formatINR, formatDate } from '../../utils/format.js';
import { paiseToRupees } from '../../api/payment.api.js';

/**
 * Payment entity status (Razorpay vocabulary, NOT order-side PAID/etc).
 * CAPTURED = funds successfully settled (the success case)
 * AUTHORIZED = authorized but not yet captured (typical online flow)
 * CREATED/ATTEMPTED = in-flight, not yet complete
 * REFUNDED, CANCELLED, FAILED = terminal-non-success
 */
export const STATUS_VARIANT = Object.freeze({
  CAPTURED:   'success',
  AUTHORIZED: 'info',
  ATTEMPTED:  'warning',
  CREATED:    'warning',
  FAILED:     'danger',
  REFUNDED:   'neutral',
  CANCELLED:  'neutral',
});

export const METHOD_VARIANT = Object.freeze({
  upi:        'info',
  card:       'info',
  netbanking: 'info',
  wallet:     'info',
  emi:        'warning',
  other:      'neutral',
});

export const GATEWAY_VARIANT = Object.freeze({
  razorpay: 'info',
  manual:   'success',
  mock:     'warning',
});

export function isTerminal(payment) {
  return ['CAPTURED', 'REFUNDED', 'CANCELLED', 'FAILED'].includes(payment?.status);
}

export function isRefundable(payment) {
  return payment?.status === 'CAPTURED' && (payment?.amountRefunded ?? 0) < (payment?.amount ?? 0);
}

export function paymentColumns() {
  return [
    {
      accessorKey: 'paymentReference',
      header: 'Reference',
      enableSorting: true,
      cell: ({ row }) => (
        <span className="font-mono text-xs text-primary-700">
          {row.original.paymentReference}
        </span>
      ),
    },
    {
      accessorKey: 'createdAt',
      header: 'Date',
      enableSorting: true,
      cell: ({ row }) => (
        <span className="text-xs text-secondary-700 whitespace-nowrap">
          {formatDate(row.original.createdAt)}
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
        const id   = typeof c === 'object' ? c._id : null;
        return id ? (
          <Link to={`/customers/${id}`} onClick={(e) => e.stopPropagation()}
                className="font-medium text-secondary-900 hover:text-primary-700 truncate max-w-[180px] block">
            {name}
          </Link>
        ) : <span className="text-secondary-700">{name || '—'}</span>;
      },
    },
    {
      id: 'bill',
      header: 'Bill',
      enableSorting: false,
      cell: ({ row }) => {
        const b = row.original.bill;
        if (!b) return <span className="text-secondary-400">—</span>;
        const num = typeof b === 'object' ? b.billNumber : '';
        const id  = typeof b === 'object' ? b._id : null;
        return id ? (
          <Link to={`/bills/${id}`} onClick={(e) => e.stopPropagation()}
                className="font-mono text-xs text-primary-700 hover:underline">
            {num}
          </Link>
        ) : <span className="text-xs text-secondary-700">{num || '—'}</span>;
      },
    },
    {
      accessorKey: 'amount',
      header: 'Amount',
      enableSorting: true,
      meta: { align: 'right' },
      cell: ({ row }) => (
        // Payment.amount is stored in PAISE — convert before display.
        <span className="font-medium text-secondary-900 font-mono">
          {formatINR(paiseToRupees(row.original.amount))}
        </span>
      ),
    },
    {
      accessorKey: 'gateway',
      header: 'Gateway',
      enableSorting: false,
      cell: ({ row }) => (
        <Badge variant={GATEWAY_VARIANT[row.original.gateway] || 'neutral'} size="sm">
          {row.original.gateway || '—'}
        </Badge>
      ),
    },
    {
      accessorKey: 'method',
      header: 'Method',
      enableSorting: false,
      cell: ({ row }) => {
        const m = row.original.method;
        if (!m) return <span className="text-secondary-400 text-xs">—</span>;
        return (
          <Badge variant={METHOD_VARIANT[m] || 'neutral'} size="sm">
            {m}
          </Badge>
        );
      },
    },
    {
      accessorKey: 'status',
      header: 'Status',
      enableSorting: true,
      cell: ({ row }) => (
        <Badge variant={STATUS_VARIANT[row.original.status] || 'neutral'} size="sm">
          {row.original.status}
        </Badge>
      ),
    },
  ];
}

export function paymentRowActions({ onView, onDownloadReceipt, onCancel }) {
  return [
    { label: 'View',             icon: Eye,      onClick: onView },
    { label: 'Download receipt', icon: Download, onClick: onDownloadReceipt },
    {
      label: 'Cancel',
      icon: XCircle,
      variant: 'danger',
      onClick: onCancel,
      // Backend's /:id/cancel only allows CREATED + ATTEMPTED states
      condition: (row) => ['CREATED', 'ATTEMPTED'].includes(row.status),
    },
  ];
}
