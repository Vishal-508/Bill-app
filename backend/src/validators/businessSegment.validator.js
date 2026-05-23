const { z } = require('zod');

const createBusinessSegmentSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z_]+$/, 'Code must be UPPERCASE with underscores only')
    .max(50),
  label: z.string().trim().min(2).max(100),
  description: z.string().trim().max(500).optional(),
  iconName: z.string().trim().max(50).optional(),
  displayOrder: z.number().int().min(0).default(100),
  isActive: z.boolean().default(true),
});

const updateBusinessSegmentSchema = createBusinessSegmentSchema.partial();

module.exports = {
  createBusinessSegmentSchema,
  updateBusinessSegmentSchema,
};
