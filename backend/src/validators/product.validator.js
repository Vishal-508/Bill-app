const { z } = require('zod');
const mongoose = require('mongoose');

const objectIdSchema = z.string().refine(
  (val) => mongoose.Types.ObjectId.isValid(val),
  { message: 'Invalid ID format' }
);

const quantityTierSchema = z.object({
  minQty: z.number().int().min(1),
  maxQty: z.number().int().nullable().optional(),
  discountPct: z.number().min(0).max(100),
});

const createProductSchema = z.object({
  name: z.string().trim().min(2).max(200),
  description: z.string().trim().max(1000).optional(),
  brand: z.string().trim().max(100).optional(),

  // SKU is auto-generated, but allow override
  sku: z.string().trim().toUpperCase().max(50).optional(),

  // Dimensions
  thicknessMM: z.number().min(0.1).max(100),
  lengthFT: z.number().min(0.1).max(100).default(8),
  widthFT: z.number().min(0.1).max(100).default(4),

  // Grade reference
  grade: objectIdSchema,

  // Pricing
  pricingUnit: z.enum(['sqft', 'sqinch', 'sheet']).default('sqft'),
  basePrice: z.number().min(0),
  quantityTiers: z.array(quantityTierSchema).max(10).default([]),

  // Stock
  currentStock: z.number().int().min(0).default(0),
  minStockAlert: z.number().int().min(0).default(10),
  reorderQuantity: z.number().int().min(0).default(50),

  // Tax
  hsnCode: z.string().trim().max(10).default('4411'),
  gstRatePct: z.number().min(0).max(100).default(18),

  // Custom fields (free-form for now — validated dynamically against ProductAttribute later)
  customFields: z.record(z.string(), z.any()).optional(),

  // Tags
  tags: z.array(z.string().trim().max(50)).max(10).default([]),

  // Notes
  notes: z.string().trim().max(2000).optional(),
});

const updateProductSchema = createProductSchema.partial();

const softDeleteProductSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

const updatePriceSchema = z.object({
  newPrice: z.number().min(0),
  reason: z.string().trim().min(3).max(200).optional(),
});

const adjustStockSchema = z.object({
  delta: z.number().int(),
  reason: z.string().trim().min(3).max(200),
});

module.exports = {
  createProductSchema,
  updateProductSchema,
  softDeleteProductSchema,
  updatePriceSchema,
  adjustStockSchema,
  quantityTierSchema,
};
