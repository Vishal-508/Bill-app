import { Tab } from '@headlessui/react';
import { useSearchParams } from 'react-router-dom';
import { cn } from '../../utils/cn.js';
import OverviewTab from './tabs/OverviewTab.jsx';
import OrdersTab from './tabs/OrdersTab.jsx';
import BillsTab from './tabs/BillsTab.jsx';
import PaymentsTab from './tabs/PaymentsTab.jsx';

const TABS = ['overview', 'orders', 'bills', 'payments'];

/**
 * Tabbed view for the customer detail page. Active tab is persisted
 * in the URL as `?tab=orders` so the back button + page reload keep
 * the user where they were. Tab counts (e.g. "Orders (23)") are
 * sourced from the insights payload when available.
 */
export default function CustomerTabs({ customer, insights }) {
  const [params, setParams] = useSearchParams();
  const active = TABS.indexOf(params.get('tab') || 'overview');
  const selectedIndex = active >= 0 ? active : 0;

  const handleChange = (idx) => {
    const next = TABS[idx];
    setParams((p) => {
      if (next === 'overview') p.delete('tab');
      else p.set('tab', next);
      return p;
    }, { replace: true });
  };

  const orderCount = insights?.totalOrders ?? null;

  const tabs = [
    { label: 'Overview',               render: () => <OverviewTab customer={customer} /> },
    { label: orderCount != null ? `Orders (${orderCount})` : 'Orders',
                                       render: () => <OrdersTab customerId={customer._id} /> },
    { label: 'Bills',                  render: () => <BillsTab customerId={customer._id} /> },
    { label: 'Payments',               render: () => <PaymentsTab customerId={customer._id} /> },
  ];

  return (
    <Tab.Group selectedIndex={selectedIndex} onChange={handleChange}>
      <Tab.List className="flex gap-1 border-b border-secondary-200 mb-4">
        {tabs.map((t, i) => (
          <Tab key={i} className={({ selected }) => cn(
            'px-4 py-2 text-sm font-medium border-b-2 -mb-px',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded-t-sm',
            selected
              ? 'border-primary-600 text-primary-700'
              : 'border-transparent text-secondary-600 hover:text-secondary-900 hover:border-secondary-300',
          )}>
            {t.label}
          </Tab>
        ))}
      </Tab.List>
      <Tab.Panels>
        {tabs.map((t, i) => (
          <Tab.Panel key={i} className="focus:outline-none">
            {t.render()}
          </Tab.Panel>
        ))}
      </Tab.Panels>
    </Tab.Group>
  );
}

// Exported for tests
export const _internals = { TABS };
