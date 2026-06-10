import { useState } from 'react';
import { Select } from '../../components/ui/Select.jsx';
import { Input } from '../../components/ui/Input.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Card } from '../../components/ui/Card.jsx';
import CustomerPicker from '../../components/forms/CustomerPicker.jsx';
import { ALL_STATUSES } from './_orderColumns.jsx';

const PAYMENT_OPTIONS = [
  { value: 'all',     label: 'All' },
  { value: 'UNPAID',  label: 'Unpaid' },
  { value: 'PARTIAL', label: 'Partial' },
  { value: 'PAID',    label: 'Paid' },
];

export default function OrderFilters({ values = {}, onApply, onReset }) {
  const [local, setLocal] = useState({
    status:         values.status ?? '',
    paymentStatus:  values.paymentStatus ?? 'all',
    customer:       values.customer ?? '',
    dateFrom:       values.dateFrom ?? '',
    dateTo:         values.dateTo ?? '',
    minTotal:       values.minTotal ?? '',
    maxTotal:       values.maxTotal ?? '',
  });
  // Picker needs the full customer object to render; the parent passes
  // only the id back. Tiny side-state to hold the selection during the
  // filter session — once the user clicks Apply, it goes into the URL.
  const [selectedCustomer, setSelectedCustomer] = useState(null);

  const update = (k, v) => setLocal(p => ({ ...p, [k]: v }));

  const handleApply = () => onApply(local);
  const handleReset = () => {
    const empty = {
      status: '', paymentStatus: 'all', customer: '',
      dateFrom: '', dateTo: '', minTotal: '', maxTotal: '',
    };
    setLocal(empty);
    setSelectedCustomer(null);
    onReset?.();
  };

  return (
    <Card>
      <Card.Body className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        <Select
          label="Status"
          size="sm"
          value={local.status}
          onChange={(e) => update('status', e.target.value)}
          placeholder="All statuses"
          options={ALL_STATUSES.map(s => ({ value: s, label: s }))}
        />

        <Select
          label="Payment"
          size="sm"
          value={local.paymentStatus}
          onChange={(e) => update('paymentStatus', e.target.value)}
          options={PAYMENT_OPTIONS}
        />

        <div className="sm:col-span-2">
          <CustomerPicker
            label="Customer"
            value={selectedCustomer?._id || ''}
            onChange={(c) => {
              setSelectedCustomer(c);
              update('customer', c?._id || '');
            }}
            placeholder="Filter by customer…"
          />
        </div>

        <Input
          label="From date"
          type="date"
          size="sm"
          value={local.dateFrom}
          onChange={(e) => update('dateFrom', e.target.value)}
        />

        <Input
          label="To date"
          type="date"
          size="sm"
          value={local.dateTo}
          onChange={(e) => update('dateTo', e.target.value)}
        />

        <Input
          label="Min total (₹)"
          type="number"
          size="sm"
          min={0}
          value={local.minTotal}
          onChange={(e) => update('minTotal', e.target.value)}
        />

        <Input
          label="Max total (₹)"
          type="number"
          size="sm"
          min={0}
          value={local.maxTotal}
          onChange={(e) => update('maxTotal', e.target.value)}
        />
      </Card.Body>

      <Card.Footer className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={handleReset}>Reset</Button>
        <Button variant="primary" size="sm" onClick={handleApply}>Apply</Button>
      </Card.Footer>
    </Card>
  );
}
