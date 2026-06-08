import { useState } from 'react';
import { Select } from '../../components/ui/Select.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Card } from '../../components/ui/Card.jsx';

// Indian states + UTs — subset shown here; full list is in backend
// validators if expansion needed. Storage uses full state name to
// match backend's billingAddress.state field.
const STATES = [
  'Andhra Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Delhi', 'Gujarat',
  'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala',
  'Madhya Pradesh', 'Maharashtra', 'Odisha', 'Punjab', 'Rajasthan',
  'Tamil Nadu', 'Telangana', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
];

const SIZES = ['INDIVIDUAL', 'SMALL', 'MEDIUM', 'LARGE'];

/**
 * Collapsible filter panel for the customer list. State is local —
 * apply commits values up to the parent (which writes them into URL
 * search params), reset clears everything.
 *
 * NOTE: We expose `hasGST` (mapping to a Bill-Type radio) rather than
 * a fake `billType` field — backend stores no billType and the model
 * shape memory note documents the convention.
 */
export default function CustomerFilters({ values = {}, onApply, onReset }) {
  const [local, setLocal] = useState({
    hasGST: values.hasGST ?? 'all',
    state: values.state ?? '',
    isActive: values.isActive ?? 'all',
    size: values.size ?? '',
  });

  const update = (k, v) => setLocal(p => ({ ...p, [k]: v }));

  const handleApply = () => onApply(local);
  const handleReset = () => {
    const empty = { hasGST: 'all', state: '', isActive: 'all', size: '' };
    setLocal(empty);
    onReset?.();
  };

  return (
    <Card>
      <Card.Body className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        <Select
          label="Bill Type"
          size="sm"
          value={local.hasGST}
          onChange={(e) => update('hasGST', e.target.value)}
          options={[
            { value: 'all',   label: 'All' },
            { value: 'true',  label: 'GST customers' },
            { value: 'false', label: 'Non-GST customers' },
          ]}
        />

        <Select
          label="State"
          size="sm"
          value={local.state}
          onChange={(e) => update('state', e.target.value)}
          placeholder="All states"
          options={STATES.map(s => ({ value: s, label: s }))}
        />

        <Select
          label="Status"
          size="sm"
          value={local.isActive}
          onChange={(e) => update('isActive', e.target.value)}
          options={[
            { value: 'all',   label: 'All' },
            { value: 'true',  label: 'Active' },
            { value: 'false', label: 'Inactive' },
          ]}
        />

        <Select
          label="Business size"
          size="sm"
          value={local.size}
          onChange={(e) => update('size', e.target.value)}
          placeholder="All sizes"
          options={SIZES.map(s => ({ value: s, label: s }))}
        />
      </Card.Body>

      <Card.Footer className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={handleReset}>Reset</Button>
        <Button variant="primary" size="sm" onClick={handleApply}>Apply</Button>
      </Card.Footer>
    </Card>
  );
}
