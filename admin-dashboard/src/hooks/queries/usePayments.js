import {
  useQuery, useMutation, useQueryClient, keepPreviousData,
} from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { paymentApi } from '../../api/payment.api.js';
import { queryKeys } from '../../utils/queryKeys.js';

function extractMessage(err, fallback) {
  return err?.response?.data?.message || err?.message || fallback;
}

export function usePaymentsList(params) {
  return useQuery({
    queryKey: queryKeys.payments.list(params),
    queryFn: () => paymentApi.list(params),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

export function usePaymentDetail(id) {
  return useQuery({
    queryKey: queryKeys.payments.detail(id),
    queryFn: () => paymentApi.get(id),
    enabled: !!id,
    staleTime: 30_000,
  });
}

export function usePaymentsByOrder(orderId) {
  return useQuery({
    queryKey: queryKeys.payments.byOrder(orderId),
    queryFn: () => paymentApi.byOrder(orderId),
    enabled: !!orderId,
    staleTime: 30_000,
  });
}

export function usePaymentsByCustomer(customerId, params) {
  return useQuery({
    queryKey: [...queryKeys.payments.byCustomer(customerId), params || {}],
    queryFn: () => paymentApi.byCustomer(customerId, params),
    enabled: !!customerId,
    staleTime: 30_000,
  });
}

export function useRefundsList(params) {
  return useQuery({
    queryKey: [...queryKeys.payments.refunds, params || {}],
    queryFn: () => paymentApi.listRefunds(params),
    staleTime: 60_000,
  });
}

export function usePaymentConfig() {
  return useQuery({
    queryKey: queryKeys.payments.config,
    queryFn: () => paymentApi.config(),
    staleTime: 5 * 60_000,   // Razorpay key, rarely changes
  });
}

// ─── Mutations ───

/**
 * Razorpay-only: create a Razorpay order on the backend + return the
 * paymentReference + razorpayOrderId. Caller then opens Razorpay
 * checkout in a popup OR generates a shareable payment link.
 *
 * Body: { order, amount, notes?, bill? }
 */
export function useInitiatePayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload) => paymentApi.initiate(payload),
    onSuccess: (_res, vars) => {
      // Optimistically refresh order detail so the pending payment shows.
      if (vars?.order) {
        qc.invalidateQueries({ queryKey: queryKeys.orders.detail(vars.order) });
      }
      qc.invalidateQueries({ queryKey: queryKeys.payments.lists });
      toast.success('Razorpay payment initiated');
    },
    onError: (err) => toast.error(extractMessage(err, 'Initiate failed')),
  });
}

/**
 * Razorpay verify — called after the customer pays via the Razorpay
 * popup/link. Body: { paymentReference, razorpayOrderId,
 *                     razorpayPaymentId, razorpaySignature }
 *
 * The signature is HMAC-SHA256 of `<razorpayOrderId>|<razorpayPaymentId>`
 * using the Razorpay secret. Frontend receives these fields in the
 * Razorpay handler callback.
 */
export function useVerifyPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload) => paymentApi.verify(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.payments.all });
      qc.invalidateQueries({ queryKey: queryKeys.orders.all });
      qc.invalidateQueries({ queryKey: queryKeys.bills.all });
      toast.success('Payment verified');
    },
    onError: (err) => toast.error(extractMessage(err, 'Verification failed')),
  });
}

export function useCancelPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }) => paymentApi.cancel(id, { reason }),
    onSuccess: (_res, { id }) => {
      qc.invalidateQueries({ queryKey: queryKeys.payments.detail(id) });
      qc.invalidateQueries({ queryKey: queryKeys.payments.lists });
      toast.success('Payment cancelled');
    },
    onError: (err) => toast.error(extractMessage(err, 'Cancel failed')),
  });
}

/**
 * Initiate a refund. Body: { amount?, reason, notes?, refundType? }.
 * `amount` omitted → full refund. `refundType: 'partial'` requires
 * `amount`.
 */
export function useInitiateRefund() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, amount, reason, notes, refundType }) =>
      paymentApi.initiateRefund(id, { amount, reason, notes, refundType }),
    onSuccess: (_res, { id }) => {
      qc.invalidateQueries({ queryKey: queryKeys.payments.detail(id) });
      qc.invalidateQueries({ queryKey: queryKeys.payments.refunds });
      qc.invalidateQueries({ queryKey: queryKeys.payments.lists });
      toast.success('Refund initiated');
    },
    onError: (err) => toast.error(extractMessage(err, 'Refund failed')),
  });
}
