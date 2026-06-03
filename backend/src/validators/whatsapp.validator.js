const { z } = require('zod');
const mongoose = require('mongoose');

const objectIdSchema = z.string().refine(
  (val) => mongoose.Types.ObjectId.isValid(val),
  { message: 'Invalid ID format' }
);

// POST /api/whatsapp/send-bill/:billId (body — all optional overrides)
const sendBillSchema = z.object({
  templateName: z.string().trim().min(1).max(100).optional(),
  pdfUrl: z.string().url().optional(),
});

// POST /api/whatsapp/send-payment-link
const sendPaymentLinkSchema = z.object({
  billId: objectIdSchema,
  paymentLinkUrl: z.string().url(),
  templateName: z.string().trim().min(1).max(100).optional(),
});

// POST /api/whatsapp/send-order-confirmation/:orderId
const sendOrderConfirmationSchema = z.object({
  templateName: z.string().trim().min(1).max(100).optional(),
});

// POST /api/whatsapp/send-order-ready/:orderId
const sendOrderReadySchema = z.object({
  templateName: z.string().trim().min(1).max(100).optional(),
});

// POST /api/whatsapp/send-text
const sendTextSchema = z.object({
  customerId: objectIdSchema.optional(),
  to: z.string().trim().min(10).max(20).optional(),
  text: z.string().trim().min(1).max(4096),
}).refine(
  (val) => val.customerId || val.to,
  { message: 'Either customerId or to is required' }
);

module.exports = {
  sendBillSchema,
  sendPaymentLinkSchema,
  sendOrderConfirmationSchema,
  sendOrderReadySchema,
  sendTextSchema,
};
