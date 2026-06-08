import { z } from 'zod';

/**
 * Frontend Zod schema for the Product form. Mirrors the backend's
 * createProductSchema field-for-field — names, ranges, defaults. The
 * backend has `PRE_CUT_BUNDLE` as an alternate product type in the
 * model but its create/update validator only supports the standard
 * sheet shape, so this form is single-type.
 *
 * `isActive` is now part of the backend's update validator (added in
 * Prompt 11 Section D bug fix) so a future toggle works cleanly.
 */
export const productSchema = z.object({
  name:        z.string().trim().min(2, 'Name must be 2+ chars').max(200),
  description: z.string().trim().max(1000).optional().or(z.literal('')),
  brand:       z.string().trim().max(100).optional().or(z.literal('')),
  sku:         z.string().trim().toUpperCase().max(50).optional().or(z.literal('')),

  thicknessMM: z.coerce.number().min(0.1, 'Min 0.1mm').max(100, 'Max 100mm'),
  lengthFT:    z.coerce.number().min(0.1).max(100).default(8),
  widthFT:     z.coerce.number().min(0.1).max(100).default(4),

  grade:       z.string().min(1, 'Grade is required'),  // ObjectId — validated server-side

  pricingUnit: z.enum(['sqft', 'sqinch', 'sheet']).default('sqft'),
  basePrice:   z.coerce.number().min(0, 'Price cannot be negative'),

  currentStock:     z.coerce.number().int().min(0).default(0),
  minStockAlert:    z.coerce.number().int().min(0).default(10),
  reorderQuantity:  z.coerce.number().int().min(0).default(50),

  hsnCode:   z.string().trim().max(10).default('4411'),
  gstRatePct: z.coerce.number().min(0).max(100).default(18),

  notes:     z.string().trim().max(2000).optional().or(z.literal('')),
});
