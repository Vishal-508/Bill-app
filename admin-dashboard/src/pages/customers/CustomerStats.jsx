import { formatDistanceToNow } from 'date-fns';
import { ShoppingCart, IndianRupee, AlertCircle, Clock } from 'lucide-react';
import { Card } from '../../components/ui/Card.jsx';
import { formatINR } from '../../utils/format.js';

function StatCard({ icon: Icon, label, value, subtitle, accent = 'primary' }) {
  const accentBg = {
    primary: 'bg-primary-50 text-primary-700',
    success: 'bg-success-50 text-success-700',
    warning: 'bg-warning-50 text-warning-700',
    danger:  'bg-danger-50  text-danger-700',
  }[accent] || 'bg-primary-50 text-primary-700';

  return (
    <Card>
      <Card.Body className="flex items-start gap-3">
        <div className={`h-10 w-10 rounded-md flex items-center justify-center ${accentBg}`}>
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

/**
 * Stats row for the customer detail page. Pulls data from the
 * `/customers/:id/insights` endpoint:
 *   data.insights = { totalOrders, totalRevenue, lifetimeValue,
 *                     avgOrderValue, lastOrderDate, ... }
 *   data.financial = { creditLimit, currentDues, availableCredit }
 *
 * Defensive on every field — backend may return zeros, nulls, or
 * missing keys depending on whether the customer has any orders yet.
 */
export default function CustomerStats({ insights, financial, loading }) {
  const i = insights || {};
  const f = financial || {};

  const lastOrderText = i.lastOrderDate
    ? formatDistanceToNow(new Date(i.lastOrderDate), { addSuffix: true })
    : '—';

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, k) => (
          <Card key={k}><Card.Body>
            <div className="h-10 w-10 rounded-md bg-secondary-200 animate-pulse" />
            <div className="mt-3 h-3 w-24 bg-secondary-200 rounded animate-pulse" />
            <div className="mt-2 h-5 w-32 bg-secondary-200 rounded animate-pulse" />
          </Card.Body></Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        icon={ShoppingCart}
        label="Total Orders"
        value={i.totalOrders ?? 0}
        subtitle={i.avgDaysBetweenOrders
          ? `~${Math.round(i.avgDaysBetweenOrders)} days between orders`
          : 'Lifetime'}
        accent="primary"
      />
      <StatCard
        icon={IndianRupee}
        label="Total Spent"
        value={formatINR(i.lifetimeValue ?? i.totalRevenue ?? 0)}
        subtitle={i.avgOrderValue
          ? `Avg ${formatINR(i.avgOrderValue)} / order`
          : 'Lifetime'}
        accent="success"
      />
      <StatCard
        icon={AlertCircle}
        label="Outstanding Dues"
        value={formatINR(f.currentDues ?? 0)}
        subtitle={f.creditLimit
          ? `Limit ${formatINR(f.creditLimit)}`
          : 'No credit limit set'}
        accent={(f.currentDues ?? 0) > 0 ? 'danger' : 'success'}
      />
      <StatCard
        icon={Clock}
        label="Last Order"
        value={lastOrderText}
        subtitle={i.firstOrderDate
          ? `First: ${new Date(i.firstOrderDate).toLocaleDateString('en-IN')}`
          : 'No orders yet'}
        accent="warning"
      />
    </div>
  );
}
