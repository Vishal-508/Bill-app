import { api } from './axios.js';
import { API_BASE_URL } from '../utils/constants.js';

/**
 * Bill endpoint wrappers.
 *
 * CONTRACT NOTES (backend differs from initial spec):
 *  - Bills can ONLY be created from an order via `/from-order/:orderId`.
 *    No direct bill creation endpoint exists.
 *  - "Send" semantics: backend's `mark-sent` RECORDS that an external
 *    send happened (channel: email/whatsapp/print/in-person). The
 *    actual transmission is via Prompt 7's notification orchestrator
 *    OR done manually by admin. There is no "POST /bills/:id/send"
 *    that triggers transmission directly.
 */
export const billApi = {
  list: (params) =>
    api.get('/bills', { params }).then(r => r.data),

  get: (id) =>
    api.get(`/bills/${id}`).then(r => r.data),

  byOrder: (orderId) =>
    api.get(`/bills/by-order/${orderId}`).then(r => r.data),

  byCustomer: (customerId, params) =>
    api.get(`/bills/by-customer/${customerId}`, { params }).then(r => r.data),

  createFromOrder: (orderId, payload = {}) =>
    api.post(`/bills/from-order/${orderId}`, payload).then(r => r.data),

  update: (id, payload) =>
    api.put(`/bills/${id}`, payload).then(r => r.data),

  // DRAFT → FINAL transition. Locks the bill.
  finalize: (id, payload = {}) =>
    api.post(`/bills/${id}/finalize`, payload).then(r => r.data),

  // Records an external send event ({ channel, notes?, recipientInfo? }).
  // channel ∈ { 'email', 'whatsapp', 'print', 'in-person' }
  markSent: (id, payload) =>
    api.post(`/bills/${id}/mark-sent`, payload).then(r => r.data),

  cancel: (id, payload) =>
    api.post(`/bills/${id}/cancel`, payload).then(r => r.data),

  // ─── PDF download ───
  // IMPORTANT: backend's GET /bills/:id/pdf is JWT-protected and the
  // browser will NOT attach our Authorization header to a plain
  // window.open() — that yielded 401 in browser verification. So we
  // fetch the bytes via the authenticated axios instance, then trigger
  // a download via a temporary blob URL.
  downloadPdf: async (id) => {
    const res = await api.get(`/bills/${id}/pdf`, { responseType: 'blob' });
    // Prefer the backend's Content-Disposition filename when present
    const disp = res.headers?.['content-disposition'] || '';
    const match = disp.match(/filename="?([^";]+)"?/);
    const filename = match?.[1] || `bill-${id}.pdf`;

    const blobUrl = URL.createObjectURL(res.data);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    // Browser holds the URL while the save dialog is open; clean up after.
    setTimeout(() => URL.revokeObjectURL(blobUrl), 30_000);
    return filename;
  },

  // Deprecated — kept temporarily for any caller that pre-existed the
  // blob-download switch. New code MUST use downloadPdf(id) instead.
  // Will be removed once Section F payment-receipt download uses the
  // same pattern.
  pdfUrl: (id) => `${API_BASE_URL}/bills/${id}/pdf`,

  regeneratePdf: (id) =>
    api.post(`/bills/${id}/regenerate-pdf`).then(r => r.data),

  // ─── Signatures ───
  getSignatures: (id) =>
    api.get(`/bills/${id}/signatures`).then(r => r.data),

  uploadCustomerSignature: (id, payload) =>
    api.post(`/bills/${id}/customer-signature`, payload).then(r => r.data),

  uploadIssuerSignature: (id, payload) =>
    api.post(`/bills/${id}/issuer-signature`, payload).then(r => r.data),

  softDelete: (id) =>
    api.delete(`/bills/${id}`).then(r => r.data),
};
