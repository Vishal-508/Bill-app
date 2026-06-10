import { useNavigate } from 'react-router-dom';
import { FileText, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import { useBillsByOrder, useCreateBillFromOrder } from '../../../hooks/queries/useBills.js';
import { Card } from '../../../components/ui/Card.jsx';
import { Badge } from '../../../components/ui/Badge.jsx';
import { Button } from '../../../components/ui/Button.jsx';
import { Spinner } from '../../../components/ui/Spinner.jsx';
import { EmptyState } from '../../../components/ui/EmptyState.jsx';
import { formatINR, formatDate } from '../../../utils/format.js';
import { canGenerateBill } from '../_orderColumns.jsx';

const PAY_STATUS_VARIANT = {
  PAID:     'success',
  PARTIAL:  'warning',
  UNPAID:   'danger',
  OVERDUE:  'danger',
  CANCELLED:'neutral',
};

export default function BillsTab({ order }) {
  const navigate = useNavigate();
  const { data, isLoading } = useBillsByOrder(order?._id);
  const createBill = useCreateBillFromOrder();

  if (isLoading) {
    return <Card><Card.Body className="text-center py-8"><Spinner size="lg" /></Card.Body></Card>;
  }

  // by-order responses may be wrapped as { data: [...] } OR a single
  // bill { data: {...} } depending on backend cardinality. Normalize.
  const raw = data?.data;
  const bills = Array.isArray(raw) ? raw : (raw && raw._id ? [raw] : []);

  const handleGenerate = async () => {
    if (!window.confirm(`Generate bill for ${order.orderNumber}?`)) return;
    try {
      const res = await createBill.mutateAsync({ orderId: order._id });
      const billId = res?.data?._id;
      if (billId) navigate(`/bills/${billId}`);
    } catch { /* toast surfaced by hook */ }
  };

  if (bills.length === 0) {
    return (
      <Card><Card.Body className="space-y-4">
        <EmptyState
          icon={<FileText size={24} />}
          title="No bill generated"
          description={
            canGenerateBill(order)
              ? 'Once this order is ready, generate a bill to send to the customer.'
              : `Bill generation is enabled once the order reaches READY (currently ${order.status}).`
          }
        />
        {canGenerateBill(order) && (
          <div className="text-center">
            <Button
              variant="primary"
              leftIcon={<Plus size={14} />}
              onClick={handleGenerate}
              loading={createBill.isPending}
            >
              Generate Bill
            </Button>
          </div>
        )}
      </Card.Body></Card>
    );
  }

  return (
    <Card>
      <Card.Header title={`Bills (${bills.length})`} />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-secondary-50 text-secondary-600 text-xs uppercase">
            <tr>
              <th className="px-4 py-2 text-left">Invoice #</th>
              <th className="px-4 py-2 text-left">Date</th>
              <th className="px-4 py-2 text-left">Type</th>
              <th className="px-4 py-2 text-left">Payment</th>
              <th className="px-4 py-2 text-right">Grand Total</th>
            </tr>
          </thead>
          <tbody>
            {bills.map(b => (
              <tr key={b._id}
                  className="border-t border-secondary-200 hover:bg-secondary-50 cursor-pointer"
                  onClick={() => navigate(`/bills/${b._id}`)}>
                <td className="px-4 py-2 font-mono text-xs text-primary-700">{b.invoiceNo}</td>
                <td className="px-4 py-2 text-secondary-700">
                  {formatDate(b.invoiceDate || b.createdAt)}
                </td>
                <td className="px-4 py-2">
                  <Badge variant={b.hasGst ? 'info' : 'neutral'} size="sm">
                    {b.hasGst ? 'GST' : 'NON_GST'}
                  </Badge>
                </td>
                <td className="px-4 py-2">
                  <Badge variant={PAY_STATUS_VARIANT[b.paymentStatus] || 'neutral'} size="sm">
                    {b.paymentStatus || '—'}
                  </Badge>
                </td>
                <td className="px-4 py-2 text-right font-medium font-mono">
                  {formatINR(b.grandTotal ?? b.totalAmount ?? 0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
