const { z } = require('zod');

const createProductGradeSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z_]+$/, 'Code must be UPPERCASE_WITH_UNDERSCORES').max(50),
  label: z.string().trim().min(2).max(100),
  description: z.string().trim().max(500).optional(),
  iconName: z.string().trim().max(50).optional(),
  displayOrder: z.number().int().min(0).default(100),
  isActive: z.boolean().default(true),
  defaultGstRatePct: z.number().min(0).max(100).default(18),
});

const updateProductGradeSchema = createProductGradeSchema.partial();

module.exports = {
  createProductGradeSchema,
  updateProductGradeSchema,
};
