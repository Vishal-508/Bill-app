import { Tab } from '@headlessui/react';
import { useSearchParams } from 'react-router-dom';
import { cn } from '../../utils/cn.js';
import BillItemsTab from './tabs/BillItemsTab.jsx';
import BillPaymentsTab from './tabs/BillPaymentsTab.jsx';

const TABS = ['items', 'payments'];

export default function BillTabs({ bill }) {
  const [params, setParams] = useSearchParams();
  const active = TABS.indexOf(params.get('tab') || 'items');
  const selectedIndex = active >= 0 ? active : 0;

  const handleChange = (idx) => {
    const next = TABS[idx];
    setParams((p) => {
      if (next === 'items') p.delete('tab');
      else p.set('tab', next);
      return p;
    }, { replace: true });
  };

  const itemCount = Array.isArray(bill?.items) ? bill.items.length : 0;

  const tabs = [
    { label: `Items${itemCount ? ` (${itemCount})` : ''}`, render: () => <BillItemsTab bill={bill} /> },
    { label: 'Payments',                                    render: () => <BillPaymentsTab bill={bill} /> },
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
          <Tab.Panel key={i} className="focus:outline-none">{t.render()}</Tab.Panel>
        ))}
      </Tab.Panels>
    </Tab.Group>
  );
}

export const _internals = { TABS };
