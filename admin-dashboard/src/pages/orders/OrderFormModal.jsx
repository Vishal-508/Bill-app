import { useEffect, useMemo, useState } from 'react';
import { useForm, FormProvider, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Modal } from '../../components/ui/Modal.jsx';
import { Input } from '../../components/ui/Input.jsx';
import { Select } from '../../components/ui/Select.jsx';
import { Textarea } from '../../components/ui/Textarea.jsx';
import { Checkbox } from '../../components/ui/Checkbox.jsx';
import { Button } from '../../components/ui/Button.jsx';
import { Alert } from '../../components/ui/Alert.jsx';
import { Badge } from '../../components/ui/Badge.jsx';
import { Card } from '../../components/ui/Card.jsx';
import CustomerPicker from '../../components/forms/CustomerPicker.jsx';
import OrderItemsBuilder, { EMPTY_ITEM } from './OrderItemsBuilder.jsx';
import { orderSchema } from '../../utils/validators.js';
import { calculateOrderTotals, BUSINESS_STATE_CODE } from '../../utils/gstCalculator.js';
import { formatINR } from '../../utils/format.js';
import {
  useCreateOrder, useUpdateOrder,
} from '../../hooks/queries/useOrders.js';

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function buildDefaults(order) {
  if (!order) {
    return {
      customer: '',
      customerStateCode: '',
      orderDate: todayIso(),
      expectedDeliveryDate: '',
      items: [{ ...EMPTY_ITEM }],
      gstRatePct: 18,
      orderDiscountMode: 'amount',
      orderDiscountValue: 0,
      discountReason: '',
      roundOff: false,
      hasGstBill: true,
      deliveryMethod: 'PICKUP',
      paymentMode: 'FULL_UPFRONT',
      customerNotes: '',
      internalNotes: '',
    };
  }
  // Edit mode — backend stores discount as { discountPct, discountAmount }
  // separately per item; we collapse back into the form's UI shape.
  return {
    customer: typeof order.customer === 'object' ? order.customer._id : order.customer,
    customerStateCode: order.customer?.billingAddress?.stateCode ?? '',
    orderDate: order.orderDate ? order.orderDate.slice(0, 10) : todayIso(),
    expectedDeliveryDate: order.expectedDeliveryDate
      ? order.expectedDeliveryDate.slice(0, 10)
      : '',
    items: (order.items || []).map(it => ({
      product: typeof it.product === 'object' ? it.product._id : it.product,
      productSnapshot: typeof it.product === 'object' ? {
        _id: it.product._id, sku: it.product.sku, name: it.product.name,
        thicknessMM: it.product.thicknessMM, lengthFT: it.product.lengthFT,
        widthFT: it.product.widthFT, basePrice: it.product.basePrice,
        currentStock: 0, minStockAlert: 0,
      } : null,
      quantity: it.quantity ?? 1,
      pricePerUnit: it.pricePerUnit ?? 0,
      discountMode: (it.discountPct || 0) > 0 ? 'percent' : 'amount',
      discountValue: (it.discountPct || 0) > 0
        ? it.discountPct
        : (it.discountAmount || 0),
    })),
    gstRatePct: order.gstRatePct ?? 18,
    orderDiscountMode: 'amount',
    orderDiscountValue: order.discountAmount ?? 0,
    discountReason: '',
    roundOff: false,
    hasGstBill: order.hasGstBill ?? true,
    deliveryMethod: order.deliveryMethod ?? 'PICKUP',
    paymentMode: order.paymentMode ?? 'FULL_UPFRONT',
    customerNotes: order.customerNotes ?? '',
    internalNotes: order.internalNotes ?? '',
  };
}

export default function OrderFormModal({ open, order, onClose }) {
  const isEdit = !!order?._id;
  const createMutation = useCreateOrder();
  const updateMutation = useUpdateOrder();

  const [serverError, setServerError] = useState(null);
  // Hold the picked customer object locally so we can show the
  // "selected customer" card. Form state only carries the id.
  const [pickedCustomer, setPickedCustomer] = useState(
    typeof order?.customer === 'object' ? order.customer : null
  );

  const methods = useForm({
    resolver: zodResolver(orderSchema),
    defaultValues: useMemo(() => buildDefaults(order), [order]),
    mode: 'onBlur',
  });
  const {
    register, control, handleSubmit, watch, setValue, reset,
    formState: { errors, isSubmitting, isDirty },
  } = methods;

  useEffect(() => { reset(buildDefaults(order)); }, [order, reset]);

  // Watch all the inputs that feed the totals calculator. Tanstack
  // could memo this further; for now react-hook-form's watch +
  // useMemo on the result is fast enough at < 50 items.
  const watched = watch();
  const totals = useMemo(() => calculateOrderTotals({
    items: watched.items || [],
    orderDiscount: +watched.orderDiscountValue || 0,
    orderDiscountMode: watched.orderDiscountMode,
    gstRatePct: +watched.gstRatePct || 18,
    customerStateCode: watched.customerStateCode,
    roundOff: !!watched.roundOff,
  }), [
    watched.items, watched.orderDiscountValue, watched.orderDiscountMode,
    watched.gstRatePct, watched.customerStateCode, watched.roundOff,
  ]);

  // ─── Customer selection wiring ───
  const handlePickCustomer = (customer) => {
    setPickedCustomer(customer);
    if (customer) {
      setValue('customer', customer._id, { shouldValidate: true });
      setValue('customerStateCode',
        customer.billingAddress?.stateCode || '', { shouldValidate: false });
      setValue('hasGstBill', !!customer.gstin);
    } else {
      setValue('customer', '');
      setValue('customerStateCode', '');
    }
  };

  // ─── Submit ───
  // Transform form-shape → backend create-order payload.
  // CRITICAL: backend requires CLIENT-COMPUTED totals (see
  // backend_order_totals_client_side memory note). Wrong math here
  // is silently accepted.
  const onSubmit = async (values) => {
    setServerError(null);

    const items = (values.items || []).map(i => {
      const qty = +i.quantity || 0;
      const price = +i.pricePerUnit || 0;
      const dv = +i.discountValue || 0;
      const gross = qty * price;
      const discountPct = i.discountMode === 'percent' ? dv : 0;
      const discountAmount = i.discountMode === 'amount' ? dv : 0;
      const effectiveDiscount = i.discountMode === 'percent'
        ? (gross * dv) / 100 : dv;
      const lineSubtotal = Math.max(0, gross - effectiveDiscount);

      return {
        itemType: 'FULL_SHEET',  // simplification — bundle/custom-cut deferred
        product: i.product,
        quantity: qty,
        pricePerUnit: price,
        discountPct, discountAmount, lineSubtotal,
        materialCost: lineSubtotal,
        cuttingCharges: 0,
        wastageAreaSqFt: 0,
        wastageCost: 0,
      };
    });

    const payload = {
      customer: values.customer,
      orderDate: new Date(values.orderDate).toISOString(),
      items,

      // Pre-computed totals (see memory note)
      subtotal: totals.subtotal,
      additionalCharges: 0,
      discountAmount: totals.orderDiscountAmt,
      taxableAmount: totals.taxableAmount,
      isIntraState: totals.isIntraState,
      gstRatePct: totals.gstRatePct,
      cgst: totals.cgst, sgst: totals.sgst, igst: totals.igst,
      totalGst: totals.totalGst,
      totalAmount: totals.grandTotal,

      hasGstBill: values.hasGstBill,
      billFormat: 'detailed',
      paymentMode: values.paymentMode,
      amountPaid: 0,
      deliveryMethod: values.deliveryMethod,
    };
    if (values.expectedDeliveryDate) {
      payload.expectedDeliveryDate = new Date(values.expectedDeliveryDate).toISOString();
    }
    if (values.customerNotes) payload.customerNotes = values.customerNotes;
    if (values.internalNotes) payload.internalNotes = values.internalNotes;

    try {
      if (isEdit) {
        await updateMutation.mutateAsync({ id: order._id, payload });
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
      title={isEdit ? `Edit ${order.orderNumber}` : 'New Order'}
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
            {isEdit ? 'Save Changes' : 'Create Order'}
          </Button>
        </>
      }
    >
      <FormProvider {...methods}>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6" noValidate>
          {serverError && <Alert variant="error">{serverError}</Alert>}

          {/* ─── Customer ─── */}
          <section>
            <h3 className="text-sm font-semibold text-secondary-900 mb-3">Customer</h3>
            <CustomerPicker
              label="Search by name, phone, or GSTIN"
              value={pickedCustomer?._id || ''}
              onChange={handlePickCustomer}
              error={errors.customer?.message}
              disabled={isSubmitting || isEdit}
            />
            {pickedCustomer && (
              <Card className="mt-2">
                <Card.Body className="text-sm space-y-0.5">
                  <div className="font-medium">{pickedCustomer.customerName}</div>
                  {pickedCustomer.companyName && (
                    <div className="text-xs text-secondary-500">{pickedCustomer.companyName}</div>
                  )}
                  <div className="text-xs text-secondary-500">
                    {pickedCustomer.billingAddress?.city}
                    {pickedCustomer.billingAddress?.state ? `, ${pickedCustomer.billingAddress.state}` : ''}
                    {pickedCustomer.billingAddress?.stateCode === BUSINESS_STATE_CODE
                      ? <Badge variant="info" size="sm" className="ml-2">Intra-state (CGST+SGST)</Badge>
                      : <Badge variant="warning" size="sm" className="ml-2">Inter-state (IGST)</Badge>}
                  </div>
                  {pickedCustomer.gstin && (
                    <div className="text-xs font-mono text-secondary-600">
                      GSTIN: {pickedCustomer.gstin}
                    </div>
                  )}
                </Card.Body>
              </Card>
            )}
          </section>

          {/* ─── Order details ─── */}
          <section>
            <h3 className="text-sm font-semibold text-secondary-900 mb-3">Details</h3>
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-3">
              <Input
                label="Order Date" type="date" required
                error={errors.orderDate?.message}
                disabled={isSubmitting}
                {...register('orderDate')}
              />
              <Input
                label="Expected Delivery" type="date"
                error={errors.expectedDeliveryDate?.message}
                disabled={isSubmitting}
                {...register('expectedDeliveryDate')}
              />
              <Controller
                name="deliveryMethod"
                control={control}
                render={({ field: f }) => (
                  <Select
                    label="Delivery Method"
                    value={f.value || 'PICKUP'}
                    onChange={(e) => f.onChange(e.target.value)}
                    disabled={isSubmitting}
                    options={[
                      { value: 'PICKUP',   label: 'Customer pickup' },
                      { value: 'DELIVERY', label: 'Delivery' },
                    ]}
                  />
                )}
              />
            </div>
          </section>

          {/* ─── Items ─── */}
          <section>
            <h3 className="text-sm font-semibold text-secondary-900 mb-3">Items</h3>
            <OrderItemsBuilder />
          </section>

          {/* ─── Order-level discount + tax + payment terms ─── */}
          <section>
            <h3 className="text-sm font-semibold text-secondary-900 mb-3">Discount & GST</h3>
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-4">
              <Controller
                name="orderDiscountMode"
                control={control}
                render={({ field: f }) => (
                  <Select
                    label="Order discount"
                    size="sm"
                    value={f.value || 'amount'}
                    onChange={(e) => f.onChange(e.target.value)}
                    disabled={isSubmitting}
                    options={[
                      { value: 'amount',  label: '₹ off' },
                      { value: 'percent', label: '% off' },
                    ]}
                  />
                )}
              />
              <Input
                label="Discount value"
                type="number" min={0} step="0.01" size="sm"
                error={errors.orderDiscountValue?.message}
                disabled={isSubmitting}
                {...register('orderDiscountValue')}
              />
              <Input
                label="GST rate (%)"
                type="number" min={0} max={100} step="0.5" size="sm"
                error={errors.gstRatePct?.message}
                disabled={isSubmitting}
                {...register('gstRatePct')}
              />
              <Controller
                name="paymentMode"
                control={control}
                render={({ field: f }) => (
                  <Select
                    label="Payment mode"
                    size="sm"
                    value={f.value || 'FULL_UPFRONT'}
                    onChange={(e) => f.onChange(e.target.value)}
                    disabled={isSubmitting}
                    options={[
                      { value: 'FULL_UPFRONT', label: 'Full upfront' },
                      { value: 'PARTIAL',      label: 'Partial' },
                      { value: 'CREDIT',       label: 'Credit' },
                    ]}
                  />
                )}
              />
            </div>
            {(+watched.orderDiscountValue || 0) > 0 && (
              <div className="mt-2">
                <Input
                  label="Discount reason (required)"
                  required size="sm"
                  error={errors.discountReason?.message}
                  disabled={isSubmitting}
                  {...register('discountReason')}
                />
              </div>
            )}
          </section>

          {/* ─── Notes ─── */}
          <section>
            <h3 className="text-sm font-semibold text-secondary-900 mb-3">Notes</h3>
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2">
              <Textarea
                label="Customer-facing"
                rows={2}
                placeholder="Visible on the bill"
                error={errors.customerNotes?.message}
                disabled={isSubmitting}
                {...register('customerNotes')}
              />
              <Textarea
                label="Internal"
                rows={2}
                placeholder="Admin-only notes"
                error={errors.internalNotes?.message}
                disabled={isSubmitting}
                {...register('internalNotes')}
              />
            </div>
          </section>

          {/* ─── Summary (sticky bottom) ─── */}
          <div className="sticky bottom-0 -mx-6 px-6 py-3 bg-secondary-50
                          border-t border-secondary-200">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="grid gap-x-6 gap-y-0.5 grid-cols-2 text-xs text-secondary-600">
                <span>Subtotal:</span>            <span className="text-right font-mono">{formatINR(totals.subtotal)}</span>
                {totals.itemDiscountTotal > 0 && (<>
                  <span>Item discounts:</span>    <span className="text-right font-mono">−{formatINR(totals.itemDiscountTotal)}</span>
                </>)}
                {totals.orderDiscountAmt > 0 && (<>
                  <span>Order discount:</span>    <span className="text-right font-mono">−{formatINR(totals.orderDiscountAmt)}</span>
                </>)}
                <span>Taxable:</span>             <span className="text-right font-mono">{formatINR(totals.taxableAmount)}</span>
                {totals.isIntraState ? (
                  <>
                    <span>CGST + SGST:</span>     <span className="text-right font-mono">{formatINR(totals.totalGst)}</span>
                  </>
                ) : (
                  <>
                    <span>IGST:</span>            <span className="text-right font-mono">{formatINR(totals.igst)}</span>
                  </>
                )}
                {totals.roundOffAdjustment !== 0 && (<>
                  <span>Round off:</span>         <span className="text-right font-mono">
                    {totals.roundOffAdjustment > 0 ? '+' : ''}{formatINR(totals.roundOffAdjustment)}
                  </span>
                </>)}
              </div>
              <div className="flex items-center gap-4">
                <Controller
                  name="roundOff"
                  control={control}
                  render={({ field: f }) => (
                    <Checkbox
                      label="Round off"
                      checked={!!f.value}
                      onChange={(e) => f.onChange(e.target.checked)}
                    />
                  )}
                />
                <div className="text-right">
                  <div className="text-[10px] uppercase tracking-wide text-secondary-500">
                    Grand Total
                  </div>
                  <div className="text-2xl font-bold text-secondary-900 font-mono">
                    {formatINR(totals.grandTotal)}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </form>
      </FormProvider>
    </Modal>
  );
}
