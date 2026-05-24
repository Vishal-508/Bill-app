const { z } = require('zod');
const mongoose = require('mongoose');

const objectIdSchema = z.string().refine(
  (val) => mongoose.Types.ObjectId.isValid(val),
  { message: 'Invalid ID format' }
);

const createBillFromOrderSchema = z.object({
  order: objectIdSchema.optional(),
  format: z.enum(['detailed', 'simple', 'minimal']).default('detailed'),
  language: z.enum(['en', 'hi']).default('en'),
  hasGst: z.boolean().default(true),
  dueDate: z.string().datetime().or(z.date()).optional(),
  notesToCustomer: z.string().trim().max(2000).optional(),
  internalNotes: z.string().trim().max(2000).optional(),
  termsAndConditions: z.string().trim().max(5000).optional(),
  deliveryMethod: z.string().trim().max(100).optional(),
  transportDetails: z.string().trim().max(200).optional(),
  vehicleNumber: z.string().trim().max(50).optional(),
});

const updateBillSchema = z.object({
  format: z.enum(['detailed', 'simple', 'minimal']).optional(),
  language: z.enum(['en', 'hi']).optional(),
  hasGst: z.boolean().optional(),
  dueDate: z.string().datetime().or(z.date()).optional(),
  notesToCustomer: z.string().trim().max(2000).optional(),
  internalNotes: z.string().trim().max(2000).optional(),
  termsAndConditions: z.string().trim().max(5000).optional(),
  deliveryMethod: z.string().trim().max(100).optional(),
  transportDetails: z.string().trim().max(200).optional(),
  vehicleNumber: z.string().trim().max(50).optional(),
  placeOfSupply: z.string().trim().max(100).optional(),
});

const finalizeBillSchema = z.object({
  notes: z.string().trim().max(500).optional(),
});

const markSentSchema = z.object({
  channel: z.enum(['email', 'whatsapp', 'print', 'in-person']),
  notes: z.string().trim().max(500).optional(),
  recipientInfo: z.string().trim().max(200).optional(),
});

const cancelBillSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

const uploadSignatureSchema = z.object({
  signatureImage: z.string()
    .min(100, 'Signature image data too small')
    .max(2_000_000, 'Signature image too large (max 2MB)')
    .refine(
      (val) => val.startsWith('data:image/') || val.startsWith('/9j/') || val.startsWith('iVBOR'),
      { message: 'Must be base64-encoded image (PNG or JPEG)' }
    ),
  signedByName: z.string().trim().min(1).max(100).optional(),
});

module.exports = {
  createBillFromOrderSchema,
  updateBillSchema,
  finalizeBillSchema,
  markSentSchema,
  cancelBillSchema,
  uploadSignatureSchema,
};
