import { Fragment } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useLocation, useNavigate } from 'react-router-dom';
import { Menu, Transition } from '@headlessui/react';
import {
  Menu as MenuIcon, PanelLeft, ChevronDown, User, Settings, LogOut,
} from 'lucide-react';
import {
  selectUser, selectUI,
} from '../../store/index.js';
import { logoutThunk } from '../../store/auth.slice.js';
import { toggleSidebar, toggleMobileMenu } from '../../store/ui.slice.js';
import { cn } from '../../utils/cn.js';
import { ROUTES } from '../../utils/constants.js';
import NotificationDropdown from '../notifications/NotificationDropdown.jsx';

// Map pathname → page title for the topbar heading. Section F's
// useSocket will keep notif badge in sync; for now it reads from
// notifications.slice which the store already provides.
const ROUTE_TITLES = {
  [ROUTES.DASHBOARD]: 'Dashboard',
  [ROUTES.ORDERS]:    'Orders',
  [ROUTES.CUSTOMERS]: 'Customers',
  [ROUTES.PRODUCTS]:  'Products',
  [ROUTES.BILLS]:     'Bills',
  [ROUTES.PAYMENTS]:  'Payments',
  [ROUTES.INVENTORY]: 'Inventory',
  [ROUTES.ANALYTICS]: 'Analytics',
  [ROUTES.WHATSAPP]:  'WhatsApp',
  [ROUTES.VENDORS]:   'Vendors',
  [ROUTES.PURCHASES]: 'Purchases',
  [ROUTES.SETTINGS]:  'Settings',
};

export default function Topbar() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const user = useSelector(selectUser);
  const { pageTitle } = useSelector(selectUI);

  const title = pageTitle || ROUTE_TITLES[location.pathname] || '';

  const handleLogout = async () => {
    await dispatch(logoutThunk());
    navigate(ROUTES.LOGIN, { replace: true });
  };

  return (
    <header className="sticky top-0 z-20 h-14 bg-white border-b border-secondary-200 px-4 lg:px-6
                       flex items-center gap-3">
      {/* Mobile hamburger */}
      <button
        type="button"
        onClick={() => dispatch(toggleMobileMenu())}
        aria-label="Open menu"
        className="lg:hidden p-2 -ml-2 rounded-md text-secondary-700 hover:bg-secondary-100"
      >
        <MenuIcon size={20} />
      </button>

      {/* Desktop sidebar toggle */}
      <button
        type="button"
        onClick={() => dispatch(toggleSidebar())}
        aria-label="Toggle sidebar"
        className="hidden lg:inline-flex p-2 -ml-2 rounded-md text-secondary-700 hover:bg-secondary-100"
      >
        <PanelLeft size={18} />
      </button>

      {/* Page title */}
      {title && (
        <h1 className="text-base font-semibold text-secondary-900 truncate">
          {title}
        </h1>
      )}

      {/* Right cluster */}
      <div className="ml-auto flex items-center gap-2">
        {/* Search placeholder (functional in a later prompt) */}
        <div className="hidden md:flex items-center gap-2 h-9 px-3 rounded-md
                        border border-secondary-200 bg-secondary-50 text-xs text-secondary-500 w-64">
          <span>Search…</span>
          <kbd className="ml-auto rounded bg-white border border-secondary-200 px-1.5 py-0.5 text-[10px]">
            Ctrl+K
          </kbd>
        </div>

        {/* Notifications — dropdown with mark-read + clear actions */}
        <NotificationDropdown />

        {/* User dropdown */}
        {user && (
          <Menu as="div" className="relative">
            <Menu.Button className="flex items-center gap-2 h-9 px-2 rounded-md hover:bg-secondary-100">
              <div className="h-7 w-7 rounded-full bg-primary-600 text-white inline-flex items-center justify-center text-xs font-semibold">
                {(user.name || user.email || '?').charAt(0).toUpperCase()}
              </div>
              <span className="hidden md:inline text-sm text-secondary-900 truncate max-w-[120px]">
                {user.name || user.email}
              </span>
              <ChevronDown size={14} className="text-secondary-500" />
            </Menu.Button>

            <Transition
              as={Fragment}
              enter="transition ease-out duration-100" enterFrom="opacity-0 scale-95" enterTo="opacity-100 scale-100"
              leave="transition ease-in duration-75"   leaveFrom="opacity-100 scale-100" leaveTo="opacity-0 scale-95"
            >
              <Menu.Items className="absolute right-0 mt-1 w-56 origin-top-right rounded-md bg-white shadow-lg
                                     ring-1 ring-black/5 focus:outline-none z-30">
                <div className="px-3 py-2 border-b border-secondary-200">
                  <div className="text-sm font-medium text-secondary-900 truncate">
                    {user.name || user.email}
                  </div>
                  <div className="text-xs text-secondary-500">{user.email}</div>
                </div>
                <div className="py-1">
                  <Menu.Item>
                    {({ active }) => (
                      <button
                        type="button"
                        onClick={() => navigate(ROUTES.SETTINGS)}
                        className={cn(
                          'w-full flex items-center gap-2 px-3 py-2 text-sm text-left',
                          active ? 'bg-secondary-50' : '',
                        )}
                      >
                        <User size={14} /> Profile
                      </button>
                    )}
                  </Menu.Item>
                  <Menu.Item>
                    {({ active }) => (
                      <button
                        type="button"
                        onClick={() => navigate(ROUTES.SETTINGS)}
                        className={cn(
                          'w-full flex items-center gap-2 px-3 py-2 text-sm text-left',
                          active ? 'bg-secondary-50' : '',
                        )}
                      >
                        <Settings size={14} /> Settings
                      </button>
                    )}
                  </Menu.Item>
                </div>
                <div className="py-1 border-t border-secondary-200">
                  <Menu.Item>
                    {({ active }) => (
                      <button
                        type="button"
                        onClick={handleLogout}
                        className={cn(
                          'w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-danger-700',
                          active ? 'bg-danger-50' : '',
                        )}
                      >
                        <LogOut size={14} /> Logout
                      </button>
                    )}
                  </Menu.Item>
                </div>
              </Menu.Items>
            </Transition>
          </Menu>
        )}
      </div>
    </header>
  );
}
