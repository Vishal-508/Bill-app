import { useEffect, useMemo, useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Modal } from '../../components/ui/Modal.jsx';
import { Input } from '../../components/ui/Input.jsx';
import { Select } from '../../components/ui/Select.jsx';
import { Textarea } from '../../components/ui/Textarea.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Alert } from '../../components/ui/Alert.jsx';
import { productSchema } from '../../utils/productValidators.js';
import {
  useCreateProduct, useUpdateProduct,
} from '../../hooks/queries/useProducts.js';
import { useProductGrades } from '../../hooks/queries/useProductGrades.js';

function buildDefaults(product) {
  if (!product) {
    return {
      name: '', description: '', brand: '', sku: '',
      thicknessMM: 18, lengthFT: 8, widthFT: 4,
      grade: '',
      pricingUnit: 'sqft', basePrice: 0,
      currentStock: 0, minStockAlert: 10, reorderQuantity: 50,
      hsnCode: '4411', gstRatePct: 18,
      notes: '',
    };
  }
  return {
    name: product.name ?? '',
    description: product.description ?? '',
    brand: product.brand ?? '',
    sku: product.sku ?? '',
    thicknessMM: product.thicknessMM ?? 18,
    lengthFT: product.lengthFT ?? 8,
    widthFT: product.widthFT ?? 4,
    grade: (typeof product.grade === 'object' ? product.grade?._id : product.grade) ?? '',
    pricingUnit: product.pricingUnit ?? 'sqft',
    basePrice: product.basePrice ?? 0,
    currentStock: product.currentStock ?? 0,
    minStockAlert: product.minStockAlert ?? 10,
    reorderQuantity: product.reorderQuantity ?? 50,
    hsnCode: product.hsnCode ?? '4411',
    gstRatePct: product.gstRatePct ?? 18,
    notes: product.notes ?? '',
  };
}

export default function ProductFormModal({ open, product, onClose }) {
  const isEdit = !!product?._id;
  const createMutation = useCreateProduct();
  const updateMutation = useUpdateProduct();
  const gradesQuery = useProductGrades();
  const grades = gradesQuery.data?.data || [];

  const [serverError, setServerError] = useState(null);

  const {
    register, control, handleSubmit, watch, reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm({
    resolver: zodResolver(productSchema),
    defaultValues: useMemo(() => buildDefaults(product), [product]),
    mode: 'onBlur',
  });

  useEffect(() => { reset(buildDefaults(product)); }, [product, reset]);

  // ─── Auto-calculations (read-only display) ───
  // Backend's pre-save hook computes areaSqFt = lengthFT × widthFT,
  // but echoing it back in the form helps users sanity-check pricing.
  const lengthFT = watch('lengthFT');
  const widthFT = watch('widthFT');
  const basePrice = watch('basePrice');
  const pricingUnit = watch('pricingUnit');

  const areaSqFt = Number(lengthFT) > 0 && Number(widthFT) > 0
    ? +(Number(lengthFT) * Number(widthFT)).toFixed(2)
    : null;
  const ratePerSqFt = areaSqFt && Number(basePrice) > 0 && pricingUnit === 'sheet'
    ? +(Number(basePrice) / areaSqFt).toFixed(2)
    : null;

  const onSubmit = async (values) => {
    setServerError(null);
    // Strip empty optionals so backend defaults apply
    const payload = { ...values };
    ['description', 'brand', 'sku', 'notes'].forEach((k) => {
      if (!payload[k]) delete payload[k];
    });

    try {
      if (isEdit) {
        await updateMutation.mutateAsync({ id: product._id, payload });
      } else {
        await createMutation.mutateAsync(payload);
      }
      onClose?.();
    } catch (err) {
      const msg = err?.response?.data?.message
        || err?.message
        || 'Save failed. Please review the fields above.';
      setServerError(msg);
    }
  };

  const handleClose = () => {
    if (isDirty && !window.confirm('Discard your changes?')) return;
    setServerError(null);
    onClose?.();
  };

  return (
    <Modal
      open={!!open}
      onClose={handleClose}
      title={isEdit ? `Edit ${product.sku}` : 'Add Product'}
      size="xl"
      footer={
        <>
          <Button variant="ghost" onClick={handleClose} disabled={isSubmitting}>Cancel</Button>
          <Button
            variant="primary"
            onClick={handleSubmit(onSubmit)}
            loading={isSubmitting}
            disabled={isSubmitting}
          >
            {isEdit ? 'Save Changes' : 'Create Product'}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
        {serverError && <Alert variant="error">{serverError}</Alert>}

        {/* ─── Basic Info ─── */}
        <section>
          <h3 className="text-sm font-semibold text-secondary-900 mb-3">Basic Info</h3>
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Input
                label="Product Name" required autoFocus
                error={errors.name?.message}
                disabled={isSubmitting}
                {...register('name')}
              />
            </div>
            <Input
              label="SKU"
              placeholder="Auto-generated if blank"
              helperText="Format: MDF-{THICKNESS}-{SIZE}-{GRADE}-{SEQ}"
              error={errors.sku?.message}
              disabled={isSubmitting || isEdit}  // SKU immutable after creation
              {...register('sku')}
            />
            <Input
              label="Brand"
              placeholder="Optional"
              error={errors.brand?.message}
              disabled={isSubmitting}
              {...register('brand')}
            />
            <div className="sm:col-span-2">
              <Textarea
                label="Description"
                rows={2}
                placeholder="Optional"
                error={errors.description?.message}
                disabled={isSubmitting}
                {...register('description')}
              />
            </div>
          </div>
        </section>

        {/* ─── Specifications ─── */}
        <section>
          <h3 className="text-sm font-semibold text-secondary-900 mb-3">Specifications</h3>
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
            <Input
              label="Thickness (mm)" type="number" step="0.5" required
              error={errors.thicknessMM?.message}
              disabled={isSubmitting}
              {...register('thicknessMM')}
            />
            <Input
              label="Length (ft)" type="number" step="0.5" required
              error={errors.lengthFT?.message}
              disabled={isSubmitting}
              {...register('lengthFT')}
            />
            <Input
              label="Width (ft)" type="number" step="0.5" required
              error={errors.widthFT?.message}
              disabled={isSubmitting}
              {...register('widthFT')}
            />

            <div className="sm:col-span-3">
              <Controller
                name="grade"
                control={control}
                render={({ field }) => (
                  <Select
                    label="Grade"
                    required
                    placeholder={gradesQuery.isLoading ? 'Loading grades…' : 'Select grade'}
                    options={grades.map(g => ({
                      value: g._id,
                      label: g.label || g.code || g.name,
                    }))}
                    error={errors.grade?.message}
                    disabled={isSubmitting || gradesQuery.isLoading}
                    value={field.value || ''}
                    onChange={(e) => field.onChange(e.target.value)}
                  />
                )}
              />
            </div>

            {/* Auto-calculated readouts */}
            {areaSqFt != null && (
              <div className="sm:col-span-3 text-xs text-secondary-500 flex flex-wrap gap-x-4 gap-y-1">
                <span>Area: <strong className="text-secondary-700">{areaSqFt} sq.ft</strong></span>
                {ratePerSqFt != null && (
                  <span>Per-sqft rate: <strong className="text-secondary-700">₹{ratePerSqFt}</strong></span>
                )}
              </div>
            )}
          </div>
        </section>

        {/* ─── Pricing & Tax ─── */}
        <section>
          <h3 className="text-sm font-semibold text-secondary-900 mb-3">Pricing & Tax</h3>
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
            <Controller
              name="pricingUnit"
              control={control}
              render={({ field }) => (
                <Select
                  label="Pricing Unit"
                  value={field.value || 'sqft'}
                  onChange={(e) => field.onChange(e.target.value)}
                  disabled={isSubmitting}
                  options={[
                    { value: 'sqft',   label: 'Per sq.ft' },
                    { value: 'sqinch', label: 'Per sq.inch' },
                    { value: 'sheet',  label: 'Per sheet' },
                  ]}
                />
              )}
            />
            <Input
              label="Base Price (₹)" type="number" step="0.01" min={0} required
              error={errors.basePrice?.message}
              disabled={isSubmitting}
              {...register('basePrice')}
            />
            <Input
              label="GST Rate (%)" type="number" step="0.5" min={0} max={100}
              error={errors.gstRatePct?.message}
              disabled={isSubmitting}
              {...register('gstRatePct')}
            />
            <Input
              label="HSN Code"
              error={errors.hsnCode?.message}
              disabled={isSubmitting}
              {...register('hsnCode')}
            />
          </div>
        </section>

        {/* ─── Stock ─── */}
        <section>
          <h3 className="text-sm font-semibold text-secondary-900 mb-3">Stock</h3>
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
            <Input
              label="Current Stock (sheets)" type="number" min={0} step="1"
              error={errors.currentStock?.message}
              disabled={isSubmitting}
              {...register('currentStock')}
            />
            <Input
              label="Min Stock Alert" type="number" min={0} step="1"
              helperText="Triggers low-stock warning"
              error={errors.minStockAlert?.message}
              disabled={isSubmitting}
              {...register('minStockAlert')}
            />
            <Input
              label="Reorder Quantity" type="number" min={0} step="1"
              helperText="Default PO size"
              error={errors.reorderQuantity?.message}
              disabled={isSubmitting}
              {...register('reorderQuantity')}
            />
          </div>
        </section>

        {/* ─── Notes ─── */}
        <section>
          <Textarea
            label="Notes"
            rows={2}
            placeholder="Optional admin notes"
            error={errors.notes?.message}
            disabled={isSubmitting}
            {...register('notes')}
          />
        </section>
      </form>
    </Modal>
  );
}
