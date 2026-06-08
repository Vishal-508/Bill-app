import {
  useQuery, useMutation, useQueryClient, keepPreviousData,
} from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { productApi } from '../../api/product.api.js';
import { queryKeys } from '../../utils/queryKeys.js';

export function useProductsList(params) {
  return useQuery({
    queryKey: queryKeys.products.list(params),
    queryFn: () => productApi.list(params),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}

export function useProductDetail(id) {
  return useQuery({
    queryKey: queryKeys.products.detail(id),
    queryFn: () => productApi.get(id),
    enabled: !!id,
    staleTime: 60_000,
  });
}

export function useLowStockProducts() {
  return useQuery({
    queryKey: queryKeys.products.lowStock,
    queryFn: () => productApi.lowStock(),
    staleTime: 60_000,
  });
}

function extractMessage(err, fallback) {
  return err?.response?.data?.message
    || err?.message
    || fallback;
}

export function useCreateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload) => productApi.create(payload),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: queryKeys.products.lists });
      toast.success(`Product "${res?.data?.sku || 'New product'}" created`);
    },
    onError: (err) => toast.error(extractMessage(err, 'Failed to create product')),
  });
}

export function useUpdateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }) => productApi.update(id, payload),
    onMutate: async ({ id, payload }) => {
      await qc.cancelQueries({ queryKey: queryKeys.products.detail(id) });
      const previous = qc.getQueryData(queryKeys.products.detail(id));
      qc.setQueryData(queryKeys.products.detail(id), (old) => {
        if (!old) return old;
        return { ...old, data: { ...(old.data || {}), ...payload } };
      });
      return { previous };
    },
    onError: (err, { id }, ctx) => {
      if (ctx?.previous) qc.setQueryData(queryKeys.products.detail(id), ctx.previous);
      toast.error(extractMessage(err, 'Failed to update product'));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.products.lists });
      toast.success('Product updated');
    },
    onSettled: ({ data } = {}) => {
      if (data?._id) qc.invalidateQueries({ queryKey: queryKeys.products.detail(data._id) });
    },
  });
}

export function useDeleteProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }) => productApi.softDelete(id, body),
    onSuccess: (_res, { id }) => {
      qc.invalidateQueries({ queryKey: queryKeys.products.lists });
      qc.removeQueries({ queryKey: queryKeys.products.detail(id) });
      toast.success('Product deactivated');
    },
    onError: (err) => toast.error(extractMessage(err, 'Failed to deactivate product')),
  });
}

/**
 * Single-product price update. Used directly for one-off edits AND
 * fanned out sequentially for the "Bulk Price Update" UI (the backend
 * has no bulk-price endpoint).
 */
export function useUpdateProductPrice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }) => productApi.updatePrice(id, payload),
    onSuccess: (_res, { id }) => {
      qc.invalidateQueries({ queryKey: queryKeys.products.detail(id) });
      qc.invalidateQueries({ queryKey: queryKeys.products.lists });
    },
    onError: (err) => toast.error(extractMessage(err, 'Price update failed')),
  });
}

export function useAdjustStock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }) => productApi.adjustStock(id, payload),
    onSuccess: (_res, { id }) => {
      qc.invalidateQueries({ queryKey: queryKeys.products.detail(id) });
      qc.invalidateQueries({ queryKey: queryKeys.products.lists });
      qc.invalidateQueries({ queryKey: queryKeys.products.lowStock });
      toast.success('Stock adjusted');
    },
    onError: (err) => toast.error(extractMessage(err, 'Stock adjustment failed')),
  });
}
