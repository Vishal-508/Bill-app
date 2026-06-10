import { useState } from 'react';
import { Select } from '../../components/ui/Select.jsx';
import { Input } from '../../components/ui/Input.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Card } from '../../components/ui/Card.jsx';
import CustomerPicker from '../../components/forms/CustomerPicker.jsx';

const STATUS_OPTIONS = [
  { value: '',          label: 'All statuses' },
  { value: 'CREATED',   label: 'Created' },
  { value: 'ATTEMPTED', label: 'Attempted' },
  { value: 'AUTHORIZED', label: 'Authorized' },
  { value: 'CAPTURED',  label: 'Captured (success)' },
  { value: 'FAILED',    label: 'Failed' },
  { value: 'REFUNDED',  label: 'Refunded' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

const METHOD_OPTIONS = [
  { value: '',           label: 'All methods' },
  { value: 'upi',        label: 'UPI' },
  { value: 'card',       label: 'Card' },
  { value: 'netbanking', label: 'Net Banking' },
  { value: 'wallet',     label: 'Wallet' },
  { value: 'emi',        label: 'EMI' },
  { value: 'other',      label: 'Other' },
];

const GATEWAY_OPTIONS = [
  { value: '',         label: 'All gateways' },
  { value: 'razorpay', label: 'Razorpay' },
  { value: 'manual',   label: 'Manual' },
  { value: 'mock',     label: 'Mock' },
];

export default function PaymentFilters({ values = {}, onApply, onReset }) {
  const [local, setLocal] = useState({
    status:   values.status ?? '',
    method:   values.method ?? '',
    gateway:  values.gateway ?? '',
    customer: values.customer ?? '',
    dateFrom: values.dateFrom ?? '',
    dateTo:   values.dateTo ?? '',
    minTotal: values.minTotal ?? '',
    maxTotal: values.maxTotal ?? '',
  });
  const [selectedCustomer, setSelectedCustomer] = useState(null);

  const update = (k, v) => setLocal(p => ({ ...p, [k]: v }));

  const handleApply = () => onApply(local);
  const handleReset = () => {
    const empty = {
      status: '', method: '', gateway: '', customer: '',
      dateFrom: '', dateTo: '', minTotal: '', maxTotal: '',
    };
    setLocal(empty);
    setSelectedCustomer(null);
    onReset?.();
  };

  return (
    <Card>
      <Card.Body className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        <Select label="Status" size="sm" value={local.status}
          onChange={(e) => update('status', e.target.value)}
          options={STATUS_OPTIONS} />
        <Select label="Method" size="sm" value={local.method}
          onChange={(e) => update('method', e.target.value)}
          options={METHOD_OPTIONS} />
        <Select label="Gateway" size="sm" value={local.gateway}
          onChange={(e) => update('gateway', e.target.value)}
          options={GATEWAY_OPTIONS} />

        <div className="sm:col-span-2 lg:col-span-1">
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

        <Input label="From date" type="date" size="sm"
          value={local.dateFrom}
          onChange={(e) => update('dateFrom', e.target.value)} />
        <Input label="To date" type="date" size="sm"
          value={local.dateTo}
          onChange={(e) => update('dateTo', e.target.value)} />
        <Input label="Min amount (₹)" type="number" min={0} size="sm"
          value={local.minTotal}
          onChange={(e) => update('minTotal', e.target.value)} />
        <Input label="Max amount (₹)" type="number" min={0} size="sm"
          value={local.maxTotal}
          onChange={(e) => update('maxTotal', e.target.value)} />
      </Card.Body>

      <Card.Footer className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={handleReset}>Reset</Button>
        <Button variant="primary" size="sm" onClick={handleApply}>Apply</Button>
      </Card.Footer>
    </Card>
  );
}
