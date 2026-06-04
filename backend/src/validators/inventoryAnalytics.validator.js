const { z } = require('zod');
const mongoose = require('mongoose');

const optionalObjectId = z.string().optional().refine(
  (v) => !v || mongoose.Types.ObjectId.isValid(v),
  { message: 'Invalid ObjectId' }
);

const optionalIsoDate = z.string().optional().refine(
  (v) => !v || !Number.isNaN(new Date(v).getTime()),
  { message: 'Invalid date (expecting ISO 8601 or YYYY-MM-DD)' }
);

/**
 * Defaults applied IN THE CONTROLLER (not the validator) so the validator
 * stays a pure schema — easier to reason about.
 */
const dateRangeBase = {
  dateFrom: optionalIsoDate,
  dateTo: optionalIsoDate,
};

exports.consumptionQuerySchema = z.object({
  ...dateRangeBase,
  groupBy: z.enum(['day', 'week', 'month']).default('day').optional(),
  productId: optionalObjectId,
}).passthrough();

exports.byProductQuerySchema = z.object({
  ...dateRangeBase,
  limit: z.coerce.number().int().min(1).max(200).default(20).optional(),
  sortBy: z.enum(['consumption', 'trend']).default('consumption').optional(),
}).passthrough();

exports.bySizeQuerySchema = z.object({
  ...dateRangeBase,
}).passthrough();

exports.byGradeQuerySchema = z.object({
  ...dateRangeBase,
}).passthrough();

exports.bundlesQuerySchema = z.object({}).passthrough();

exports.dashboardQuerySchema = z.object({
  ...dateRangeBase,
}).passthrough();
