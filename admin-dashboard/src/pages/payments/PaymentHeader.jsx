import { Link } from 'react-router-dom';
import { Calendar, User, FileText, ShoppingCart } from 'lucide-react';
import { Card } from '../../components/ui/Card.jsx';
import { Badge } from '../../components/ui/Badge.jsx';
import { formatDate, formatDateTime, formatINR } from '../../utils/format.js';
import { paiseToRupees } from '../../api/payment.api.js';
import { STATUS_VARIANT, METHOD_VARIANT, GATEWAY_VARIANT } from './_paymentColumns.jsx';

export default function PaymentHeader({ payment }) {
  if (!payment) return null;
  const customer = typeof payment.customer === 'object' ? payment.customer : null;
  const bill = typeof payment.bill === 'object' ? payment.bill : null;
  const order = typeof payment.order === 'object' ? payment.order : null;

  return (
    <Card>
      <Card.Body className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-mono text-xl font-semibold text-primary-700">
              {payment.paymentReference}
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span className="inline-flex items-center gap-1.5 text-secondary-700">
                <Calendar size={14} className="text-secondary-400" />
                <span title={formatDateTime(payment.createdAt)}>
                  {formatDate(payment.createdAt)}
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
              {bill && (
                <span className="inline-flex items-center gap-1.5 text-secondary-700">
                  <FileText size={14} className="text-secondary-400" />
                  <Link to={`/bills/${bill._id}`}
                        className="font-mono hover:text-primary-700 underline-offset-2 hover:underline">
                    {bill.billNumber}
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

          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wide text-secondary-500">Amount</div>
            <div className="text-2xl font-bold text-secondary-900 font-mono">
              {formatINR(paiseToRupees(payment.amount))}
            </div>
            <div className="mt-1 flex items-center gap-1 justify-end">
              <Badge variant={STATUS_VARIANT[payment.status] || 'neutral'} size="sm">
                {payment.status}
              </Badge>
              {payment.method && (
                <Badge variant={METHOD_VARIANT[payment.method] || 'neutral'} size="sm">
                  {payment.method}
                </Badge>
              )}
              <Badge variant={GATEWAY_VARIANT[payment.gateway] || 'neutral'} size="sm">
                {payment.gateway}
              </Badge>
            </div>
          </div>
        </div>
      </Card.Body>
    </Card>
  );
}
