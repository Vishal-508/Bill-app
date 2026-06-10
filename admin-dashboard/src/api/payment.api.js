import { api } from './axios.js';
import { API_BASE_URL } from '../utils/constants.js';

/**
 * Payment endpoint wrappers.
 *
 * TWO DISTINCT PAYMENT PATHS:
 *  - **Manual** (CASH/UPI/CARD/BANK_TRANSFER/CHEQUE/CREDIT) →
 *    recorded via `POST /orders/:orderId/payments` (see order.api.js).
 *    These are admin-entered payments already received.
 *  - **Razorpay online** → uses this module's `initiate` + `verify`
 *    flow. `initiate` creates a Razorpay order + returns the
 *    `paymentReference` and Razorpay credentials. After the customer
 *    pays via the link, `verify` is called with the HMAC signature.
 */
export const paymentApi = {
  list: (params) =>
    api.get('/payments', { params }).then(r => r.data),

  get: (id) =>
    api.get(`/payments/${id}`).then(r => r.data),

  byOrder: (orderId) =>
    api.get(`/payments/by-order/${orderId}`).then(r => r.data),

  byCustomer: (customerId, params) =>
    api.get(`/payments/by-customer/${customerId}`, { params }).then(r => r.data),

  // ─── Razorpay lifecycle ───
  // Body: { order, amount, notes?, bill? }
  initiate: (payload) =>
    api.post('/payments/initiate', payload).then(r => r.data),

  // Body: { paymentReference, razorpayOrderId, razorpayPaymentId, razorpaySignature }
  verify: (payload) =>
    api.post('/payments/verify', payload).then(r => r.data),

  // ─── Lifecycle ───
  cancel: (id, payload) =>
    api.post(`/payments/${id}/cancel`, payload).then(r => r.data),

  initiateRefund: (id, payload) =>
    api.post(`/payments/${id}/refund`, payload).then(r => r.data),

  // ─── Refund queries ───
  listRefunds: (params) =>
    api.get('/payments/refunds', { params }).then(r => r.data),

  getRefund: (id) =>
    api.get(`/payments/refunds/${id}`).then(r => r.data),

  // ─── Razorpay config (key id, etc.) ───
  config: () =>
    api.get('/payments/config').then(r => r.data),

  // ─── UPI / QR / Receipt ───
  upiUri: (id) =>
    api.get(`/payments/${id}/upi-uri`).then(r => r.data),

  // QR image — JWT-protected endpoint. The auth-pdf-download memory
  // note flags that <img src=url> can't send the Bearer header → 401.
  // Returning the bytes lets the caller render via blob URL or <img
  // src={blobUrl}>. The qrImageUrl alias below is kept ONLY for the
  // RazorpayLinkModal's customer-shareable URL (which is intentionally
  // unauthenticated for the customer's side).
  fetchQrImage: async (id) => {
    const res = await api.get(`/payments/${id}/qr`, { responseType: 'blob' });
    return URL.createObjectURL(res.data);
  },
  qrImageUrl: (id) => `${API_BASE_URL}/payments/${id}/qr`,

  // Receipt PDF — uses the blob-fetch pattern from bills (memory note).
  // Triggers the browser's save dialog via a temporary anchor.
  downloadReceipt: async (id) => {
    const res = await api.get(`/payments/${id}/receipt`, { responseType: 'blob' });
    const disp = res.headers?.['content-disposition'] || '';
    const match = disp.match(/filename="?([^";]+)"?/);
    const filename = match?.[1] || `receipt-${id}.pdf`;
    const blobUrl = URL.createObjectURL(res.data);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 30_000);
    return filename;
  },
};

// ─── Paise ↔ rupees helpers ───
// Payment.amount is stored in PAISE (Razorpay convention). Always
// convert for display; convert back when sending Razorpay amounts to
// the backend's initiate endpoint.
export const paiseToRupees = (paise) => {
  const p = Number(paise);
  if (!Number.isFinite(p)) return 0;
  return p / 100;
};
export const rupeesToPaise = (rupees) => {
  const r = Number(rupees);
  if (!Number.isFinite(r)) return 0;
  return Math.round(r * 100);
};
