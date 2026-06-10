import { Link } from 'react-router-dom';
import { Calendar, User, ShoppingCart, AlertCircle } from 'lucide-react';
import { Card } from '../../components/ui/Card.jsx';
import { Badge } from '../../components/ui/Badge.jsx';
import { Alert } from '../../components/ui/Alert.jsx';
import { formatDate, formatDateTime } from '../../utils/format.js';
import {
  BILL_STATUS_VARIANT, PAYMENT_STATUS_VARIANT, isCancelled,
} from './_billColumns.jsx';

export default function BillHeader({ bill }) {
  if (!bill) return null;
  const customer = typeof bill.customer === 'object' ? bill.customer : null;
  const order = typeof bill.order === 'object' ? bill.order : null;

  return (
    <Card>
      <Card.Body className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-mono text-xl font-semibold text-primary-700">
              {bill.billNumber}
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span className="inline-flex items-center gap-1.5 text-secondary-700">
                <Calendar size={14} className="text-secondary-400" />
                <span title={formatDateTime(bill.issueDate || bill.createdAt)}>
                  {formatDate(bill.issueDate || bill.createdAt)}
                </span>
              </span>
              {customer && (
                <span className="inline-flex items-center gap-1.5 text-secondary-700">
                  <User size={14} className="text-secondary-400" />
                  <Link to={`/customers/${customer._id}`}
                        className="hover:text-primary-700 underline-offset-2 hover:underline">
                    {customer.customerName}
                  </Link>
                </span>
              )}
              {order && (
                <span className="inline-flex items-center gap-1.5 text-secondary-700">
                  <ShoppingCart size={14} className="text-secondary-400" />
                  <Link to={`/orders/${order._id}`}
                        className="font-mono hover:text-primary-700 underline-offset-2 hover:underline">
                    {order.orderNumber}
                  </Link>
                </span>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={BILL_STATUS_VARIANT[bill.status] || 'neutral'} size="md">
              {bill.status}
            </Badge>
            <Badge variant={bill.hasGst ? 'info' : 'neutral'} size="md">
              {bill.hasGst ? 'GST' : 'NON_GST'}
            </Badge>
            {bill.paymentStatus && (
              <Badge variant={PAYMENT_STATUS_VARIANT[bill.paymentStatus] || 'neutral'} size="md">
                {bill.paymentStatus}
              </Badge>
            )}
          </div>
        </div>

        {isCancelled(bill) && bill.cancellationReason && (
          <Alert variant="warning" className="!py-2">
            <div className="flex items-start gap-2 text-xs">
              <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
              <span>
                <span className="font-semibold">Cancelled:</span>{' '}
                {bill.cancellationReason}
                {bill.cancelledAt && (
                  <span className="text-secondary-500 ml-1">
                    · {formatDate(bill.cancelledAt)}
                  </span>
                )}
              </span>
            </div>
          </Alert>
        )}
      </Card.Body>
    </Card>
  );
}
