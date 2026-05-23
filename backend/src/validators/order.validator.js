const { z } = require('zod');
const mongoose = require('mongoose');

const objectIdSchema = z.string().refine(
  (val) => mongoose.Types.ObjectId.isValid(val),
  { message: 'Invalid ID format' }
);

// Dimensions sub-schema (for CUSTOM_CUT items)
const dimensionsSchema = z.object({
  lengthInches: z.number().min(0).optional(),
  widthInches: z.number().min(0).optional(),
  diameterInches: z.number().min(0).optional(),
  lengthDisplay: z.string().optional(),
  widthDisplay: z.string().optional(),
  areaSqInches: z.number().min(0).optional(),
  areaSqFt: z.number().min(0).optional(),
}).optional();

// Order item schema (polymorphic)
const orderItemSchema = z.object({
  itemType: z.enum(['FULL_SHEET', 'BUNDLE', 'CUSTOM_CUT']),
  product: objectIdSchema,

  // For CUSTOM_CUT
  fromRawSheet: objectIdSchema.optional(),
  dimensions: dimensionsSchema,
  shape: objectIdSchema.optional(),
  cuttingRule: objectIdSchema.optional(),

  quantity: z.number().int().min(1),
  pricePerUnit: z.number().min(0),
  materialCost: z.number().min(0).default(0),
  cuttingCharges: z.number().min(0).default(0),
  wastageAreaSqFt: z.number().min(0).default(0),
  wastageCost: z.number().min(0).default(0),
  discountPct: z.number().min(0).max(100).default(0),
  discountAmount: z.number().min(0).default(0),
  lineSubtotal: z.number().min(0),
  notes: z.string().trim().max(500).optional(),
});

// Address sub-schema
const addressSchema = z.object({
  addressLine1: z.string().trim().min(1).max(200),
  addressLine2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1).max(100),
  state: z.string().trim().min(1).max(100),
  pincode: z.string().trim().regex(/^[1-9][0-9]{5}$/, 'Invalid pincode'),
}).optional();

// Base order schema
const baseOrderSchema = z.object({
  customer: objectIdSchema,
  orderDate: z.string().datetime().or(z.date()).optional(),

  items: z.array(orderItemSchema).min(1, 'Order must have at least one item'),

  // Pricing
  subtotal: z.number().min(0),
  additionalCharges: z.number().min(0).default(0),
  discountAmount: z.number().min(0).default(0),
  taxableAmount: z.number().min(0),

  isIntraState: z.boolean().default(true),
  gstRatePct: z.number().min(0).max(100).default(18),
  cgst: z.number().min(0).default(0),
  sgst: z.number().min(0).default(0),
  igst: z.number().min(0).default(0),
  totalGst: z.number().min(0).default(0),
  totalAmount: z.number().min(0),

  // Bill preferences
  billFormat: z.enum(['detailed', 'simple', 'minimal']).default('detailed'),
  hasGstBill: z.boolean().default(true),

  // Payment
  paymentMode: z.enum(['FULL_UPFRONT', 'PARTIAL', 'CREDIT']).default('FULL_UPFRONT'),
  amountPaid: z.number().min(0).default(0),
  creditDueDate: z.string().datetime().or(z.date()).optional(),

  // Delivery
  deliveryMethod: z.enum(['PICKUP', 'DELIVERY']).default('PICKUP'),
  deliveryAddress: addressSchema,
  expectedDeliveryDate: z.string().datetime().or(z.date()).optional(),
  deliveryNotes: z.string().trim().max(500).optional(),

  // Notes
  customerNotes: z.string().trim().max(2000).optional(),
  internalNotes: z.string().trim().max(2000).optional(),

  tags: z.array(z.string().trim().max(50)).max(10).default([]),
});

const createOrderSchema = baseOrderSchema;
const updateOrderSchema = baseOrderSchema.partial();

const statusChangeSchema = z.object({
  status: z.enum([
    'PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED',
    'CUTTING', 'BUNDLING', 'READY', 'DELIVERED',
  ]),
  notes: z.string().trim().max(500).optional(),
});

const cancelOrderSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

const softDeleteOrderSchema = z.object({
  reason: z.string().trim().min(3).max(500).optional(),
});

const addPaymentSchema = z.object({
  amount: z.number().positive('Amount must be positive'),
  mode: z.enum(['CASH', 'UPI', 'CARD', 'BANK_TRANSFER', 'CHEQUE', 'CREDIT']),
  reference: z.string().trim().max(100).optional(),
  paidAt: z.string().datetime().or(z.date()).optional(),
  notes: z.string().trim().max(500).optional(),
});

const refundPaymentSchema = z.object({
  paymentId: z.string().refine(
    (val) => mongoose.Types.ObjectId.isValid(val),
    { message: 'Invalid payment ID' }
  ),
  reason: z.string().trim().min(3).max(500),
  refundMode: z.enum(['CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE']).optional(),
});

module.exports = {
  createOrderSchema,
  updateOrderSchema,
  statusChangeSchema,
  cancelOrderSchema,
  softDeleteOrderSchema,
  addPaymentSchema,
  refundPaymentSchema,
};
