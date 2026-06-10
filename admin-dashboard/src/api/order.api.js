import { api } from './axios.js';

/**
 * Order endpoint wrappers. Every method returns the parsed JSON body
 * (axios's `r.data`). List responses are `{ status, data: [...],
 * pagination }`; mutations return `{ status, data: {...} }`.
 *
 * NOTE: Order soft-delete's `reason` is OPTIONAL (different from
 * Customer + Product which REQUIRE it).
 */
export const orderApi = {
  list: (params) =>
    api.get('/orders', { params }).then(r => r.data),

  get: (id) =>
    api.get(`/orders/${id}`).then(r => r.data),

  byCustomer: (customerId, params) =>
    api.get(`/orders/by-customer/${customerId}`, { params }).then(r => r.data),

  create: (payload) =>
    api.post('/orders', payload).then(r => r.data),

  // Backend uses PUT for updates (not PATCH).
  update: (id, payload) =>
    api.put(`/orders/${id}`, payload).then(r => r.data),

  // Status change: { status, notes? } — backend's statusChangeSchema
  changeStatus: (id, payload) =>
    api.post(`/orders/${id}/status`, payload).then(r => r.data),

  // Cancel requires { reason: 3+ chars }
  cancel: (id, payload) =>
    api.post(`/orders/${id}/cancel`, payload).then(r => r.data),

  // ─── Payment sub-resource ───
  // Manual payments (CASH/UPI/CARD/BANK_TRANSFER/CHEQUE/CREDIT) live
  // under the order, NOT under /payments. The Razorpay flow uses
  // /payments/initiate + /payments/verify separately.
  getPayments: (id) =>
    api.get(`/orders/${id}/payments`).then(r => r.data),

  addPayment: (id, payload) =>
    api.post(`/orders/${id}/payments`, payload).then(r => r.data),

  refund: (id, payload) =>
    api.post(`/orders/${id}/refund`, payload).then(r => r.data),

  // ─── Outstanding / Dues ───
  customerDues: (customerId) =>
    api.get(`/orders/customer-dues/${customerId}`).then(r => r.data),

  outstandingPayments: (params) =>
    api.get('/orders/outstanding-payments', { params }).then(r => r.data),

  // ─── Pricing pre-check helpers ───
  calculatePreview: (payload) =>
    api.post('/orders/calculate-preview', payload).then(r => r.data),

  recalculatePricing: (id) =>
    api.post(`/orders/${id}/recalculate-pricing`).then(r => r.data),

  checkStock: (payload) =>
    api.post('/orders/check-stock', payload).then(r => r.data),

  // ─── Destructive ───
  softDelete: (id, body = {}) =>
    api.delete(`/orders/${id}`, { data: body }).then(r => r.data),
};
