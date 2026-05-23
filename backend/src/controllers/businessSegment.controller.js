const { BusinessSegment, Customer } = require('../models');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const logger = require('../config/logger');

/**
 * GET /api/business-segments
 * Public-ish (any authenticated user) — used for dropdowns
 * Query params: ?activeOnly=true (default: true)
 */
exports.list = asyncHandler(async (req, res) => {
  const activeOnly = req.query.activeOnly !== 'false';
  const filter = activeOnly ? { isActive: true } : {};

  const segments = await BusinessSegment.find(filter)
    .sort({ displayOrder: 1, label: 1 })
    .lean();

  res.json({
    status: 'success',
    count: segments.length,
    data: segments,
  });
});

/**
 * GET /api/business-segments/:id
 */
exports.getById = asyncHandler(async (req, res) => {
  const segment = await BusinessSegment.findById(req.params.id);
  if (!segment) {
    throw ApiError.notFound('Business segment not found');
  }
  res.json({ status: 'success', data: segment });
});

/**
 * POST /api/business-segments
 * Admin only — adds a new segment
 */
exports.create = asyncHandler(async (req, res) => {
  // Check duplicate code
  const existing = await BusinessSegment.findByCode(req.body.code);
  if (existing) {
    throw ApiError.conflict(`Segment with code '${req.body.code}' already exists`);
  }

  const segment = await BusinessSegment.create({
    ...req.body,
    isSystemDefault: false,  // Admin-added are never system defaults
    createdBy: req.user._id,
  });

  logger.info(`Business segment created: ${segment.code} by ${req.user.email}`);

  res.status(201).json({ status: 'success', data: segment });
});

/**
 * PUT /api/business-segments/:id
 * Admin only — edit segment
 */
exports.update = asyncHandler(async (req, res) => {
  const segment = await BusinessSegment.findById(req.params.id);
  if (!segment) {
    throw ApiError.notFound('Business segment not found');
  }

  // If changing code, check for conflict
  if (req.body.code && req.body.code.toUpperCase() !== segment.code) {
    const conflict = await BusinessSegment.findByCode(req.body.code);
    if (conflict) {
      throw ApiError.conflict(`Segment with code '${req.body.code}' already exists`);
    }
  }

  // Apply updates
  Object.assign(segment, req.body);
  segment.updatedBy = req.user._id;
  await segment.save();

  logger.info(`Business segment updated: ${segment.code} by ${req.user.email}`);

  res.json({ status: 'success', data: segment });
});

/**
 * DELETE /api/business-segments/:id
 * Admin only — delete custom segment
 * Restrictions:
 *   - Cannot delete system defaults (isSystemDefault === true)
 *   - Cannot delete if customers are using it
 */
exports.remove = asyncHandler(async (req, res) => {
  const segment = await BusinessSegment.findById(req.params.id);
  if (!segment) {
    throw ApiError.notFound('Business segment not found');
  }

  // Protect system defaults — they can be deactivated but not deleted
  if (segment.isSystemDefault) {
    throw ApiError.forbidden(
      'System-default segments cannot be deleted. Set isActive: false instead.'
    );
  }

  // Check if any customer references this segment
  const customerCount = await Customer.countDocuments({
    businessSegment: segment._id,
    isDeleted: false,
  });

  if (customerCount > 0) {
    throw ApiError.conflict(
      `Cannot delete: ${customerCount} customer(s) currently use this segment. Reassign them first or deactivate this segment instead.`
    );
  }

  await segment.deleteOne();
  logger.info(`Business segment deleted: ${segment.code} by ${req.user.email}`);

  res.json({
    status: 'success',
    message: `Segment '${segment.label}' deleted`,
  });
});
