import {
  useQuery, useMutation, useQueryClient, keepPreviousData,
} from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { billApi } from '../../api/bill.api.js';
import { queryKeys } from '../../utils/queryKeys.js';

function extractMessage(err, fallback) {
  return err?.response?.data?.message || err?.message || fallback;
}

export function useBillsList(params) {
  return useQuery({
    queryKey: queryKeys.bills.list(params),
    queryFn: () => billApi.list(params),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

export function useBillDetail(id) {
  return useQuery({
    queryKey: queryKeys.bills.detail(id),
    queryFn: () => billApi.get(id),
    enabled: !!id,
    staleTime: 30_000,
  });
}

export function useBillsByOrder(orderId) {
  return useQuery({
    queryKey: queryKeys.bills.byOrder(orderId),
    queryFn: () => billApi.byOrder(orderId),
    enabled: !!orderId,
    staleTime: 30_000,
  });
}

export function useBillsByCustomer(customerId, params) {
  return useQuery({
    queryKey: [...queryKeys.bills.byCustomer(customerId), params || {}],
    queryFn: () => billApi.byCustomer(customerId, params),
    enabled: !!customerId,
    staleTime: 30_000,
  });
}

// ─── Mutations ───

/**
 * Generate a Bill from an existing Order. Backend's only bill-creation
 * path: `POST /api/bills/from-order/:orderId`.
 *
 * Optional body: { format, language, hasGst, dueDate, notesToCustomer,
 *                  internalNotes, termsAndConditions, deliveryMethod,
 *                  transportDetails, vehicleNumber }
 */
export function useCreateBillFromOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orderId, payload = {} }) => billApi.createFromOrder(orderId, payload),
    onSuccess: (res, { orderId }) => {
      qc.invalidateQueries({ queryKey: queryKeys.bills.lists });
      qc.invalidateQueries({ queryKey: queryKeys.bills.byOrder(orderId) });
      qc.invalidateQueries({ queryKey: queryKeys.orders.detail(orderId) });
      toast.success(`Bill ${res?.data?.invoiceNo || ''} generated`);
    },
    onError: (err) => toast.error(extractMessage(err, 'Bill generation failed')),
  });
}

export function useUpdateBill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }) => billApi.update(id, payload),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: queryKeys.bills.lists });
      const billId = res?.data?._id;
      if (billId) qc.invalidateQueries({ queryKey: queryKeys.bills.detail(billId) });
      toast.success('Bill updated');
    },
    onError: (err) => toast.error(extractMessage(err, 'Bill update failed')),
  });
}

/**
 * Move bill from DRAFT to FINAL state. After finalize, most edits
 * are locked (signatures, cancel, mark-sent still allowed).
 */
export function useFinalizeBill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, notes }) => billApi.finalize(id, notes ? { notes } : {}),
    onSuccess: (_res, { id }) => {
      qc.invalidateQueries({ queryKey: queryKeys.bills.detail(id) });
      qc.invalidateQueries({ queryKey: queryKeys.bills.lists });
      toast.success('Bill finalized');
    },
    onError: (err) => toast.error(extractMessage(err, 'Finalize failed')),
  });
}

/**
 * Record an external send event. Body: { channel, notes?, recipientInfo? }.
 * The backend stores this for audit; admin manually triggers the actual
 * send (WhatsApp/Email/Print) outside the app OR via the Prompt 7
 * notification orchestrator.
 */
export function useMarkBillSent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, channel, notes, recipientInfo }) =>
      billApi.markSent(id, { channel, notes, recipientInfo }),
    onSuccess: (_res, { id, channel }) => {
      qc.invalidateQueries({ queryKey: queryKeys.bills.detail(id) });
      qc.invalidateQueries({ queryKey: queryKeys.bills.lists });
      toast.success(`Marked as sent via ${channel}`);
    },
    onError: (err) => toast.error(extractMessage(err, 'Mark-sent failed')),
  });
}

export function useCancelBill() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }) => billApi.cancel(id, { reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.bills.all });
      toast.success('Bill cancelled');
    },
    onError: (err) => toast.error(extractMessage(err, 'Cancel failed')),
  });
}

export function useRegenerateBillPdf() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => billApi.regeneratePdf(id),
    onSuccess: (_res, id) => {
      qc.invalidateQueries({ queryKey: queryKeys.bills.detail(id) });
      toast.success('PDF regenerated');
    },
    onError: (err) => toast.error(extractMessage(err, 'PDF regeneration failed')),
  });
}
