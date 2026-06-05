import { Fragment, useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useLocation, NavLink } from 'react-router-dom';
import { Dialog, Transition } from '@headlessui/react';
import { X } from 'lucide-react';
import { selectUI, selectUser } from '../../store/index.js';
import { closeMobileMenu } from '../../store/ui.slice.js';
import { NAV_ITEMS } from './Sidebar.jsx';
import { cn } from '../../utils/cn.js';
import { Badge } from '../ui/Badge.jsx';

/**
 * Slide-over drawer for mobile (< lg). Mirrors the desktop sidebar
 * nav. Auto-closes on route change so a successful tap doesn't leave
 * the drawer covering the new page.
 */
export default function MobileMenu() {
  const dispatch = useDispatch();
  const { mobileMenuOpen } = useSelector(selectUI);
  const user = useSelector(selectUser);
  const location = useLocation();

  // Close on every route change. Empty dep on `mobileMenuOpen` so the
  // close action only fires when the path actually changes.
  useEffect(() => {
    if (mobileMenuOpen) dispatch(closeMobileMenu());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  return (
    <Transition show={!!mobileMenuOpen} as={Fragment}>
      <Dialog
        as="div"
        className="relative z-40 lg:hidden"
        onClose={() => dispatch(closeMobileMenu())}
      >
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-200" enterFrom="opacity-0" enterTo="opacity-100"
          leave="ease-in duration-150" leaveFrom="opacity-100" leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-secondary-900/50" aria-hidden="true" />
        </Transition.Child>

        <div className="fixed inset-0 flex">
          <Transition.Child
            as={Fragment}
            enter="transition ease-in-out duration-200 transform"
            enterFrom="-translate-x-full" enterTo="translate-x-0"
            leave="transition ease-in-out duration-150 transform"
            leaveFrom="translate-x-0" leaveTo="-translate-x-full"
          >
            <Dialog.Panel className="relative flex w-72 flex-col bg-white shadow-xl">
              <div className="h-14 px-5 flex items-center justify-between border-b border-secondary-200">
                <div className="text-base font-semibold text-secondary-900">
                  Shree Gopal MDF
                </div>
                <button
                  type="button"
                  onClick={() => dispatch(closeMobileMenu())}
                  aria-label="Close menu"
                  className="p-1.5 rounded text-secondary-500 hover:bg-secondary-100"
                >
                  <X size={18} />
                </button>
              </div>

              <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
                {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
                  <NavLink
                    key={to}
                    to={to}
                    className={({ isActive }) => cn(
                      'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium',
                      isActive
                        ? 'bg-primary-50 text-primary-700'
                        : 'text-secondary-700 hover:bg-secondary-100',
                    )}
                  >
                    <Icon size={18} aria-hidden="true" />
                    <span>{label}</span>
                  </NavLink>
                ))}
              </nav>

              {user && (
                <div className="border-t border-secondary-200 px-4 py-3">
                  <div className="text-xs text-secondary-500">Logged in as</div>
                  <div className="text-sm font-medium text-secondary-900 truncate">
                    {user.name || user.email}
                  </div>
                  {user.role && (
                    <Badge variant="info" size="sm" className="mt-1">{user.role}</Badge>
                  )}
                </div>
              )}
            </Dialog.Panel>
          </Transition.Child>
        </div>
      </Dialog>
    </Transition>
  );
}
