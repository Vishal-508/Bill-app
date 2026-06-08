import { useQuery } from '@tanstack/react-query';
import { api } from '../../../api/axios.js';
import { Card } from '../../../components/ui/Card.jsx';
import { Badge } from '../../../components/ui/Badge.jsx';
import { Spinner } from '../../../components/ui/Spinner.jsx';
import { EmptyState } from '../../../components/ui/EmptyState.jsx';
import { Activity } from 'lucide-react';
import { formatDate } from '../../../utils/format.js';

const TYPE_VARIANT = {
  PURCHASE:    'success',
  SALE:        'info',
  ADJUSTMENT:  'warning',
  RETURN:      'success',
  WASTAGE:     'danger',
};

export default function StockMovementsTab({ productId }) {
  const { data, isLoading } = useQuery({
    queryKey: ['stock-movements', 'list', { product: productId, limit: 20 }],
    queryFn: () => api.get('/stock-movements',
      { params: { product: productId, limit: 20, sort: '-createdAt' } }
    ).then(r => r.data),
    enabled: !!productId,
    staleTime: 30_000,
  });

  if (isLoading) return <Card><Card.Body className="text-center py-8"><Spinner size="lg" /></Card.Body></Card>;

  const movements = data?.data || [];

  if (movements.length === 0) {
    return (
      <Card><Card.Body>
        <EmptyState
          icon={<Activity size={24} />}
          title="No stock movements yet"
          description="Purchase, sale, and adjustment events will appear here."
        />
      </Card.Body></Card>
    );
  }

  return (
    <Card>
      <Card.Header title={`Recent Movements (${data?.pagination?.totalRecords ?? movements.length})`} />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-secondary-50 text-secondary-600 text-xs uppercase">
            <tr>
              <th className="px-4 py-2 text-left">Date</th>
              <th className="px-4 py-2 text-left">Type</th>
              <th className="px-4 py-2 text-right">Delta</th>
              <th className="px-4 py-2 text-right">After</th>
              <th className="px-4 py-2 text-left">Reason</th>
            </tr>
          </thead>
          <tbody>
            {movements.map((m) => (
              <tr key={m._id} className="border-t border-secondary-200 hover:bg-secondary-50">
                <td className="px-4 py-2 text-secondary-700 text-xs">{formatDate(m.createdAt)}</td>
                <td className="px-4 py-2">
                  <Badge variant={TYPE_VARIANT[m.type] || 'neutral'} size="sm">
                    {m.type}
                  </Badge>
                </td>
                <td className={`px-4 py-2 text-right font-mono text-sm ${
                  m.delta < 0 ? 'text-danger-700' : 'text-success-700'
                }`}>
                  {m.delta > 0 ? '+' : ''}{m.delta}
                </td>
                <td className="px-4 py-2 text-right font-mono text-sm text-secondary-900">
                  {m.stockAfter ?? m.balanceAfter ?? '—'}
                </td>
                <td className="px-4 py-2 text-xs text-secondary-600 truncate max-w-[280px]">
                  {m.reason || m.notes || '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
