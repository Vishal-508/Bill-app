import { Card } from '../../../components/ui/Card.jsx';
import { Badge } from '../../../components/ui/Badge.jsx';
import { EmptyState } from '../../../components/ui/EmptyState.jsx';
import { History } from 'lucide-react';
import { formatDateTime } from '../../../utils/format.js';
import { STATUS_BADGE_VARIANT, ALL_STATUSES } from '../_orderColumns.jsx';
import { cn } from '../../../utils/cn.js';

/**
 * Vertical timeline of status transitions, latest at top. Each entry
 * has `status`, `changedAt`, `changedBy` (populated user), and
 * optionally `notes` or `previousStatus` depending on backend shape.
 */
export default function TimelineTab({ order }) {
  if (!order) return null;

  const history = Array.isArray(order.statusHistory) ? order.statusHistory : [];
  // Latest first
  const entries = [...history].reverse();

  return (
    <Card>
      <Card.Header
        title={`Status History (${history.length})`}
        actions={
          <Badge variant={STATUS_BADGE_VARIANT[order.status] || 'neutral'} size="sm">
            Now: {order.status}
          </Badge>
        }
      />
      <Card.Body>
        {entries.length === 0 ? (
          <EmptyState
            icon={<History size={24} />}
            title="No status changes yet"
            description="Transitions you make will appear here as an audit log."
          />
        ) : (
          <ol className="relative border-l-2 border-secondary-200 pl-5 space-y-4">
            {entries.map((e, idx) => {
              const isLatest = idx === 0;
              const variant = STATUS_BADGE_VARIANT[e.status] || 'neutral';
              const changedBy = typeof e.changedBy === 'object'
                ? (e.changedBy.name || e.changedBy.email) : null;
              return (
                <li key={idx} className="relative">
                  <span className={cn(
                    'absolute -left-[27px] top-1 h-3 w-3 rounded-full ring-4 ring-white',
                    isLatest ? 'bg-primary-600' : 'bg-secondary-300',
                  )} aria-hidden="true" />
                  <div className="flex flex-wrap items-baseline gap-2">
                    <Badge variant={variant} size="sm">{e.status}</Badge>
                    {e.previousStatus && (
                      <span className="text-xs text-secondary-500">
                        from <span className="font-medium">{e.previousStatus}</span>
                      </span>
                    )}
                    <span className="text-xs text-secondary-500">
                      {formatDateTime(e.changedAt || e.timestamp || e.createdAt)}
                    </span>
                  </div>
                  {changedBy && (
                    <div className="mt-0.5 text-xs text-secondary-600">
                      by <span className="font-medium">{changedBy}</span>
                    </div>
                  )}
                  {e.notes && (
                    <div className="mt-1 text-sm text-secondary-700 italic">
                      "{e.notes}"
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        )}

        {/* Progress strip — visualizes overall lifecycle position */}
        <div className="mt-6 pt-4 border-t border-secondary-200">
          <div className="text-xs uppercase tracking-wide text-secondary-500 mb-2">
            Lifecycle
          </div>
          <div className="flex flex-wrap gap-1.5">
            {ALL_STATUSES.filter(s => s !== 'CANCELLED').map(s => (
              <Badge
                key={s}
                variant={s === order.status ? STATUS_BADGE_VARIANT[s] : 'neutral'}
                size="sm"
                className={s === order.status ? '' : 'opacity-50'}
              >
                {s}
              </Badge>
            ))}
            {order.status === 'CANCELLED' && (
              <Badge variant="danger" size="sm">CANCELLED</Badge>
            )}
          </div>
        </div>
      </Card.Body>
    </Card>
  );
}
