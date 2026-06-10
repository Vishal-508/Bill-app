import { useFieldArray, useFormContext, Controller } from 'react-hook-form';
import { Trash2, Plus, AlertTriangle } from 'lucide-react';
import { Button } from '../../components/ui/Button.jsx';
import { Input } from '../../components/ui/Input.jsx';
import { Select } from '../../components/ui/Select.jsx';
import { Alert } from '../../components/ui/Alert.jsx';
import ProductPicker from '../../components/forms/ProductPicker.jsx';
import { calculateLineTotal } from '../../utils/gstCalculator.js';
import { formatINR } from '../../utils/format.js';
import { stockBadge } from '../products/_productColumns.jsx';

const EMPTY_ITEM = {
  product: '',
  productSnapshot: null,
  quantity: 1,
  pricePerUnit: 0,
  discountMode: 'percent',
  discountValue: 0,
};

/**
 * Items section of the order form. Uses RHF's useFieldArray so adding/
 * removing rows doesn't lose user input on intermediate re-renders.
 *
 * Each row is rendered as a card (mobile-friendly) with sticky-column
 * labels rather than a strict table — the form already lives in a
 * scrollable modal and a stiff table layout would push the summary
 * off-screen on mid-size laptops.
 */
export default function OrderItemsBuilder() {
  const { control, register, watch, setValue, formState: { errors } } = useFormContext();
  const { fields, append, remove } = useFieldArray({ control, name: 'items' });
  const watchedItems = watch('items') || [];

  const handlePickProduct = (idx, product) => {
    if (!product) return;
    setValue(`items.${idx}.product`, product._id, { shouldValidate: true });
    setValue(`items.${idx}.productSnapshot`, {
      _id: product._id,
      sku: product.sku,
      name: product.name,
      thicknessMM: product.thicknessMM,
      lengthFT: product.lengthFT,
      widthFT: product.widthFT,
      basePrice: product.basePrice,
      currentStock: product.currentStock,
      minStockAlert: product.minStockAlert,
    });
    // Auto-fill rate from base price if user hasn't edited
    const current = watchedItems[idx];
    if (!current?.pricePerUnit || +current.pricePerUnit === 0) {
      setValue(`items.${idx}.pricePerUnit`, product.basePrice ?? 0,
        { shouldValidate: true });
    }
  };

  const excludeIds = watchedItems.map(i => i.product).filter(Boolean);

  return (
    <div className="space-y-3">
      {fields.length === 0 && (
        <Alert variant="warning">No items yet. Click "+ Add item" to get started.</Alert>
      )}

      {fields.map((field, idx) => {
        const row = watchedItems[idx] || {};
        const snap = row.productSnapshot;
        const lineTotal = calculateLineTotal(row);
        const stockShort = snap && (+row.quantity || 0) > (snap.currentStock ?? 0);
        const itemErrors = errors.items?.[idx] || {};

        return (
          <div key={field.id} className="border border-secondary-200 rounded-md p-3 space-y-2">
            {/* Picker row */}
            <div className="grid gap-2 grid-cols-12 items-start">
              <div className="col-span-12 sm:col-span-7">
                <Controller
                  name={`items.${idx}.product`}
                  control={control}
                  render={({ field: f }) => (
                    <ProductPicker
                      label={`Item ${idx + 1}`}
                      value={f.value || ''}
                      onChange={(p) => handlePickProduct(idx, p)}
                      error={itemErrors.product?.message}
                      excludeIds={excludeIds.filter(id => id !== f.value)}
                    />
                  )}
                />
              </div>

              <div className="col-span-12 sm:col-span-5 flex items-end gap-2 justify-end">
                <Button
                  variant="ghost" size="sm"
                  leftIcon={<Trash2 size={14} />}
                  onClick={() => remove(idx)}
                  className="!text-danger-700 hover:!bg-danger-50"
                >
                  Remove
                </Button>
              </div>
            </div>

            {/* Picked product snapshot */}
            {snap && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-secondary-600
                              bg-secondary-50/60 rounded px-2 py-1.5">
                <span><span className="text-secondary-400">Spec:</span> {snap.thicknessMM}mm × {snap.lengthFT}×{snap.widthFT}ft</span>
                <span><span className="text-secondary-400">Base:</span> {formatINR(snap.basePrice ?? 0)}</span>
                <span>
                  <span className="text-secondary-400">Stock:</span>{' '}
                  <span className={
                    stockBadge(snap.currentStock, snap.minStockAlert).variant === 'success'
                      ? 'text-success-700 font-medium'
                      : 'text-warning-700 font-medium'
                  }>
                    {snap.currentStock ?? 0}
                  </span>
                </span>
              </div>
            )}

            {/* Numeric inputs row */}
            <div className="grid gap-2 grid-cols-12">
              <div className="col-span-6 sm:col-span-2">
                <Input
                  label="Qty"
                  type="number" min={1} step={1} size="sm"
                  error={itemErrors.quantity?.message}
                  {...register(`items.${idx}.quantity`)}
                />
              </div>
              <div className="col-span-6 sm:col-span-3">
                <Input
                  label="Rate (₹)"
                  type="number" min={0} step="0.01" size="sm"
                  error={itemErrors.pricePerUnit?.message}
                  {...register(`items.${idx}.pricePerUnit`)}
                />
              </div>
              <div className="col-span-6 sm:col-span-3">
                <Controller
                  name={`items.${idx}.discountMode`}
                  control={control}
                  render={({ field: f }) => (
                    <Select
                      label="Discount"
                      size="sm"
                      value={f.value || 'percent'}
                      onChange={(e) => f.onChange(e.target.value)}
                      options={[
                        { value: 'percent', label: '% off' },
                        { value: 'amount',  label: '₹ off' },
                      ]}
                    />
                  )}
                />
              </div>
              <div className="col-span-6 sm:col-span-2">
                <Input
                  label=" "
                  type="number" min={0} step="0.01" size="sm"
                  error={itemErrors.discountValue?.message}
                  {...register(`items.${idx}.discountValue`)}
                />
              </div>
              <div className="col-span-12 sm:col-span-2 flex flex-col items-end justify-end">
                <span className="text-[10px] uppercase tracking-wide text-secondary-500">
                  Line total
                </span>
                <span className="text-base font-semibold text-secondary-900 font-mono">
                  {formatINR(lineTotal)}
                </span>
              </div>
            </div>

            {stockShort && (
              <Alert variant="warning" className="!py-1.5">
                <div className="flex items-center gap-2 text-xs">
                  <AlertTriangle size={12} />
                  Quantity exceeds available stock ({snap.currentStock}).
                  You can override — backend will record the over-allocation.
                </div>
              </Alert>
            )}
          </div>
        );
      })}

      {errors.items?.message && (
        <Alert variant="error">{errors.items.message}</Alert>
      )}

      <Button
        variant="outline" size="sm"
        leftIcon={<Plus size={14} />}
        onClick={() => append({ ...EMPTY_ITEM })}
      >
        Add item
      </Button>
    </div>
  );
}

// Exported for OrderFormModal's default-values builder
export { EMPTY_ITEM };
