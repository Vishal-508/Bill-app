const { z } = require('zod');
const mongoose = require('mongoose');

const objectIdString = z.string().refine(
  (v) => mongoose.Types.ObjectId.isValid(v),
  { message: 'Invalid ObjectId' }
);

exports.productIdParamSchema = z.object({
  productId: objectIdString,
}).passthrough();

exports.forecastSummaryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(20).optional(),
  sortBy: z.enum(['next30days', 'mape', 'computedAt', 'name']).default('next30days').optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc').optional(),
  method: z.enum(['holt-winters', 'moving-average', 'naive', 'fallback']).optional(),
  isStale: z.union([z.literal('true'), z.literal('false'), z.boolean()]).optional(),
  includeNoForecast: z.union([z.literal('true'), z.literal('false'), z.boolean()]).default('false').optional(),
}).passthrough();
