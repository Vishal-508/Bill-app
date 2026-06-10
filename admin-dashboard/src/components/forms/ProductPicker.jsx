import { useState, useMemo } from 'react';
import { Combobox, Transition } from '@headlessui/react';
import { Check, ChevronsUpDown, Package } from 'lucide-react';
import { useProductsList } from '../../hooks/queries/useProducts.js';
import { useDebounce } from '../../hooks/useDebounce.js';
import { cn } from '../../utils/cn.js';
import { formatINR } from '../../utils/format.js';
import { stockBadge } from '../../pages/products/_productColumns.jsx';

/**
 * Reusable product typeahead picker — mirror of CustomerPicker.
 *
 * Props:
 *   value       — selected product's _id (or null)
 *   onChange    — receives the FULL product object on select
 *   label       — visible field label
 *   error       — error message below the input
 *   disabled    — disable the combobox
 *   excludeIds  — products already selected elsewhere on the form;
 *                 filtered out of suggestions so users don't add a
 *                 duplicate line item.
 *
 * Each dropdown item shows: SKU | name | thickness × LxW | stock badge | price.
 */
export default function ProductPicker({
  value, onChange, label, error, disabled = false, excludeIds = [],
}) {
  const [query, setQuery] = useState('');
  const debounced = useDebounce(query, 250);

  const queryParams = useMemo(() => ({
    search: debounced || undefined,
    limit: 10,
    isActive: 'true',
  }), [debounced]);

  const { data, isLoading } = useProductsList(queryParams);
  const products = (data?.data || []).filter(p => !excludeIds.includes(p._id));

  const selected = products.find(p => p._id === value) || null;

  return (
    <div className="w-full">
      {label && (
        <label className="block text-sm font-medium text-secondary-700 mb-1">
          {label}
        </label>
      )}
      <Combobox value={selected} onChange={(p) => onChange?.(p)} disabled={disabled}>
        <div className="relative">
          <div className={cn(
            'flex items-center w-full rounded-md border bg-white',
            'focus-within:ring-2 focus-within:ring-primary-400',
            error
              ? 'border-danger-400 focus-within:border-danger-500'
              : 'border-secondary-300 focus-within:border-primary-500',
            disabled && 'bg-secondary-50 cursor-not-allowed',
          )}>
            <Package size={16} className="ml-3 text-secondary-400 flex-shrink-0" />
            <Combobox.Input
              className="block w-full h-10 px-2 text-sm bg-transparent focus:outline-none
                         disabled:cursor-not-allowed"
              displayValue={(p) =>
                p ? `${p.sku} — ${p.name}` : ''
              }
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search SKU or name…"
              autoComplete="off"
            />
            <Combobox.Button className="px-2 text-secondary-400 hover:text-secondary-600">
              <ChevronsUpDown size={14} />
            </Combobox.Button>
          </div>

          <Transition
            enter="transition ease-out duration-100"
            enterFrom="opacity-0 translate-y-1" enterTo="opacity-100 translate-y-0"
            leave="transition ease-in duration-75"
            leaveFrom="opacity-100" leaveTo="opacity-0"
          >
            <Combobox.Options className="absolute z-30 mt-1 w-full max-h-72 overflow-auto
                                         rounded-md bg-white shadow-lg ring-1 ring-black/5">
              {isLoading && (
                <div className="px-3 py-2 text-xs text-secondary-500">Searching…</div>
              )}
              {!isLoading && products.length === 0 && (
                <div className="px-3 py-3 text-sm text-secondary-500">
                  No products match — try a different SKU or name.
                </div>
              )}
              {products.map((p) => {
                const stock = stockBadge(p.currentStock, p.minStockAlert);
                return (
                  <Combobox.Option
                    key={p._id} value={p}
                    className={({ active }) => cn(
                      'cursor-pointer px-3 py-2 flex items-start gap-2',
                      active && 'bg-primary-50',
                    )}
                  >
                    {({ selected: isSel }) => (
                      <>
                        <Check size={14} className={cn(
                          'mt-1 flex-shrink-0',
                          isSel ? 'text-primary-600' : 'text-transparent',
                        )} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono text-xs text-primary-700">
                              {p.sku}
                            </span>
                            <span className="text-xs font-medium text-secondary-900">
                              {formatINR(p.basePrice ?? 0)}
                            </span>
                          </div>
                          <div className="text-sm text-secondary-900 truncate">{p.name}</div>
                          <div className="mt-0.5 flex items-center gap-2 text-xs text-secondary-500">
                            <span>{p.thicknessMM}mm × {p.lengthFT}×{p.widthFT}ft</span>
                            <span className={cn(
                              'text-[10px] uppercase px-1.5 rounded',
                              stock.variant === 'success' && 'text-success-700 bg-success-50',
                              stock.variant === 'warning' && 'text-warning-700 bg-warning-50',
                              stock.variant === 'danger'  && 'text-danger-700 bg-danger-50',
                            )}>
                              {stock.label}
                            </span>
                          </div>
                        </div>
                      </>
                    )}
                  </Combobox.Option>
                );
              })}
            </Combobox.Options>
          </Transition>
        </div>
      </Combobox>
      {error && <p className="mt-1 text-xs text-danger-600">{error}</p>}
    </div>
  );
}
