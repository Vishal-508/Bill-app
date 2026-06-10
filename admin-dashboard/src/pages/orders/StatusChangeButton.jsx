import { Fragment } from 'react';
import { Menu, Transition } from '@headlessui/react';
import { ChevronDown, Workflow } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button } from '../../components/ui/Button.jsx';
import { Badge } from '../../components/ui/Badge.jsx';
import {
  useChangeOrderStatus, useCancelOrder,
} from '../../hooks/queries/useOrders.js';
import {
  getValidNextStatuses, STATUS_BADGE_VARIANT, isTerminal,
} from './_orderColumns.jsx';
import { cn } from '../../utils/cn.js';

/**
 * Dropdown that lets the admin move the order to a valid next status.
 *
 * Routing rules:
 *   - `CANCELLED` always goes through the dedicated /cancel endpoint
 *     (collects a reason, fires the cancellation events). Other
 *     transitions go through /status (just a state change + notes).
 *   - Terminal states (DELIVERED, CANCELLED) render a disabled button —
 *     no valid moves remain.
 *   - COMPLETED + DELIVERED transitions confirm before firing.
 */
export default function StatusChangeButton({ order }) {
  const changeStatus = useChangeOrderStatus();
  const cancelOrder = useCancelOrder();
  const validNext = getValidNextStatuses(order?.status);
  const disabled = isTerminal(order?.status) || validNext.length === 0;
  const pending = changeStatus.isPending || cancelOrder.isPending;

  const handleTransition = async (next) => {
    if (next === 'CANCELLED') {
      const reason = window.prompt(
        `Cancel ${order.orderNumber}? Enter a reason (3+ chars):`
      );
      if (!reason || reason.trim().length < 3) {
        if (reason !== null) toast.error('Reason must be at least 3 characters');
        return;
      }
      try { await cancelOrder.mutateAsync({ id: order._id, reason: reason.trim() }); }
      catch { /* toast surfaced */ }
      return;
    }

    // Heavy transitions confirm; lighter ones (IN_PROGRESS → CUTTING etc.)
    // don't, since they're routine workflow updates the admin clicks often.
    const heavy = ['COMPLETED', 'DELIVERED'].includes(next);
    if (heavy && !window.confirm(`Mark ${order.orderNumber} as ${next}?`)) return;

    try { await changeStatus.mutateAsync({ id: order._id, status: next }); }
    catch { /* toast surfaced */ }
  };

  return (
    <Menu as="div" className="relative inline-block text-left">
      <Menu.Button
        as="button"
        type="button"
        disabled={disabled || pending}
        className={cn(
          'inline-flex items-center gap-2 px-3 py-1.5 rounded-md border text-sm font-medium',
          'transition-colors duration-150',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          disabled
            ? 'border-secondary-300 bg-secondary-50 text-secondary-500'
            : 'border-primary-300 bg-primary-50 text-primary-800 hover:bg-primary-100',
        )}
      >
        <Workflow size={14} />
        <Badge variant={STATUS_BADGE_VARIANT[order?.status] || 'neutral'} size="sm">
          {order?.status || '—'}
        </Badge>
        {!disabled && <ChevronDown size={14} />}
      </Menu.Button>

      {!disabled && (
        <Transition
          as={Fragment}
          enter="transition ease-out duration-100" enterFrom="opacity-0 scale-95" enterTo="opacity-100 scale-100"
          leave="transition ease-in duration-75"   leaveFrom="opacity-100 scale-100" leaveTo="opacity-0 scale-95"
        >
          <Menu.Items className="absolute right-0 z-30 mt-1 w-48 origin-top-right rounded-md
                                 bg-white shadow-lg ring-1 ring-black/5 focus:outline-none">
            <div className="py-1">
              <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-secondary-500
                              border-b border-secondary-200">
                Move to
              </div>
              {validNext.map((next) => (
                <Menu.Item key={next}>
                  {({ active }) => (
                    <button
                      type="button"
                      onClick={() => handleTransition(next)}
                      className={cn(
                        'w-full flex items-center justify-between px-3 py-2 text-sm text-left',
                        active && 'bg-secondary-50',
                        next === 'CANCELLED' && 'text-danger-700',
                      )}
                    >
                      <span>{next}</span>
                      <Badge variant={STATUS_BADGE_VARIANT[next] || 'neutral'} size="sm">
                        {next === 'CANCELLED' ? 'cancel' : 'move'}
                      </Badge>
                    </button>
                  )}
                </Menu.Item>
              ))}
            </div>
          </Menu.Items>
        </Transition>
      )}
    </Menu>
  );
}
