import {
  Package, Calculator, Receipt, IndianRupee, AlertCircle,
} from 'lucide-react';
import { Card } from '../../components/ui/Card.jsx';
import { formatINR } from '../../utils/format.js';

function StatCard({ icon: Icon, label, value, subtitle, accent = 'primary' }) {
  const tone = {
    primary: 'bg-primary-50 text-primary-700',
    success: 'bg-success-50 text-success-700',
    info:    'bg-info-50    text-info-700',
    warning: 'bg-warning-50 text-warning-700',
    danger:  'bg-danger-50  text-danger-700',
  }[accent] || 'bg-primary-50 text-primary-700';
  return (
    <Card>
      <Card.Body className="flex items-start gap-3">
        <div className={`h-10 w-10 rounded-md flex items-center justify-center ${tone}`}>
          <Icon size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs text-secondary-500 uppercase tracking-wide">{label}</div>
          <div className="mt-0.5 text-xl font-semibold text-secondary-900 truncate">
            {value}
          </div>
          {subtitle && (
            <div className="mt-0.5 text-xs text-secondary-500 truncate">{subtitle}</div>
          )}
        </div>
      </Card.Body>
    </Card>
  );
}

export default function OrderStats({ order }) {
  if (!order) return null;

  const itemCount = Array.isArray(order.items) ? order.items.length : 0;
  const subtotal = order.subtotal ?? 0;
  const totalGst = order.totalGst ?? 0;
  const grandTotal = order.totalAmount ?? order.grandTotal ?? 0;
  const amountPaid = order.amountPaid ?? 0;
  const amountDue = order.amountDue ?? Math.max(0, grandTotal - amountPaid);

  const dueAccent = amountDue > 0 ? 'danger' : 'success';
  const dueValue = amountDue > 0 ? formatINR(amountDue) : 'Fully paid';
  const dueSubtitle = amountDue > 0
    ? `${formatINR(amountPaid)} paid of ${formatINR(grandTotal)}`
    : amountPaid > 0
      ? `${formatINR(amountPaid)} received`
      : 'No payment recorded';

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <StatCard
        icon={Package}
        label="Items"
        value={itemCount}
        subtitle={itemCount === 1 ? 'Line item' : 'Line items'}
        accent="primary"
      />
      <StatCard
        icon={Calculator}
        label="Subtotal"
        value={formatINR(subtotal)}
        subtitle="Pre-tax"
        accent="info"
      />
      <StatCard
        icon={Receipt}
        label="Total GST"
        value={formatINR(totalGst)}
        subtitle={order.isIntraState ? 'CGST + SGST' : 'IGST'}
        accent="info"
      />
      <StatCard
        icon={IndianRupee}
        label="Grand Total"
        value={formatINR(grandTotal)}
        subtitle="Including GST"
        accent="success"
      />
      <StatCard
        icon={amountDue > 0 ? AlertCircle : IndianRupee}
        label="Outstanding"
        value={dueValue}
        subtitle={dueSubtitle}
        accent={dueAccent}
      />
    </div>
  );
}
