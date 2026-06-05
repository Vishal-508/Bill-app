import { formatDistanceToNow } from 'date-fns';
import {
  ShoppingCart, CreditCard, FileText, AlertTriangle, RefreshCw, Activity,
} from 'lucide-react';
import { cn } from '../../utils/cn.js';

const TYPE_ICONS = {
  'order:new':            ShoppingCart,
  'order:status-changed': RefreshCw,
  'order:updated':        RefreshCw,
  'payment:received':     CreditCard,
  'bill:generated':       FileText,
  'inventory:low-stock':  AlertTriangle,
  'dashboard:refresh':    Activity,
};

const TYPE_COLORS = {
  'order:new':            'text-primary-600 bg-primary-50',
  'order:status-changed': 'text-info-600    bg-info-50',
  'order:updated':        'text-info-600    bg-info-50',
  'payment:received':     'text-success-600 bg-success-50',
  'bill:generated':       'text-secondary-600 bg-secondary-100',
  'inventory:low-stock':  'text-warning-700 bg-warning-50',
  'dashboard:refresh':    'text-secondary-600 bg-secondary-100',
};

export default function NotificationItem({ item, onClick }) {
  const Icon = TYPE_ICONS[item.type] || Activity;
  const colorCls = TYPE_COLORS[item.type] || 'text-secondary-600 bg-secondary-100';
  const timestamp = item.receivedAt
    ? formatDistanceToNow(new Date(item.receivedAt), { addSuffix: true })
    : '';

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full text-left px-4 py-3 flex gap-3 items-start',
        'border-b border-secondary-100 transition-colors hover:bg-secondary-50',
        !item.read && 'bg-primary-50/40',
      )}
    >
      <div className={cn('p-2 rounded-md flex-shrink-0', colorCls)}>
        <Icon size={16} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <p className={cn(
            'text-sm truncate',
            item.read ? 'font-normal text-secondary-700' : 'font-medium text-secondary-900',
          )}>
            {item.title}
          </p>
          {!item.read && (
            <span className="h-2 w-2 rounded-full bg-primary-600 flex-shrink-0" aria-label="Unread" />
          )}
        </div>
        {item.message && (
          <p className="text-xs text-secondary-600 truncate mt-0.5">{item.message}</p>
        )}
        {timestamp && (
          <p className="text-[11px] text-secondary-400 mt-1">{timestamp}</p>
        )}
      </div>
    </button>
  );
}
