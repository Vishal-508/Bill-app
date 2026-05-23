const { z } = require('zod');
const mongoose = require('mongoose');
const { toInches, SUPPORTED_UNITS } = require('../utils/unitConverter');

const objectIdSchema = z.string().refine(
  (val) => mongoose.Types.ObjectId.isValid(val),
  { message: 'Invalid ID format' }
);

// Base schema (input — accepts any unit, converts to inches)
const baseBundleSizeSchema = z.object({
  shape: objectIdSchema,
  length: z.number().min(0.1),
  width: z.number().min(0.1),
  unit: z.enum(SUPPORTED_UNITS).default('inch'),
  defaultPiecesPerBundle: z.number().int().min(1).default(50),
  description: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(500).optional(),
  displayOrder: z.number().int().min(0).default(100),
  isActive: z.boolean().default(true),
});

const createBundleSizeSchema = baseBundleSizeSchema.transform((data) => {
  return {
    shape: data.shape,
    lengthInches: toInches(data.length, data.unit),
    widthInches: toInches(data.width, data.unit),
    preferredUnit: data.unit,
    defaultPiecesPerBundle: data.defaultPiecesPerBundle,
    description: data.description,
    notes: data.notes,
    displayOrder: data.displayOrder,
    isActive: data.isActive,
  };
});

const updateBundleSizeSchema = baseBundleSizeSchema.partial();

module.exports = {
  createBundleSizeSchema,
  updateBundleSizeSchema,
};
