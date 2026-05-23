const { z } = require('zod');

const tieredRateSchema = z.object({
  maxAreaSqFt: z.number().nullable().optional(),
  rate: z.number().min(0),
  unit: z.enum(['per-piece', 'per-sqft']).default('per-piece'),
});

const baseCuttingRuleSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]+$/).max(50),
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(500).optional(),
  mode: z.enum(['per-piece', 'per-cut', 'per-sqft', 'included', 'tiered']),
  perPieceRate: z.number().min(0).default(0),
  perCutRate: z.number().min(0).default(0),
  perSqftRate: z.number().min(0).default(0),
  tieredRates: z.array(tieredRateSchema).default([]),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
  displayOrder: z.number().int().min(0).default(100),
});

const createCuttingRuleSchema = baseCuttingRuleSchema;
const updateCuttingRuleSchema = baseCuttingRuleSchema.partial();

module.exports = { createCuttingRuleSchema, updateCuttingRuleSchema };
