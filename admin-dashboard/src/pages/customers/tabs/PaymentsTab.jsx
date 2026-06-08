import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../../api/axios.js';
import { Card } from '../../../components/ui/Card.jsx';
import { Badge } from '../../../components/ui/Badge.jsx';
import { Spinner } from '../../../components/ui/Spinner.jsx';
import { EmptyState } from '../../../components/ui/EmptyState.jsx';
import { CreditCard } from 'lucide-react';
import { formatINR, formatDate } from '../../../utils/format.js';

const STATUS_VARIANT = {
  SUCCESS:   'success',
  PENDING:   'warning',
  FAILED:    'danger',
  REFUNDED:  'neutral',
};

export default function PaymentsTab({ customerId }) {
  const { data, isLoading } = useQuery({
    queryKey: ['payments', 'list', { customer: customerId, limit: 10 }],
    queryFn: () => api.get('/payments',
      { params: { customer: customerId, limit: 10, sort: '-createdAt' } }
    ).then(r => r.data),
    enabled: !!customerId,
    staleTime: 30_000,
  });

  if (isLoading) return <Card><Card.Body className="text-center py-8"><Spinner size="lg" /></Card.Body></Card>;

  const payments = data?.data || [];
  const total = data?.pagination?.totalRecords ?? payments.length;

  if (payments.length === 0) {
    return (
      <Card><Card.Body>
        <EmptyState
          icon={<CreditCard size={24} />}
          title="No payments yet"
          description="Payments received from this customer will appear here."
        />
      </Card.Body></Card>
    );
  }

  return (
    <Card>
      <Card.Header
        title={`Recent Payments (${total})`}
        actions={
          <Link to={`/payments?customer=${customerId}`} className="text-xs text-primary-700 hover:underline">
            View all →
          </Link>
        }
      />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-secondary-50 text-secondary-600 text-xs uppercase">
            <tr>
              <th className="px-4 py-2 text-left">Payment #</th>
              <th className="px-4 py-2 text-left">Date</th>
              <th className="px-4 py-2 text-left">Mode</th>
              <th className="px-4 py-2 text-left">Status</th>
              <th className="px-4 py-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {payments.map(p => (
              <tr key={p._id} className="border-t border-secondary-200 hover:bg-secondary-50">
                <td className="px-4 py-2 font-mono text-xs text-primary-700">
                  {p.paymentNumber || p.transactionId || '—'}
                </td>
                <td className="px-4 py-2 text-secondary-700">{formatDate(p.createdAt)}</td>
                <td className="px-4 py-2">
                  <Badge variant="info" size="sm">{p.paymentMode || p.mode}</Badge>
                </td>
                <td className="px-4 py-2">
                  <Badge variant={STATUS_VARIANT[p.status] || 'neutral'} size="sm">
                    {p.status}
                  </Badge>
                </td>
                <td className="px-4 py-2 text-right font-medium text-secondary-900">
                  {formatINR(p.amount ?? 0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
