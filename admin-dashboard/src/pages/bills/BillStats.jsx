import { Calculator, Receipt, IndianRupee, CheckCircle2, AlertCircle } from 'lucide-react';
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

export default function BillStats({ bill }) {
  if (!bill) return null;
  const subTotal = bill.subTotal ?? bill.subtotal ?? 0;
  const totalGst = bill.totalGst ?? 0;
  const grandTotal = bill.grandTotal ?? 0;
  const amountPaid = bill.amountPaid ?? 0;
  const amountDue = bill.amountDue ?? Math.max(0, grandTotal - amountPaid);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <StatCard
        icon={Calculator}
        label="Subtotal"
        value={formatINR(subTotal)}
        subtitle="Pre-tax"
        accent="info"
      />
      <StatCard
        icon={Receipt}
        label="Total GST"
        value={formatINR(totalGst)}
        subtitle={bill.isIntraState ? 'CGST + SGST' : 'IGST'}
        accent="info"
      />
      <StatCard
        icon={IndianRupee}
        label="Grand Total"
        value={formatINR(grandTotal)}
        subtitle="Invoice amount"
        accent="primary"
      />
      <StatCard
        icon={CheckCircle2}
        label="Paid"
        value={formatINR(amountPaid)}
        subtitle={amountPaid > 0 ? 'Received' : 'No payment yet'}
        accent="success"
      />
      <StatCard
        icon={amountDue > 0 ? AlertCircle : CheckCircle2}
        label="Outstanding"
        value={amountDue > 0 ? formatINR(amountDue) : 'Fully paid'}
        subtitle={amountDue > 0
          ? `${Math.round((amountPaid / grandTotal) * 100)}% paid`
          : 'Closed'}
        accent={amountDue > 0 ? 'danger' : 'success'}
      />
    </div>
  );
}
