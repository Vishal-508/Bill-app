import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../../api/axios.js';
import { Card } from '../../../components/ui/Card.jsx';
import { Badge } from '../../../components/ui/Badge.jsx';
import { Spinner } from '../../../components/ui/Spinner.jsx';
import { EmptyState } from '../../../components/ui/EmptyState.jsx';
import { ShoppingCart } from 'lucide-react';
import { formatINR, formatDate } from '../../../utils/format.js';

const STATUS_VARIANT = {
  PENDING:     'warning',
  IN_PROGRESS: 'info',
  READY:       'success',
  DELIVERED:   'success',
  CANCELLED:   'danger',
};

export default function OrdersTab({ customerId }) {
  const { data, isLoading } = useQuery({
    queryKey: ['orders', 'list', { customer: customerId, limit: 10 }],
    queryFn: () => api.get('/orders',
      { params: { customer: customerId, limit: 10, sort: '-createdAt' } }
    ).then(r => r.data),
    enabled: !!customerId,
    staleTime: 30_000,
  });

  if (isLoading) return <Card><Card.Body className="text-center py-8"><Spinner size="lg" /></Card.Body></Card>;

  const orders = data?.data || [];
  const total = data?.pagination?.totalRecords ?? orders.length;

  if (orders.length === 0) {
    return (
      <Card><Card.Body>
        <EmptyState
          icon={<ShoppingCart size={24} />}
          title="No orders yet"
          description="Orders placed by this customer will appear here."
        />
      </Card.Body></Card>
    );
  }

  return (
    <Card>
      <Card.Header
        title={`Recent Orders (${total})`}
        actions={
          <Link to={`/orders?customer=${customerId}`} className="text-xs text-primary-700 hover:underline">
            View all →
          </Link>
        }
      />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-secondary-50 text-secondary-600 text-xs uppercase">
            <tr>
              <th className="px-4 py-2 text-left">Order #</th>
              <th className="px-4 py-2 text-left">Date</th>
              <th className="px-4 py-2 text-left">Status</th>
              <th className="px-4 py-2 text-right">Items</th>
              <th className="px-4 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {orders.map(o => (
              <tr key={o._id} className="border-t border-secondary-200 hover:bg-secondary-50">
                <td className="px-4 py-2 font-mono text-xs text-primary-700">{o.orderNumber}</td>
                <td className="px-4 py-2 text-secondary-700">{formatDate(o.createdAt)}</td>
                <td className="px-4 py-2">
                  <Badge variant={STATUS_VARIANT[o.status] || 'neutral'} size="sm">
                    {o.status}
                  </Badge>
                </td>
                <td className="px-4 py-2 text-right text-secondary-700">
                  {o.items?.length ?? 0}
                </td>
                <td className="px-4 py-2 text-right font-medium text-secondary-900">
                  {formatINR(o.totalAmount ?? o.grandTotal ?? 0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
