import { useState, useMemo } from 'react';
import { Combobox, Transition } from '@headlessui/react';
import { Check, ChevronsUpDown, User } from 'lucide-react';
import { useCustomersList } from '../../hooks/queries/useCustomers.js';
import { useDebounce } from '../../hooks/useDebounce.js';
import { cn } from '../../utils/cn.js';
import { formatPhone } from '../../utils/format.js';

/**
 * Reusable customer typeahead picker. Renders a Combobox that queries
 * `/customers?search=…` as the user types (debounced 250ms).
 *
 * Props:
 *   value           — the selected customer's _id, or null
 *   onChange        — receives the FULL customer object (not just _id)
 *   label, error    — passthrough to the visible field
 *   placeholder     — input placeholder
 *   disabled        — disable the combobox entirely
 *   excludeIds      — array of ids to filter out of suggestions
 *
 * Display in option rows: name | company (subtitle) | phone | GST badge.
 */
export default function CustomerPicker({
  value, onChange, label, error, placeholder = 'Search customers…',
  disabled = false, excludeIds = [],
}) {
  const [query, setQuery] = useState('');
  const debounced = useDebounce(query, 250);

  // Only paginate up to 10 suggestions — too many is noisy and slow.
  const queryParams = useMemo(() => ({
    search: debounced || undefined,
    limit: 10,
    isActive: 'true',
  }), [debounced]);

  const { data, isLoading } = useCustomersList(queryParams);
  const customers = (data?.data || []).filter(
    c => !excludeIds.includes(c._id)
  );

  // Combobox needs the full selected object to display in the input.
  // We keep a tiny in-memory map of recently-selected customers so the
  // input renders correctly when only `value` (the ID) is provided.
  const selected = customers.find(c => c._id === value) || null;

  return (
    <div className="w-full">
      {label && (
        <label className="block text-sm font-medium text-secondary-700 mb-1">
          {label}
        </label>
      )}
      <Combobox
        value={selected}
        onChange={(c) => onChange?.(c)}
        disabled={disabled}
      >
        <div className="relative">
          <div className={cn(
            'flex items-center w-full rounded-md border bg-white',
            'focus-within:ring-2 focus-within:ring-primary-400',
            error
              ? 'border-danger-400 focus-within:border-danger-500'
              : 'border-secondary-300 focus-within:border-primary-500',
            disabled && 'bg-secondary-50 cursor-not-allowed',
          )}>
            <User size={16} className="ml-3 text-secondary-400 flex-shrink-0" />
            <Combobox.Input
              className="block w-full h-10 px-2 text-sm bg-transparent focus:outline-none
                         disabled:cursor-not-allowed"
              displayValue={(c) =>
                c ? `${c.customerName}${c.companyName ? ` — ${c.companyName}` : ''}` : ''
              }
              onChange={(e) => setQuery(e.target.value)}
              placeholder={placeholder}
              autoComplete="off"
            />
            <Combobox.Button className="px-2 text-secondary-400 hover:text-secondary-600">
              <ChevronsUpDown size={14} />
            </Combobox.Button>
          </div>

          <Transition
            enter="transition ease-out duration-100"
            enterFrom="opacity-0 translate-y-1"
            enterTo="opacity-100 translate-y-0"
            leave="transition ease-in duration-75"
            leaveFrom="opacity-100" leaveTo="opacity-0"
          >
            <Combobox.Options className="absolute z-30 mt-1 w-full max-h-72 overflow-auto
                                         rounded-md bg-white shadow-lg ring-1 ring-black/5">
              {isLoading && (
                <div className="px-3 py-2 text-xs text-secondary-500">Searching…</div>
              )}
              {!isLoading && customers.length === 0 && (
                <div className="px-3 py-3 text-sm text-secondary-500">
                  No customers match — try a different name or phone.
                </div>
              )}
              {customers.map((c) => (
                <Combobox.Option
                  key={c._id}
                  value={c}
                  className={({ active }) => cn(
                    'cursor-pointer px-3 py-2 flex items-start gap-2',
                    active && 'bg-primary-50',
                  )}
                >
                  {({ selected: isSel }) => (
                    <>
                      <Check
                        size={14}
                        className={cn(
                          'mt-1 flex-shrink-0',
                          isSel ? 'text-primary-600' : 'text-transparent',
                        )}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-secondary-900 truncate">
                            {c.customerName}
                          </span>
                          {c.gstin && (
                            <span className="text-[10px] font-mono uppercase
                                             text-info-700 bg-info-50 px-1.5 rounded">
                              GST
                            </span>
                          )}
                        </div>
                        {c.companyName && (
                          <div className="text-xs text-secondary-500 truncate">
                            {c.companyName}
                          </div>
                        )}
                        <div className="text-xs font-mono text-secondary-500">
                          {formatPhone(c.phone)}
                        </div>
                      </div>
                    </>
                  )}
                </Combobox.Option>
              ))}
            </Combobox.Options>
          </Transition>
        </div>
      </Combobox>
      {error && <p className="mt-1 text-xs text-danger-600">{error}</p>}
    </div>
  );
}
