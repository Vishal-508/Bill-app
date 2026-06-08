import { useState } from 'react';
import { Select } from '../../components/ui/Select.jsx';
import { Input } from '../../components/ui/Input.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Card } from '../../components/ui/Card.jsx';
import { useProductGrades } from '../../hooks/queries/useProductGrades.js';

const COMMON_THICKNESSES = ['6', '8', '12', '16', '18', '25'];

export default function ProductFilters({ values = {}, onApply, onReset }) {
  const gradesQuery = useProductGrades();
  const grades = gradesQuery.data?.data || [];

  const [local, setLocal] = useState({
    thicknessMM: values.thicknessMM ?? '',
    grade: values.grade ?? '',
    isActive: values.isActive ?? 'all',
    lowStock: values.lowStock ?? '',
  });

  const update = (k, v) => setLocal(p => ({ ...p, [k]: v }));
  const handleApply = () => onApply(local);
  const handleReset = () => {
    const empty = { thicknessMM: '', grade: '', isActive: 'all', lowStock: '' };
    setLocal(empty);
    onReset?.();
  };

  return (
    <Card>
      <Card.Body className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        <Select
          label="Thickness (mm)"
          size="sm"
          value={local.thicknessMM}
          onChange={(e) => update('thicknessMM', e.target.value)}
          placeholder="All"
          options={COMMON_THICKNESSES.map(t => ({ value: t, label: `${t}mm` }))}
        />

        <Select
          label="Grade"
          size="sm"
          value={local.grade}
          onChange={(e) => update('grade', e.target.value)}
          placeholder="All grades"
          options={grades.map(g => ({ value: g._id, label: g.label || g.code }))}
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
          label="Stock filter"
          size="sm"
          value={local.lowStock}
          onChange={(e) => update('lowStock', e.target.value)}
          placeholder="All"
          options={[
            { value: 'true',  label: 'Low stock only' },
            { value: 'false', label: 'In stock only' },
          ]}
        />
      </Card.Body>

      <Card.Footer className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={handleReset}>Reset</Button>
        <Button variant="primary" size="sm" onClick={handleApply}>Apply</Button>
      </Card.Footer>
    </Card>
  );
}
