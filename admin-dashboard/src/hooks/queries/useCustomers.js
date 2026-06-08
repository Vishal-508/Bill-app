import {
  useQuery, useMutation, useQueryClient, keepPreviousData,
} from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { customerApi } from '../../api/customer.api.js';
import { queryKeys } from '../../utils/queryKeys.js';

/**
 * Hook to fetch a paginated, filterable customer list. `params` is the
 * shape the backend's customer.controller.list accepts — page, limit,
 * search, billType, state, isActive, etc.
 *
 * keepPreviousData → smoother pagination: the table keeps showing
 * the old page while the next one loads instead of flashing empty.
 */
export function useCustomersList(params) {
  return useQuery({
    queryKey: queryKeys.customers.list(params),
    queryFn: () => customerApi.list(params),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

export function useCustomerDetail(id) {
  return useQuery({
    queryKey: queryKeys.customers.detail(id),
    queryFn: () => customerApi.get(id),
    enabled: !!id,
    staleTime: 60_000,
  });
}

export function useCustomerInsights(id) {
  return useQuery({
    queryKey: queryKeys.customers.insights(id),
    queryFn: () => customerApi.insights(id),
    enabled: !!id,
    staleTime: 60_000,
  });
}

// ─── Mutations ───

function extractMessage(err, fallback) {
  return err?.response?.data?.message
    || err?.message
    || fallback;
}

export function useCreateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload) => customerApi.create(payload),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: queryKeys.customers.lists });
      toast.success(`Customer "${res?.data?.customerName || 'New customer'}" created`);
    },
    onError: (err) => {
      toast.error(extractMessage(err, 'Failed to create customer'));
    },
  });
}

/**
 * Update — uses optimistic update on the detail query so the form
 * snaps to the new value immediately, with rollback on error.
 */
export function useUpdateCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }) => customerApi.update(id, payload),
    onMutate: async ({ id, payload }) => {
      await qc.cancelQueries({ queryKey: queryKeys.customers.detail(id) });
      const previous = qc.getQueryData(queryKeys.customers.detail(id));
      qc.setQueryData(queryKeys.customers.detail(id), (old) => {
        if (!old) return old;
        // Detail responses are { status, data: {...} }
        return { ...old, data: { ...(old.data || {}), ...payload } };
      });
      return { previous };
    },
    onError: (err, { id }, ctx) => {
      if (ctx?.previous) qc.setQueryData(queryKeys.customers.detail(id), ctx.previous);
      toast.error(extractMessage(err, 'Failed to update customer'));
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: queryKeys.customers.lists });
      toast.success(`Customer "${res?.data?.customerName || 'Customer'}" updated`);
    },
    onSettled: ({ data } = {}) => {
      // Always re-fetch detail for source-of-truth alignment
      if (data?._id) {
        qc.invalidateQueries({ queryKey: queryKeys.customers.detail(data._id) });
      }
    },
  });
}

export function useDeleteCustomer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }) => customerApi.softDelete(id, body),
    onSuccess: (_res, { id }) => {
      qc.invalidateQueries({ queryKey: queryKeys.customers.lists });
      qc.removeQueries({ queryKey: queryKeys.customers.detail(id) });
      toast.success('Customer deactivated');
    },
    onError: (err) => {
      toast.error(extractMessage(err, 'Failed to deactivate customer'));
    },
  });
}

/**
 * Bulk update — backend's bulkUpdateSchema expects:
 *   { customerIds: [...], updates: {...} }
 * NOT `{ ids, update }`. See admin_dashboard_customer_field_shape
 * memory note.
 */
export function useBulkUpdateCustomers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ customerIds, updates }) =>
      customerApi.bulkUpdate({ customerIds, updates }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: queryKeys.customers.all });
      const n = res?.data?.modifiedCount ?? res?.data?.matchedCount ?? 0;
      toast.success(`Updated ${n} customer${n === 1 ? '' : 's'}`);
    },
    onError: (err) => {
      toast.error(extractMessage(err, 'Bulk update failed'));
    },
  });
}

/**
 * Bulk soft-delete — backend expects:
 *   { customerIds: [...], reason: "..." }
 */
export function useBulkDeleteCustomers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ customerIds, reason }) =>
      customerApi.bulkSoftDelete({ customerIds, reason }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: queryKeys.customers.all });
      const n = res?.data?.deletedCount ?? res?.data?.modifiedCount ?? 0;
      toast.success(`Deactivated ${n} customer${n === 1 ? '' : 's'}`);
    },
    onError: (err) => {
      toast.error(extractMessage(err, 'Bulk delete failed'));
    },
  });
}
