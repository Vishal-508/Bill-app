import {
  useQuery, useMutation, useQueryClient, keepPreviousData,
} from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { orderApi } from '../../api/order.api.js';
import { queryKeys } from '../../utils/queryKeys.js';

function extractMessage(err, fallback) {
  return err?.response?.data?.message || err?.message || fallback;
}

export function useOrdersList(params) {
  return useQuery({
    queryKey: queryKeys.orders.list(params),
    queryFn: () => orderApi.list(params),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

export function useOrderDetail(id) {
  return useQuery({
    queryKey: queryKeys.orders.detail(id),
    queryFn: () => orderApi.get(id),
    enabled: !!id,
    staleTime: 30_000,
  });
}

export function useOrderPayments(id) {
  return useQuery({
    queryKey: queryKeys.orders.payments(id),
    queryFn: () => orderApi.getPayments(id),
    enabled: !!id,
    staleTime: 30_000,
  });
}

export function useCustomerDues(customerId) {
  return useQuery({
    queryKey: queryKeys.orders.customerDues(customerId),
    queryFn: () => orderApi.customerDues(customerId),
    enabled: !!customerId,
    staleTime: 30_000,
  });
}

export function useOutstandingPayments(params) {
  return useQuery({
    queryKey: [...queryKeys.orders.outstanding, params || {}],
    queryFn: () => orderApi.outstandingPayments(params),
    staleTime: 60_000,
  });
}

// ─── Mutations ───

export function useCreateOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload) => orderApi.create(payload),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: queryKeys.orders.lists });
      toast.success(`Order ${res?.data?.orderNumber || ''} created`);
    },
    onError: (err) => toast.error(extractMessage(err, 'Failed to create order')),
  });
}

/**
 * Update an order. Uses optimistic update on the detail query so the
 * UI reflects the new shape immediately, with rollback on error.
 */
export function useUpdateOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }) => orderApi.update(id, payload),
    onMutate: async ({ id, payload }) => {
      await qc.cancelQueries({ queryKey: queryKeys.orders.detail(id) });
      const previous = qc.getQueryData(queryKeys.orders.detail(id));
      qc.setQueryData(queryKeys.orders.detail(id), (old) => {
        if (!old) return old;
        return { ...old, data: { ...(old.data || {}), ...payload } };
      });
      return { previous };
    },
    onError: (err, { id }, ctx) => {
      if (ctx?.previous) qc.setQueryData(queryKeys.orders.detail(id), ctx.previous);
      toast.error(extractMessage(err, 'Failed to update order'));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.orders.lists });
      toast.success('Order updated');
    },
    onSettled: (res) => {
      const updatedId = res?.data?._id;
      if (updatedId) qc.invalidateQueries({ queryKey: queryKeys.orders.detail(updatedId) });
    },
  });
}

/**
 * Change order status. POST /api/orders/:id/status with { status, notes? }.
 * Backend's statusChangeSchema enforces the valid status enum.
 */
export function useChangeOrderStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, notes }) => orderApi.changeStatus(id, { status, notes }),
    onSuccess: (res, { status }) => {
      qc.invalidateQueries({ queryKey: queryKeys.orders.all });
      toast.success(`Status changed to ${status}`);
    },
    onError: (err) => toast.error(extractMessage(err, 'Status change failed')),
  });
}

/**
 * Cancel order. POST /api/orders/:id/cancel with { reason: 3+ chars }.
 */
export function useCancelOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }) => orderApi.cancel(id, { reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.orders.all });
      toast.success('Order cancelled');
    },
    onError: (err) => toast.error(extractMessage(err, 'Cancel failed')),
  });
}

/**
 * Record a manual payment against an order (CASH/UPI/BANK_TRANSFER/
 * CHEQUE/CARD/CREDIT). Razorpay online payments go through a separate
 * /payments/initiate + /verify flow — see usePayments.js.
 *
 * Backend body shape: { amount, mode, reference?, paidAt?, notes? }
 */
export function useAddOrderPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, ...payload }) => orderApi.addPayment(orderId, payload),
    onSuccess: (_res, { orderId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.orders.detail(orderId) });
      qc.invalidateQueries({ queryKey: queryKeys.orders.payments(orderId) });
      qc.invalidateQueries({ queryKey: queryKeys.orders.lists });
      qc.invalidateQueries({ queryKey: queryKeys.bills.all });
      qc.invalidateQueries({ queryKey: queryKeys.payments.lists });
      toast.success('Payment recorded');
    },
    onError: (err) => toast.error(extractMessage(err, 'Payment failed')),
  });
}

export function useRefundOrderPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, paymentId, reason, refundMode }) =>
      orderApi.refund(orderId, { paymentId, reason, refundMode }),
    onSuccess: (_res, { orderId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.orders.detail(orderId) });
      qc.invalidateQueries({ queryKey: queryKeys.orders.payments(orderId) });
      qc.invalidateQueries({ queryKey: queryKeys.payments.lists });
      toast.success('Refund recorded');
    },
    onError: (err) => toast.error(extractMessage(err, 'Refund failed')),
  });
}

export function useDeleteOrder() {
  const qc = useQueryClient();
  return useMutation({
    // softDeleteOrderSchema accepts an OPTIONAL reason — caller can omit
    mutationFn: ({ id, body = {} }) => orderApi.softDelete(id, body),
    onSuccess: (_res, { id }) => {
      qc.invalidateQueries({ queryKey: queryKeys.orders.lists });
      qc.removeQueries({ queryKey: queryKeys.orders.detail(id) });
      toast.success('Order deleted');
    },
    onError: (err) => toast.error(extractMessage(err, 'Delete failed')),
  });
}
