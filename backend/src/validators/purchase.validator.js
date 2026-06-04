const { z } = require('zod');
const mongoose = require('mongoose');

const objectIdSchema = z.string().refine(
  (v) => mongoose.Types.ObjectId.isValid(v),
  { message: 'Invalid ObjectId' }
);

const purchaseItemInputSchema = z.object({
  productId: objectIdSchema,
  quantity: z.number().int().min(1),
  ratePerSheet: z.number().min(0),
  notes: z.string().trim().max(500).optional(),
});

exports.purchaseCreateSchema = z.object({
  vendorId: objectIdSchema,
  items: z.array(purchaseItemInputSchema).min(1, 'At least one item required'),
  gstRatePct: z.number().min(0).max(100).optional(),
  expectedAt: z.string().optional().refine(
    (v) => !v || !Number.isNaN(new Date(v).getTime()),
    { message: 'Invalid expectedAt date' }
  ),
  notes: z.string().trim().max(2000).optional(),
}).passthrough();

exports.purchaseUpdateSchema = z.object({
  items: z.array(purchaseItemInputSchema).min(1).optional(),
  gstRatePct: z.number().min(0).max(100).optional(),
  expectedAt: z.string().optional().refine(
    (v) => !v || !Number.isNaN(new Date(v).getTime()),
    { message: 'Invalid expectedAt date' }
  ),
  notes: z.string().trim().max(2000).optional(),
}).passthrough();

exports.purchaseReceiveSchema = z.object({
  items: z.array(z.object({
    productId: objectIdSchema,
    receivedQuantity: z.number().int().min(0),
  })).min(1),
  receivedAt: z.string().optional().refine(
    (v) => !v || !Number.isNaN(new Date(v).getTime()),
    { message: 'Invalid receivedAt date' }
  ),
  invoiceNo: z.string().trim().max(100).optional(),
}).passthrough();

exports.purchaseCancelSchema = z.object({
  reason: z.string().trim().min(1, 'Cancellation reason required').max(500),
}).passthrough();

exports.purchaseQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(20).optional(),
  status: z.enum(['DRAFT', 'ORDERED', 'PARTIAL_RECEIVED', 'RECEIVED', 'CANCELLED']).optional(),
  vendorId: objectIdSchema.optional(),
  paymentStatus: z.enum(['UNPAID', 'PARTIAL', 'PAID']).optional(),
  dateFrom: z.string().optional().refine(
    (v) => !v || !Number.isNaN(new Date(v).getTime()),
    { message: 'Invalid dateFrom' }
  ),
  dateTo: z.string().optional().refine(
    (v) => !v || !Number.isNaN(new Date(v).getTime()),
    { message: 'Invalid dateTo' }
  ),
  search: z.string().trim().max(200).optional(),
  sortBy: z.enum(['createdAt', 'orderedAt', 'receivedAt', 'grandTotal']).default('createdAt').optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc').optional(),
}).passthrough();
