import { useQuery } from '@tanstack/react-query';
import { api } from '../../../api/axios.js';
import { Card } from '../../../components/ui/Card.jsx';
import { Badge } from '../../../components/ui/Badge.jsx';
import { Spinner } from '../../../components/ui/Spinner.jsx';
import { EmptyState } from '../../../components/ui/EmptyState.jsx';
import { CreditCard, Plus } from 'lucide-react';
import { Button } from '../../../components/ui/Button.jsx';
import { formatINR, formatDate } from '../../../utils/format.js';
import toast from 'react-hot-toast';

const MODE_VARIANT = {
  CASH: 'success', UPI: 'info', CARD: 'info', BANK_TRANSFER: 'info',
  CHEQUE: 'warning', CREDIT: 'neutral', RAZORPAY: 'info',
};
const STATUS_VARIANT = {
  PAID: 'success', PENDING: 'warning', FAILED: 'danger',
  REFUNDED: 'neutral', SUCCESS: 'success',
};

export default function BillPaymentsTab({ bill }) {
  // Backend's payment list supports ?bill=:billId — cleaner than digging
  // into embedded bill.payments which may or may not be denormalized.
  const { data, isLoading } = useQuery({
    queryKey: ['payments', 'list', { bill: bill?._id, limit: 20 }],
    queryFn: () => api.get('/payments',
      { params: { bill: bill._id, limit: 20, sort: '-paidAt' } }
    ).then(r => r.data),
    enabled: !!bill?._id,
    staleTime: 30_000,
  });

  if (isLoading) {
    return <Card><Card.Body className="text-center py-8"><Spinner size="lg" /></Card.Body></Card>;
  }

  const payments = data?.data || [];
  const grandTotal = bill.grandTotal ?? 0;
  const totalPaid = payments
    .filter(p => ['PAID', 'SUCCESS'].includes(p.status))
    .reduce((s, p) => s + (p.amount ?? 0), 0);
  const outstanding = Math.max(0, grandTotal - totalPaid);

  return (
    <Card>
      <Card.Header
        title={`Payments (${payments.length})`}
        actions={
          <div className="flex items-center gap-3 text-xs">
            <span className="text-secondary-500">
              Paid:{' '}
              <span className="font-medium text-success-700">{formatINR(totalPaid)}</span>
            </span>
            <span className="text-secondary-500">
              Outstanding:{' '}
              <span className={outstanding > 0 ? 'font-medium text-danger-700' : 'font-medium text-success-700'}>
                {formatINR(outstanding)}
              </span>
            </span>
            <Button
              variant="outline"
              size="sm"
              leftIcon={<Plus size={14} />}
              onClick={() => toast('Add Payment ships in Section F.', { icon: 'ℹ️' })}
            >
              Add payment
            </Button>
          </div>
        }
      />

      {payments.length === 0 ? (
        <Card.Body>
          <EmptyState
            icon={<CreditCard size={24} />}
            title="No payments yet"
            description="Payments recorded against this bill will appear here."
          />
        </Card.Body>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary-50 text-secondary-600 text-xs uppercase">
              <tr>
                <th className="px-4 py-2 text-left">Reference</th>
                <th className="px-4 py-2 text-left">Date</th>
                <th className="px-4 py-2 text-left">Mode</th>
                <th className="px-4 py-2 text-left">Status</th>
                <th className="px-4 py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p, idx) => (
                <tr key={p._id || idx}
                    className="border-t border-secondary-200 hover:bg-secondary-50">
                  <td className="px-4 py-2 font-mono text-xs text-primary-700">
                    {p.paymentReference || p.reference || '—'}
                  </td>
                  <td className="px-4 py-2 text-secondary-700">
                    {formatDate(p.paidAt || p.createdAt)}
                  </td>
                  <td className="px-4 py-2">
                    <Badge variant={MODE_VARIANT[p.mode || p.paymentMode] || 'neutral'} size="sm">
                      {p.mode || p.paymentMode || '—'}
                    </Badge>
                  </td>
                  <td className="px-4 py-2">
                    <Badge variant={STATUS_VARIANT[p.status] || 'neutral'} size="sm">
                      {p.status || '—'}
                    </Badge>
                  </td>
                  <td className="px-4 py-2 text-right font-mono font-medium text-secondary-900">
                    {formatINR(p.amount ?? 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
