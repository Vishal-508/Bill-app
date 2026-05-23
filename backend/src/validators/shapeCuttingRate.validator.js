const { z } = require('zod');

const baseShapeSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z_]+$/).max(50),
  label: z.string().trim().min(2).max(100),
  description: z.string().trim().max(500).optional(),
  iconName: z.string().trim().max(50).optional(),
  calculationMode: z.enum(['multiplier', 'fixed-addon', 'perimeter-based', 'custom']).default('multiplier'),
  baseMultiplier: z.number().min(0).default(1.0),
  fixedAddOnPerPiece: z.number().min(0).default(0),
  perInchPerimeterRate: z.number().min(0).default(0),
  customCalculationNotes: z.string().trim().max(500).optional(),
  cutsPerPiece: z.number().int().min(0).default(4),
  isActive: z.boolean().default(true),
  displayOrder: z.number().int().min(0).default(100),
});

const createShapeSchema = baseShapeSchema;
const updateShapeSchema = baseShapeSchema.partial();

module.exports = { createShapeSchema, updateShapeSchema };
