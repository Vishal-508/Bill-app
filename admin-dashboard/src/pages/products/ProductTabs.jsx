import { Tab } from '@headlessui/react';
import { useSearchParams } from 'react-router-dom';
import { cn } from '../../utils/cn.js';
import SpecificationsTab from './tabs/SpecificationsTab.jsx';
import StockMovementsTab from './tabs/StockMovementsTab.jsx';
import ForecastTab from './tabs/ForecastTab.jsx';

const TABS = ['specs', 'stock', 'forecast'];

export default function ProductTabs({ product }) {
  const [params, setParams] = useSearchParams();
  const active = TABS.indexOf(params.get('tab') || 'specs');
  const selectedIndex = active >= 0 ? active : 0;

  const handleChange = (idx) => {
    const next = TABS[idx];
    setParams((p) => {
      if (next === 'specs') p.delete('tab');
      else p.set('tab', next);
      return p;
    }, { replace: true });
  };

  const tabs = [
    { label: 'Specifications',  render: () => <SpecificationsTab product={product} /> },
    { label: 'Stock Movements', render: () => <StockMovementsTab productId={product._id} /> },
    { label: 'Forecast',        render: () => <ForecastTab product={product} /> },
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
