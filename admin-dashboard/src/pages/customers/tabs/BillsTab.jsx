import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../../api/axios.js';
import { Card } from '../../../components/ui/Card.jsx';
import { Badge } from '../../../components/ui/Badge.jsx';
import { Spinner } from '../../../components/ui/Spinner.jsx';
import { EmptyState } from '../../../components/ui/EmptyState.jsx';
import { FileText } from 'lucide-react';
import { formatINR, formatDate } from '../../../utils/format.js';

const PAY_STATUS_VARIANT = {
  PAID:       'success',
  PARTIAL:    'warning',
  UNPAID:     'danger',
  CANCELLED:  'neutral',
  OVERDUE:    'danger',
};

export default function BillsTab({ customerId }) {
  const { data, isLoading } = useQuery({
    queryKey: ['bills', 'list', { customer: customerId, limit: 10 }],
    queryFn: () => api.get('/bills',
      { params: { customer: customerId, limit: 10, sort: '-createdAt' } }
    ).then(r => r.data),
    enabled: !!customerId,
    staleTime: 30_000,
  });

  if (isLoading) return <Card><Card.Body className="text-center py-8"><Spinner size="lg" /></Card.Body></Card>;

  const bills = data?.data || [];
  const total = data?.pagination?.totalRecords ?? bills.length;

  if (bills.length === 0) {
    return (
      <Card><Card.Body>
        <EmptyState
          icon={<FileText size={24} />}
          title="No bills yet"
          description="Invoices generated for this customer will appear here."
        />
      </Card.Body></Card>
    );
  }

  return (
    <Card>
      <Card.Header
        title={`Recent Bills (${total})`}
        actions={
          <Link to={`/bills?customer=${customerId}`} className="text-xs text-primary-700 hover:underline">
            View all →
          </Link>
        }
      />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-secondary-50 text-secondary-600 text-xs uppercase">
            <tr>
              <th className="px-4 py-2 text-left">Invoice #</th>
              <th className="px-4 py-2 text-left">Date</th>
              <th className="px-4 py-2 text-left">Type</th>
              <th className="px-4 py-2 text-left">Status</th>
              <th className="px-4 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {bills.map(b => (
              <tr key={b._id} className="border-t border-secondary-200 hover:bg-secondary-50">
                <td className="px-4 py-2 font-mono text-xs text-primary-700">{b.invoiceNo}</td>
                <td className="px-4 py-2 text-secondary-700">{formatDate(b.invoiceDate || b.createdAt)}</td>
                <td className="px-4 py-2">
                  <Badge variant={b.billType === 'GST' ? 'info' : 'neutral'} size="sm">
                    {b.billType}
                  </Badge>
                </td>
                <td className="px-4 py-2">
                  <Badge variant={PAY_STATUS_VARIANT[b.paymentStatus] || 'neutral'} size="sm">
                    {b.paymentStatus}
                  </Badge>
                </td>
                <td className="px-4 py-2 text-right font-medium text-secondary-900">
                  {formatINR(b.grandTotal ?? 0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
