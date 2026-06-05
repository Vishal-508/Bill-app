import { Fragment } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { Popover, Transition } from '@headlessui/react';
import { Bell, CheckCheck, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  selectNotifications, selectUnreadCount,
} from '../../store/index.js';
import {
  markAsRead, markAllAsRead, clearAll,
} from '../../store/notifications.slice.js';
import { EmptyState } from '../ui/EmptyState.jsx';
import NotificationItem from './NotificationItem.jsx';

export default function NotificationDropdown() {
  const items = useSelector(selectNotifications);
  const unreadCount = useSelector(selectUnreadCount);
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const recent = items.slice(0, 10);

  const handleItemClick = (item, close) => {
    if (!item.read) dispatch(markAsRead(item.id));
    if (item.link) navigate(item.link);
    close();
  };

  return (
    <Popover className="relative">
      {({ close }) => (
        <>
          <Popover.Button
            aria-label={`Notifications${unreadCount ? ` (${unreadCount} unread)` : ''}`}
            className="relative p-2 rounded-md text-secondary-700 hover:bg-secondary-100
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          >
            <Bell size={18} />
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 inline-flex items-center justify-center
                               min-w-[16px] h-4 px-1 rounded-full bg-danger-500 text-white
                               text-[10px] font-medium">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </Popover.Button>

          <Transition
            as={Fragment}
            enter="transition ease-out duration-150" enterFrom="opacity-0 translate-y-1" enterTo="opacity-100 translate-y-0"
            leave="transition ease-in duration-100"  leaveFrom="opacity-100 translate-y-0" leaveTo="opacity-0 translate-y-1"
          >
            <Popover.Panel className="absolute right-0 mt-2 w-96 max-h-[32rem] z-30
                                      flex flex-col rounded-lg bg-white shadow-lg
                                      ring-1 ring-black/5 overflow-hidden">
              <div className="px-4 py-3 border-b border-secondary-200 flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-secondary-900">Notifications</h3>
                  {unreadCount > 0 && (
                    <p className="text-xs text-secondary-500">{unreadCount} unread</p>
                  )}
                </div>
                {items.length > 0 && (
                  <div className="flex items-center gap-1">
                    {unreadCount > 0 && (
                      <button
                        type="button"
                        onClick={() => dispatch(markAllAsRead())}
                        title="Mark all as read"
                        className="p-1.5 rounded text-secondary-600 hover:bg-secondary-100"
                      >
                        <CheckCheck size={16} />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => dispatch(clearAll())}
                      title="Clear all"
                      className="p-1.5 rounded text-secondary-600 hover:bg-secondary-100"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                )}
              </div>

              <div className="flex-1 overflow-y-auto">
                {recent.length === 0 ? (
                  <EmptyState
                    icon={<Bell size={24} />}
                    title="No notifications"
                    description="Real-time events will appear here"
                  />
                ) : (
                  recent.map(item => (
                    <NotificationItem
                      key={item.id}
                      item={item}
                      onClick={() => handleItemClick(item, close)}
                    />
                  ))
                )}
              </div>

              {items.length > 10 && (
                <div className="px-4 py-2 border-t border-secondary-200 text-center">
                  <span className="text-xs text-secondary-500">
                    Showing 10 of {items.length}
                  </span>
                </div>
              )}
            </Popover.Panel>
          </Transition>
        </>
      )}
    </Popover>
  );
}
