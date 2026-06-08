import { api } from './axios.js';

export const productApi = {
  list: (params) =>
    api.get('/products', { params }).then(r => r.data),

  get: (id) =>
    api.get(`/products/${id}`).then(r => r.data),

  lowStock: () =>
    api.get('/products/low-stock').then(r => r.data),

  create: (payload) =>
    api.post('/products', payload).then(r => r.data),

  update: (id, payload) =>
    api.put(`/products/${id}`, payload).then(r => r.data),

  softDelete: (id, body = {}) =>
    api.delete(`/products/${id}`, { data: body }).then(r => r.data),

  restore: (id) =>
    api.post(`/products/${id}/restore`).then(r => r.data),

  // Single-product price update — backend has no bulk-price endpoint,
  // so admin UI's "bulk price update" will fan out N sequential calls.
  updatePrice: (id, payload) =>
    api.post(`/products/${id}/update-price`, payload).then(r => r.data),

  adjustStock: (id, payload) =>
    api.post(`/products/${id}/adjust-stock`, payload).then(r => r.data),
};
