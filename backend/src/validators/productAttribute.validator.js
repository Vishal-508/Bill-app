const { z } = require('zod');

// ─── Base schema (pure ZodObject — supports .partial()) ───
const baseProductAttributeSchema = z.object({
  name: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      /^[a-z][a-z0-9_-]*$/,
      'Name must start with lowercase letter, contain only lowercase letters, digits, underscores, or hyphens'
    )
    .max(50),
  label: z.string().trim().min(2).max(100),
  description: z.string().trim().max(500).optional(),
  type: z.enum(['string', 'number', 'enum', 'boolean']),
  options: z.array(z.string().trim().max(50)).default([]),
  unit: z.string().trim().max(20).optional(),
  isRequired: z.boolean().default(false),
  isActive: z.boolean().default(true),
  displayOrder: z.number().int().min(0).default(100),
  minValue: z.number().optional(),
  maxValue: z.number().optional(),
  minLength: z.number().int().min(0).optional(),
  maxLength: z.number().int().min(0).optional(),
});

// ─── Create: enforces the enum-options rule via .refine() ───
const createProductAttributeSchema = baseProductAttributeSchema.refine(
  (data) => {
    if (data.type === 'enum' && (!data.options || data.options.length === 0)) {
      return false;
    }
    return true;
  },
  {
    message: 'Enum attributes must have at least one option',
    path: ['options'],
  }
);

// ─── Update: derived from base (ZodObject), supports .partial() ───
const updateProductAttributeSchema = baseProductAttributeSchema.partial();

module.exports = {
  createProductAttributeSchema,
  updateProductAttributeSchema,
};
