import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Pencil, FileText } from 'lucide-react';
import toast from 'react-hot-toast';
import { useOrderDetail } from '../../hooks/queries/useOrders.js';
import { useCreateBillFromOrder } from '../../hooks/queries/useBills.js';
import { Button } from '../../components/ui/Button.jsx';
import { Card } from '../../components/ui/Card.jsx';
import { Spinner } from '../../components/ui/Spinner.jsx';
import { Alert } from '../../components/ui/Alert.jsx';
import OrderHeader from './OrderHeader.jsx';
import OrderStats from './OrderStats.jsx';
import OrderTabs from './OrderTabs.jsx';
import OrderFormModal from './OrderFormModal.jsx';
import { canGenerateBill, isEditable } from './_orderColumns.jsx';
import { ROUTES } from '../../utils/constants.js';

export default function OrderDetail() {
  const { orderId } = useParams();
  const navigate = useNavigate();

  const orderQuery = useOrderDetail(orderId);
  const createBill = useCreateBillFromOrder();

  const [editOpen, setEditOpen] = useState(false);

  const order = orderQuery.data?.data;

  if (orderQuery.isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <Spinner size="lg" />
      </div>
    );
  }

  if (orderQuery.isError || !order) {
    const status = orderQuery.error?.response?.status;
    return (
      <div className="space-y-4">
        <button onClick={() => navigate(ROUTES.ORDERS)}
          className="inline-flex items-center gap-1.5 text-sm text-secondary-700 hover:text-primary-700">
          <ArrowLeft size={14} /> Back to Orders
        </button>
        <Card><Card.Body>
          <Alert variant="error">
            {status === 404
              ? 'Order not found — it may have been deleted.'
              : `Could not load order (${orderQuery.error?.message || 'unknown error'}).`}
          </Alert>
        </Card.Body></Card>
      </div>
    );
  }

  const handleGenerateBill = async () => {
    if (!window.confirm(`Generate bill for ${order.orderNumber}?`)) return;
    try {
      const res = await createBill.mutateAsync({ orderId: order._id });
      const billId = res?.data?._id;
      if (billId) navigate(`/bills/${billId}`);
      else toast.success('Bill generated');
    } catch { /* toast surfaced by hook */ }
  };

  const billable = canGenerateBill(order);
  const editable = isEditable(order.status);

  return (
    <div className="space-y-4">
      {/* Top toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <button
          type="button"
          // navigate(-1) preserves list filters/page; fallback to /orders
          // for direct-URL visits with no history entry (memory-note pattern).
          onClick={() => {
            if (window.history.length > 1) navigate(-1);
            else navigate(ROUTES.ORDERS);
          }}
          className="inline-flex items-center gap-1.5 text-sm text-secondary-700 hover:text-primary-700
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded px-1.5 py-0.5"
        >
          <ArrowLeft size={14} /> Back to Orders
        </button>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            leftIcon={<Pencil size={14} />}
            onClick={() => setEditOpen(true)}
            disabled={!editable}
            title={!editable ? `Cannot edit in ${order.status}` : undefined}
          >
            Edit
          </Button>
          <Button
            variant="primary"
            size="sm"
            leftIcon={<FileText size={14} />}
            onClick={handleGenerateBill}
            disabled={!billable}
            loading={createBill.isPending}
            title={!billable
              ? 'Generate bill once the order is READY (and no bill exists yet)'
              : undefined}
          >
            Generate Bill
          </Button>
        </div>
      </div>

      <OrderHeader order={order} />
      <OrderStats order={order} />
      <OrderTabs order={order} />

      {editOpen && (
        <OrderFormModal
          open
          order={order}
          onClose={() => setEditOpen(false)}
        />
      )}
    </div>
  );
}
