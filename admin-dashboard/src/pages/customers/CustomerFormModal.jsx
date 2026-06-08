import { useEffect, useMemo, useState } from 'react';
import { useForm, FormProvider, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Modal } from '../../components/ui/Modal.jsx';
import { Input } from '../../components/ui/Input.jsx';
import { Textarea } from '../../components/ui/Textarea.jsx';
import { Radio } from '../../components/ui/Radio.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Alert } from '../../components/ui/Alert.jsx';
import AddressFields from '../../components/forms/AddressFields.jsx';
import { customerSchema } from '../../utils/validators.js';
import { formatPhone } from '../../utils/format.js';
import { deriveStateFromGstin } from '../../utils/indianStates.js';
import {
  useCreateCustomer, useUpdateCustomer,
} from '../../hooks/queries/useCustomers.js';

/**
 * Full create/edit modal. The form's field shape matches the backend
 * `createCustomerSchema` exactly (nested `billingAddress`, no `name`
 * field), so the only payload transform we do on submit is dropping
 * the frontend-only `billType` flag.
 *
 * GSTIN behavior:
 *   - Hidden until billType=GST
 *   - On valid GSTIN entry, the leading 2 chars derive state+stateCode
 *     and the address's State + State Code fields lock to that value
 *     until GSTIN is cleared
 */
function buildDefaults(customer) {
  if (!customer) {
    return {
      customerName: '', companyName: '', phone: '', altPhone: '', email: '',
      billType: 'NON_GST', gstin: '',
      billingAddress: {
        line1: '', line2: '', city: '', state: '', stateCode: '', pincode: '',
      },
      creditLimit: 0, notes: '',
    };
  }
  return {
    customerName: customer.customerName ?? '',
    companyName: customer.companyName ?? '',
    phone: customer.phone ?? '',
    altPhone: customer.altPhone ?? '',
    email: customer.email ?? '',
    billType: customer.gstin ? 'GST' : 'NON_GST',
    gstin: customer.gstin ?? '',
    billingAddress: {
      line1:     customer.billingAddress?.line1     ?? '',
      line2:     customer.billingAddress?.line2     ?? '',
      city:      customer.billingAddress?.city      ?? '',
      state:     customer.billingAddress?.state     ?? '',
      stateCode: customer.billingAddress?.stateCode ?? '',
      pincode:   customer.billingAddress?.pincode   ?? '',
    },
    creditLimit: customer.creditLimit ?? 0,
    notes: customer.notes ?? '',
  };
}

export default function CustomerFormModal({ open, customer, onClose }) {
  const isEdit = !!customer?._id;
  const createMutation = useCreateCustomer();
  const updateMutation = useUpdateCustomer();

  const [serverError, setServerError] = useState(null);

  const methods = useForm({
    resolver: zodResolver(customerSchema),
    defaultValues: useMemo(() => buildDefaults(customer), [customer]),
    mode: 'onBlur',
  });
  const {
    register, control, handleSubmit, watch, setValue, reset,
    formState: { errors, isSubmitting, isDirty },
  } = methods;

  // Reset when the customer prop changes (open Edit on different rows)
  useEffect(() => { reset(buildDefaults(customer)); }, [customer, reset]);

  // ─── GSTIN → state auto-derive (and lock) ───
  const billType = watch('billType');
  const gstin = watch('gstin');
  const phone = watch('phone');

  useEffect(() => {
    if (billType !== 'GST' || !gstin) return;
    const upper = gstin.toUpperCase();
    if (upper !== gstin) setValue('gstin', upper, { shouldValidate: false });
    const match = deriveStateFromGstin(upper);
    if (match) {
      setValue('billingAddress.state', match.name, { shouldValidate: true });
      setValue('billingAddress.stateCode', match.code, { shouldValidate: true });
    }
  }, [gstin, billType, setValue]);

  const stateCodeLocked = billType === 'GST' && !!gstin && gstin.length >= 2;

  // ─── Submit ───
  const onSubmit = async (values) => {
    setServerError(null);
    // Drop billType — it's a frontend-only flag.
    const { billType: _bt, ...payload } = values;
    // Empty optional fields → omit so backend defaults apply
    if (!payload.gstin) delete payload.gstin;
    if (!payload.altPhone) delete payload.altPhone;
    if (!payload.email) delete payload.email;
    if (!payload.companyName) delete payload.companyName;
    if (!payload.notes) delete payload.notes;

    try {
      if (isEdit) {
        await updateMutation.mutateAsync({ id: customer._id, payload });
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

  const phonePreview = phone && /^[6-9]\d{9}$/.test(phone) ? formatPhone(phone) : null;

  const submitLabel = isEdit ? 'Save Changes' : 'Create Customer';

  return (
    <Modal
      open={!!open}
      onClose={handleClose}
      title={isEdit ? `Edit ${customer.customerName}` : 'Add Customer'}
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
            {submitLabel}
          </Button>
        </>
      }
    >
      <FormProvider {...methods}>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
          {serverError && <Alert variant="error">{serverError}</Alert>}

          {/* Section: Basic Info */}
          <section>
            <h3 className="text-sm font-semibold text-secondary-900 mb-3">Basic Info</h3>
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Input
                  label="Customer Name"
                  required
                  autoFocus
                  error={errors.customerName?.message}
                  disabled={isSubmitting}
                  {...register('customerName')}
                />
              </div>
              <Input
                label="Company Name"
                placeholder="Optional"
                error={errors.companyName?.message}
                disabled={isSubmitting}
                {...register('companyName')}
              />
              <Input
                label="Phone"
                required
                placeholder="9876543210"
                inputMode="numeric"
                maxLength={10}
                error={errors.phone?.message}
                helperText={phonePreview ? `Will save as: ${phonePreview}` : '10-digit Indian mobile'}
                disabled={isSubmitting}
                {...register('phone')}
              />
              <Input
                label="Alt Phone"
                placeholder="Optional"
                inputMode="numeric"
                maxLength={10}
                error={errors.altPhone?.message}
                disabled={isSubmitting}
                {...register('altPhone')}
              />
              <Input
                label="Email"
                type="email"
                placeholder="Optional"
                error={errors.email?.message}
                disabled={isSubmitting}
                {...register('email')}
              />
            </div>
          </section>

          {/* Section: Bill Type & Tax */}
          <section>
            <h3 className="text-sm font-semibold text-secondary-900 mb-3">Bill Type & Tax</h3>
            <Controller
              name="billType"
              control={control}
              render={({ field }) => (
                <div className="flex items-center gap-6">
                  <Radio
                    label="Non-GST"
                    description="Regular invoice, no tax breakdown"
                    name="billType"
                    value="NON_GST"
                    checked={field.value === 'NON_GST'}
                    onChange={() => {
                      field.onChange('NON_GST');
                      setValue('gstin', '', { shouldValidate: true });
                    }}
                    disabled={isSubmitting}
                  />
                  <Radio
                    label="GST"
                    description="GSTIN required, CGST/SGST/IGST applied"
                    name="billType"
                    value="GST"
                    checked={field.value === 'GST'}
                    onChange={() => field.onChange('GST')}
                    disabled={isSubmitting}
                  />
                </div>
              )}
            />

            {billType === 'GST' && (
              <div className="mt-3">
                <Input
                  label="GSTIN"
                  required
                  placeholder="22ABCDE0000A1Z5"
                  maxLength={15}
                  error={errors.gstin?.message}
                  helperText="15-character GST identification number"
                  disabled={isSubmitting}
                  {...register('gstin')}
                />
              </div>
            )}
          </section>

          {/* Section: Billing Address */}
          <section>
            <h3 className="text-sm font-semibold text-secondary-900 mb-3">Billing Address</h3>
            <AddressFields prefix="billingAddress" stateCodeLocked={stateCodeLocked} />
          </section>

          {/* Section: Business Terms */}
          <section>
            <h3 className="text-sm font-semibold text-secondary-900 mb-3">Business Terms</h3>
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
              <Input
                label="Credit Limit (₹)"
                type="number"
                min={0}
                step="100"
                error={errors.creditLimit?.message}
                disabled={isSubmitting}
                {...register('creditLimit')}
              />
              <div className="sm:col-span-2">
                <Textarea
                  label="Notes"
                  rows={3}
                  placeholder="Optional admin notes (max 500 chars)"
                  error={errors.notes?.message}
                  disabled={isSubmitting}
                  {...register('notes')}
                />
              </div>
            </div>
          </section>
        </form>
      </FormProvider>
    </Modal>
  );
}
