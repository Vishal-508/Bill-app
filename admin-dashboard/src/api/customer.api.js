import { api } from './axios.js';

/**
 * Customer endpoint wrappers — every method returns the parsed JSON
 * body (axios's `r.data`) so the React Query hooks don't have to
 * unwrap. List responses are `{ status, data: [...], pagination }`;
 * detail/create/update are `{ status, data: {...} }`.
 */
export const customerApi = {
  list: (params) =>
    api.get('/customers', { params }).then(r => r.data),

  get: (id) =>
    api.get(`/customers/${id}`).then(r => r.data),

  insights: (id) =>
    api.get(`/customers/${id}/insights`).then(r => r.data),

  create: (payload) =>
    api.post('/customers', payload).then(r => r.data),

  // Backend uses PUT (not PATCH) for updates
  update: (id, payload) =>
    api.put(`/customers/${id}`, payload).then(r => r.data),

  // Soft delete requires a body (e.g. reason); accepts {} as default
  softDelete: (id, body = {}) =>
    api.delete(`/customers/${id}`, { data: body }).then(r => r.data),

  restore: (id) =>
    api.post(`/customers/${id}/restore`).then(r => r.data),

  // Bulk operations — payload shapes match the backend validators
  bulkUpdate: (payload) =>
    api.post('/customers/bulk-update', payload).then(r => r.data),

  bulkSoftDelete: (payload) =>
    api.post('/customers/bulk-delete', payload).then(r => r.data),
};
