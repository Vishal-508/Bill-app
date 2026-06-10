import { Link } from 'react-router-dom';
import { Calendar, User, AlertCircle } from 'lucide-react';
import { formatDate, formatDateTime } from '../../utils/format.js';
import { Card } from '../../components/ui/Card.jsx';
import { Badge } from '../../components/ui/Badge.jsx';
import { Alert } from '../../components/ui/Alert.jsx';
import { PAYMENT_STATUS_VARIANT } from './_orderColumns.jsx';
import StatusChangeButton from './StatusChangeButton.jsx';

export default function OrderHeader({ order }) {
  if (!order) return null;
  const customer = typeof order.customer === 'object' ? order.customer : null;

  return (
    <Card>
      <Card.Body className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-mono text-xl font-semibold text-primary-700">
              {order.orderNumber}
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span className="inline-flex items-center gap-1.5 text-secondary-700">
                <Calendar size={14} className="text-secondary-400" />
                <span title={formatDateTime(order.orderDate || order.createdAt)}>
                  {formatDate(order.orderDate || order.createdAt)}
                </span>
              </span>
              {customer && (
                <span className="inline-flex items-center gap-1.5 text-secondary-700">
                  <User size={14} className="text-secondary-400" />
                  <Link
                    to={`/customers/${customer._id}`}
                    className="hover:text-primary-700 underline-offset-2 hover:underline"
                  >
                    {customer.customerName}
                  </Link>
                </span>
              )}
              {order.paymentStatus && (
                <Badge
                  variant={PAYMENT_STATUS_VARIANT[order.paymentStatus] || 'neutral'}
                  size="sm"
                >
                  {order.paymentStatus}
                </Badge>
              )}
            </div>
          </div>

          <StatusChangeButton order={order} />
        </div>

        {order.status === 'CANCELLED' && order.cancellationReason && (
          <Alert variant="warning" className="!py-2">
            <div className="flex items-start gap-2 text-xs">
              <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
              <span>
                <span className="font-semibold">Cancelled:</span>{' '}
                {order.cancellationReason}
                {order.cancelledAt && (
                  <span className="text-secondary-500 ml-1">
                    · {formatDate(order.cancelledAt)}
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
