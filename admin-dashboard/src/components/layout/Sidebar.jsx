import { NavLink } from 'react-router-dom';
import { useSelector } from 'react-redux';
import {
  LayoutDashboard, ShoppingCart, Users, Package, FileText, CreditCard,
  Warehouse, BarChart3, MessageSquare, Building2, ShoppingBag, Settings,
} from 'lucide-react';
import { selectUI, selectUser } from '../../store/index.js';
import { cn } from '../../utils/cn.js';
import { Badge } from '../ui/Badge.jsx';
import { ROUTES } from '../../utils/constants.js';

export const NAV_ITEMS = [
  { to: ROUTES.DASHBOARD, icon: LayoutDashboard, label: 'Dashboard' },
  { to: ROUTES.ORDERS,    icon: ShoppingCart,    label: 'Orders' },
  { to: ROUTES.CUSTOMERS, icon: Users,           label: 'Customers' },
  { to: ROUTES.PRODUCTS,  icon: Package,         label: 'Products' },
  { to: ROUTES.BILLS,     icon: FileText,        label: 'Bills' },
  { to: ROUTES.PAYMENTS,  icon: CreditCard,      label: 'Payments' },
  { to: ROUTES.INVENTORY, icon: Warehouse,       label: 'Inventory' },
  { to: ROUTES.ANALYTICS, icon: BarChart3,       label: 'Analytics' },
  { to: ROUTES.WHATSAPP,  icon: MessageSquare,   label: 'WhatsApp' },
  { to: ROUTES.VENDORS,   icon: Building2,       label: 'Vendors' },
  { to: ROUTES.PURCHASES, icon: ShoppingBag,     label: 'Purchases' },
  { to: ROUTES.SETTINGS,  icon: Settings,        label: 'Settings' },
];

const ROLE_BADGE_VARIANT = {
  SUPER_ADMIN: 'danger',
  ADMIN:       'info',
  BILLING:     'success',
  CUTTING:     'warning',
  DELIVERY:    'neutral',
};

export default function Sidebar() {
  const { sidebarOpen } = useSelector(selectUI);
  const user = useSelector(selectUser);

  return (
    <aside
      className={cn(
        // Fixed positioning so main content can margin-left around it
        'fixed inset-y-0 left-0 z-30 w-60 flex flex-col',
        'bg-white border-r border-secondary-200',
        // Hidden on mobile (MobileMenu takes over below `lg`)
        'hidden lg:flex',
        // Slide off-screen when sidebarOpen=false
        'transition-transform duration-200',
        sidebarOpen ? 'translate-x-0' : '-translate-x-full',
      )}
      aria-label="Primary"
    >
      {/* Logo / title */}
      <div className="h-14 px-5 flex items-center border-b border-secondary-200">
        <div className="text-base font-semibold text-secondary-900">
          Shree Gopal MDF
        </div>
      </div>

      {/* Nav items */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
        {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium',
                'transition-colors duration-100',
                isActive
                  ? 'bg-primary-50 text-primary-700'
                  : 'text-secondary-700 hover:bg-secondary-100',
              )
            }
          >
            <Icon size={18} aria-hidden="true" />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      {/* User footer */}
      {user && (
        <div className="border-t border-secondary-200 px-4 py-3">
          <div className="text-xs text-secondary-500">Logged in as</div>
          <div className="text-sm font-medium text-secondary-900 truncate">
            {user.name || user.email}
          </div>
          {user.role && (
            <Badge variant={ROLE_BADGE_VARIANT[user.role] || 'neutral'} size="sm" className="mt-1">
              {user.role}
            </Badge>
          )}
        </div>
      )}
    </aside>
  );
}
