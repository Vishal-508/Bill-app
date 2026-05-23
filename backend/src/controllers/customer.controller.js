const mongoose = require('mongoose');
const { Customer, BusinessSegment } = require('../models');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const QueryBuilder = require('../utils/queryBuilder');
const exporters = require('../utils/exporters');
const logger = require('../config/logger');

/**
 * POST /api/customers
 * Create new customer
 * Access: ADMIN, BILLING
 */
exports.create = asyncHandler(async (req, res) => {
  // If businessSegment provided, verify it exists
  if (req.body.businessSegment) {
    const segmentExists = await BusinessSegment.exists({
      _id: req.body.businessSegment,
      isActive: true,
    });
    if (!segmentExists) {
      throw ApiError.badRequest('Invalid or inactive business segment');
    }
  }

  // If referredBy provided, verify customer exists
  if (req.body.referredBy) {
    const referrerExists = await Customer.exists({
      _id: req.body.referredBy,
      isDeleted: false,
    });
    if (!referrerExists) {
      throw ApiError.badRequest('Referring customer not found');
    }
  }

  const customer = await Customer.create({
    ...req.body,
    createdBy: req.user._id,
  });

  // Populate references for response
  await customer.populate('businessSegment', 'code label iconName');
  if (customer.referredBy) {
    await customer.populate('referredBy', 'customerName phone companyName');
  }

  logger.info(`Customer created: ${customer.customerName} (${customer.phone}) by ${req.user.email}`);

  res.status(201).json({ status: 'success', data: customer });
});

/**
 * GET /api/customers
 * Advanced query with search, filters, sort, pagination, field selection
 *
 * Query params:
 *   Search:      ?search=term
 *   Filters:     ?segment=<objectId>, ?segmentCode=PHOTO_STUDIO, ?size=SMALL,
 *                ?source=GOOGLE, ?tags=VIP,Trusted (AND), ?anyTags=A,B (OR),
 *                ?city, ?state, ?hasGST=true, ?hasDues=true, ?isActive=true,
 *                ?includeDeleted=false (admin only),
 *                ?minCredit, ?maxCredit, ?minLifetime, ?maxLifetime,
 *                ?createdAfter, ?createdBefore
 *   Sort:        ?sort=-createdAt or ?sort=customerName,-createdAt
 *   Pagination:  ?page=1&limit=20 (max 100)
 *   Fields:      ?fields=customerName,phone
 *
 * Access: Any authenticated user
 */
exports.list = asyncHandler(async (req, res) => {
  const q = req.query;

  // Build base filter (admin can see deleted)
  const includeDeleted = q.includeDeleted === 'true';
  if (includeDeleted && !['ADMIN', 'SUPER_ADMIN'].includes(req.user.role)) {
    throw ApiError.forbidden('Only admins can view deleted customers');
  }

  const builder = new QueryBuilder(Customer, q);

  // Default: hide deleted unless explicitly requested
  if (!includeDeleted) {
    builder.setFilter({ isDeleted: false });
  }

  // ─── Text Search ───
  if (q.search) {
    builder.addTextSearch(q.search, [
      'customerName',
      'companyName',
      'phone',
      'email',
    ]);
  }

  // ─── Direct Filters ───
  builder
    .addObjectIdFilter('businessSegment', q.segment)
    .addFilter('businessSize', q.size)
    .addFilter('acquisitionSource', q.source)
    .addFilter('billingAddress.city', q.city)
    .addFilter('billingAddress.state', q.state);

  // ─── segmentCode (UI-friendly) — needs lookup to ObjectId ───
  if (q.segmentCode) {
    const segment = await BusinessSegment.findByCode(q.segmentCode);
    if (segment) {
      builder.addObjectIdFilter('businessSegment', segment._id.toString());
    } else {
      // Invalid code → return empty results (don't throw, just filter to nothing)
      builder.addFilter('businessSegment', new mongoose.Types.ObjectId());
    }
  }

  // ─── Tags ───
  if (q.tags) builder.addArrayFilter('tags', q.tags, 'all');
  if (q.anyTags) builder.addArrayFilter('tags', q.anyTags, 'any');

  // ─── Boolean Filters ───
  if (q.isActive !== undefined) builder.addBoolFilter('isActive', q.isActive);

  // ─── Existence Filters ───
  if (q.hasGST !== undefined) builder.addExistenceFilter('hasGST', q.hasGST, 'gstin');

  // ─── Dues Filter (special — needs custom logic) ───
  if (q.hasDues === 'true') {
    builder.setFilter({ currentDues: { $gt: 0 } });
  } else if (q.hasDues === 'false') {
    builder.setFilter({ currentDues: { $lte: 0 } });
  }

  // ─── Range Filters ───
  builder
    .addRangeFilter('creditLimit',
      q.minCredit !== undefined ? parseFloat(q.minCredit) : undefined,
      q.maxCredit !== undefined ? parseFloat(q.maxCredit) : undefined
    )
    .addRangeFilter('purchaseInsights.lifetimeValue',
      q.minLifetime !== undefined ? parseFloat(q.minLifetime) : undefined,
      q.maxLifetime !== undefined ? parseFloat(q.maxLifetime) : undefined
    )
    .addRangeFilter('createdAt',
      q.createdAfter ? new Date(q.createdAfter) : undefined,
      q.createdBefore ? new Date(q.createdBefore) : undefined
    );

  // ─── Sort, Pagination, Fields, Populate ───
  builder
    .setSort(q.sort || '-createdAt')
    .setPagination(q.page, q.limit)
    .setFields(q.fields)
    .populate('businessSegment', 'code label iconName')
    .populate('createdBy', 'name email');

  const result = await builder.execute();

  res.json({
    status: 'success',
    ...result,
  });
});

/**
 * GET /api/customers/analytics/by-segment
 * Customer count + revenue grouped by business segment
 * Access: ADMIN, SUPER_ADMIN
 */
exports.analyticsBySegment = asyncHandler(async (req, res) => {
  const result = await Customer.aggregate([
    { $match: { isDeleted: false } },
    {
      $group: {
        _id: '$businessSegment',
        customerCount: { $sum: 1 },
        totalLifetimeValue: { $sum: '$purchaseInsights.lifetimeValue' },
        totalRevenue: { $sum: '$purchaseInsights.totalRevenue' },
        avgLifetimeValue: { $avg: '$purchaseInsights.lifetimeValue' },
        totalDues: { $sum: '$currentDues' },
      },
    },
    {
      $lookup: {
        from: 'businesssegments',
        localField: '_id',
        foreignField: '_id',
        as: 'segment',
      },
    },
    {
      $unwind: { path: '$segment', preserveNullAndEmptyArrays: true },
    },
    {
      $project: {
        _id: 0,
        segmentId: '$_id',
        code: '$segment.code',
        label: { $ifNull: ['$segment.label', 'Uncategorized'] },
        iconName: '$segment.iconName',
        customerCount: 1,
        totalLifetimeValue: { $round: ['$totalLifetimeValue', 2] },
        totalRevenue: { $round: ['$totalRevenue', 2] },
        avgLifetimeValue: { $round: ['$avgLifetimeValue', 2] },
        totalDues: { $round: ['$totalDues', 2] },
      },
    },
    { $sort: { totalLifetimeValue: -1 } },
  ]);

  res.json({
    status: 'success',
    count: result.length,
    data: result,
  });
});

/**
 * GET /api/customers/analytics/by-source
 * Acquisition channel effectiveness
 * Access: ADMIN, SUPER_ADMIN
 */
exports.analyticsBySource = asyncHandler(async (req, res) => {
  const result = await Customer.aggregate([
    { $match: { isDeleted: false } },
    {
      $group: {
        _id: '$acquisitionSource',
        customerCount: { $sum: 1 },
        totalRevenue: { $sum: '$purchaseInsights.totalRevenue' },
        avgLifetimeValue: { $avg: '$purchaseInsights.lifetimeValue' },
      },
    },
    {
      $project: {
        _id: 0,
        source: '$_id',
        customerCount: 1,
        totalRevenue: { $round: ['$totalRevenue', 2] },
        avgLifetimeValue: { $round: ['$avgLifetimeValue', 2] },
      },
    },
    { $sort: { totalRevenue: -1 } },
  ]);

  res.json({
    status: 'success',
    count: result.length,
    data: result,
  });
});

/**
 * GET /api/customers/analytics/top-customers?limit=10
 * Top customers by lifetime value
 * Access: ADMIN, SUPER_ADMIN
 */
exports.analyticsTopCustomers = asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 10, 50);

  const result = await Customer.find({ isDeleted: false })
    .sort({ 'purchaseInsights.lifetimeValue': -1 })
    .limit(limit)
    .select('customerName companyName phone businessSegment purchaseInsights creditLimit currentDues tags')
    .populate('businessSegment', 'code label')
    .lean();

  res.json({
    status: 'success',
    count: result.length,
    data: result,
  });
});

/**
 * GET /api/customers/analytics/summary
 * Overall business metrics
 * Access: ADMIN, SUPER_ADMIN
 */
exports.analyticsSummary = asyncHandler(async (req, res) => {
  const [
    total,
    active,
    deleted,
    withDues,
    totalDuesAgg,
    totalLifetimeAgg,
    newThisMonth,
    recentlyAdded,
  ] = await Promise.all([
    Customer.countDocuments({ isDeleted: false }),
    Customer.countDocuments({ isDeleted: false, isActive: true }),
    Customer.countDocuments({ isDeleted: true }),
    Customer.countDocuments({ isDeleted: false, currentDues: { $gt: 0 } }),
    Customer.aggregate([
      { $match: { isDeleted: false } },
      { $group: { _id: null, total: { $sum: '$currentDues' } } },
    ]),
    Customer.aggregate([
      { $match: { isDeleted: false } },
      { $group: { _id: null, total: { $sum: '$purchaseInsights.lifetimeValue' } } },
    ]),
    Customer.countDocuments({
      isDeleted: false,
      createdAt: { $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
    }),
    Customer.find({ isDeleted: false })
      .sort({ createdAt: -1 })
      .limit(5)
      .select('customerName phone createdAt')
      .lean(),
  ]);

  res.json({
    status: 'success',
    data: {
      counts: {
        total,
        active,
        inactive: total - active,
        deleted,
        withOutstandingDues: withDues,
        newThisMonth,
      },
      financial: {
        totalOutstandingDues: totalDuesAgg[0]?.total || 0,
        totalLifetimeValue: totalLifetimeAgg[0]?.total || 0,
      },
      recentlyAdded,
    },
  });
});

/**
 * GET /api/customers/:id
 * Get single customer with full populated data
 * Access: Any authenticated user
 */
exports.getById = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw ApiError.badRequest('Invalid customer ID');
  }

  const customer = await Customer.findById(req.params.id)
    .populate('businessSegment', 'code label iconName description')
    .populate('referredBy', 'customerName phone companyName')
    .populate('createdBy', 'name email')
    .populate('updatedBy', 'name email');

  if (!customer) {
    throw ApiError.notFound('Customer not found');
  }

  // Non-admins shouldn't see deleted customers
  if (customer.isDeleted && !['ADMIN', 'SUPER_ADMIN'].includes(req.user.role)) {
    throw ApiError.notFound('Customer not found');  // 404 to hide existence
  }

  res.json({ status: 'success', data: customer });
});

/**
 * PUT /api/customers/:id
 * Update customer
 * Access: ADMIN, BILLING
 */
exports.update = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw ApiError.badRequest('Invalid customer ID');
  }

  const customer = await Customer.findById(req.params.id);
  if (!customer || customer.isDeleted) {
    throw ApiError.notFound('Customer not found');
  }

  // Verify businessSegment if changing
  if (req.body.businessSegment) {
    const segmentExists = await BusinessSegment.exists({
      _id: req.body.businessSegment,
      isActive: true,
    });
    if (!segmentExists) {
      throw ApiError.badRequest('Invalid or inactive business segment');
    }
  }

  // Verify referredBy if changing
  if (req.body.referredBy) {
    if (req.body.referredBy === req.params.id) {
      throw ApiError.badRequest('Customer cannot refer themselves');
    }
    const referrerExists = await Customer.exists({
      _id: req.body.referredBy,
      isDeleted: false,
    });
    if (!referrerExists) {
      throw ApiError.badRequest('Referring customer not found');
    }
  }

  // Apply updates — be selective about what can be changed via API
  // Don't allow changing: _id, createdBy, createdAt, purchaseInsights (auto-managed)
  const protectedFields = ['_id', 'createdBy', 'createdAt', 'purchaseInsights', 'isDeleted', 'deletedAt', 'deletedBy', 'deletionReason'];
  protectedFields.forEach((field) => delete req.body[field]);

  Object.assign(customer, req.body);
  customer.updatedBy = req.user._id;

  await customer.save();

  // Populate for response
  await customer.populate('businessSegment', 'code label iconName');
  if (customer.referredBy) {
    await customer.populate('referredBy', 'customerName phone companyName');
  }

  logger.info(`Customer updated: ${customer.customerName} (${customer.phone}) by ${req.user.email}`);

  res.json({ status: 'success', data: customer });
});

/**
 * DELETE /api/customers/:id
 * Soft delete
 * Access: ADMIN, SUPER_ADMIN
 * Body: { reason: "..." }
 */
exports.softDelete = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw ApiError.badRequest('Invalid customer ID');
  }

  const customer = await Customer.findById(req.params.id);
  if (!customer) {
    throw ApiError.notFound('Customer not found');
  }

  if (customer.isDeleted) {
    throw ApiError.badRequest('Customer is already deleted');
  }

  // Block deletion if customer has dues
  if (customer.currentDues > 0) {
    throw ApiError.conflict(
      `Cannot delete: Customer has outstanding dues of ₹${customer.currentDues}. Settle dues first.`
    );
  }

  const reason = req.body?.reason || 'No reason provided';
  await customer.softDelete(req.user._id, reason);

  logger.info(`Customer soft-deleted: ${customer.customerName} (${customer.phone}) by ${req.user.email}. Reason: ${reason}`);

  res.json({
    status: 'success',
    message: 'Customer soft-deleted',
    data: { id: customer._id, deletedAt: customer.deletedAt },
  });
});

/**
 * POST /api/customers/:id/restore
 * Restore soft-deleted customer
 * Access: SUPER_ADMIN only
 */
exports.restore = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw ApiError.badRequest('Invalid customer ID');
  }

  const customer = await Customer.findById(req.params.id);
  if (!customer) {
    throw ApiError.notFound('Customer not found');
  }

  if (!customer.isDeleted) {
    throw ApiError.badRequest('Customer is not deleted');
  }

  await customer.restore();
  customer.updatedBy = req.user._id;
  await customer.save();

  logger.info(`Customer restored: ${customer.customerName} (${customer.phone}) by ${req.user.email}`);

  res.json({
    status: 'success',
    message: 'Customer restored',
    data: { id: customer._id },
  });
});

/**
 * DELETE /api/customers/:id/hard-delete
 * Permanently delete (irreversible!)
 * Access: SUPER_ADMIN only
 */
exports.hardDelete = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw ApiError.badRequest('Invalid customer ID');
  }

  const customer = await Customer.findById(req.params.id);
  if (!customer) {
    throw ApiError.notFound('Customer not found');
  }

  // Must be soft-deleted first (extra safety)
  if (!customer.isDeleted) {
    throw ApiError.badRequest(
      'Customer must be soft-deleted first before hard delete. Use DELETE /api/customers/:id first.'
    );
  }

  const customerInfo = {
    id: customer._id,
    name: customer.customerName,
    phone: customer.phone,
  };

  await customer.deleteOne();

  logger.warn(`Customer HARD-DELETED: ${customerInfo.name} (${customerInfo.phone}) by ${req.user.email} — IRREVERSIBLE`);

  res.json({
    status: 'success',
    message: 'Customer permanently deleted',
    data: customerInfo,
  });
});

/**
 * GET /api/customers/:id/insights
 * Get purchase insights for a customer
 * (Auto-computed insights are returned as-is — recomputation comes when we have Order module in Prompt 4)
 */
exports.getInsights = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw ApiError.badRequest('Invalid customer ID');
  }

  const customer = await Customer.findById(req.params.id)
    .select('customerName phone purchaseInsights creditLimit currentDues')
    .populate('purchaseInsights.mostBoughtProduct', 'name sku');

  if (!customer) {
    throw ApiError.notFound('Customer not found');
  }

  res.json({
    status: 'success',
    data: {
      customer: {
        id: customer._id,
        name: customer.customerName,
        phone: customer.phone,
      },
      insights: customer.purchaseInsights || {},
      financial: {
        creditLimit: customer.creditLimit,
        currentDues: customer.currentDues,
        availableCredit: Math.max(0, customer.creditLimit - customer.currentDues),
      },
    },
  });
});

// ════════════════════════════════════════════════════════════════
// BULK OPERATIONS
// ════════════════════════════════════════════════════════════════

/**
 * POST /api/customers/bulk-update
 * Update multiple customers at once
 * Access: ADMIN, SUPER_ADMIN
 */
exports.bulkUpdate = asyncHandler(async (req, res) => {
  const { customerIds, updates } = req.body;

  const existing = await Customer.find({
    _id: { $in: customerIds },
    isDeleted: false,
  }).select('_id');

  const existingIds = existing.map(c => c._id.toString());
  const missingIds = customerIds.filter(id => !existingIds.includes(id));

  if (missingIds.length > 0) {
    throw ApiError.badRequest(
      `${missingIds.length} customer(s) not found or deleted`,
      { missingIds }
    );
  }

  if (updates.businessSegment) {
    const segmentExists = await BusinessSegment.exists({
      _id: updates.businessSegment,
      isActive: true,
    });
    if (!segmentExists) {
      throw ApiError.badRequest('Invalid or inactive business segment');
    }
  }

  const mongoUpdate = {};
  const tagOps = updates.tags;

  ['isActive', 'businessSegment', 'businessSize', 'creditLimit',
   'specialDiscountPct', 'preferredUnit', 'notes'].forEach(key => {
    if (updates[key] !== undefined) {
      mongoUpdate[key] = updates[key];
    }
  });

  mongoUpdate.updatedBy = req.user._id;

  let modifiedCount = 0;

  if (Object.keys(mongoUpdate).length > 1) {
    const result = await Customer.updateMany(
      { _id: { $in: customerIds } },
      { $set: mongoUpdate }
    );
    modifiedCount = result.modifiedCount;
  }

  if (tagOps) {
    if (tagOps.set !== undefined) {
      await Customer.updateMany(
        { _id: { $in: customerIds } },
        { $set: { tags: tagOps.set, updatedBy: req.user._id } }
      );
    } else {
      if (tagOps.add && tagOps.add.length > 0) {
        await Customer.updateMany(
          { _id: { $in: customerIds } },
          { $addToSet: { tags: { $each: tagOps.add } }, $set: { updatedBy: req.user._id } }
        );
      }
      if (tagOps.remove && tagOps.remove.length > 0) {
        await Customer.updateMany(
          { _id: { $in: customerIds } },
          { $pull: { tags: { $in: tagOps.remove } }, $set: { updatedBy: req.user._id } }
        );
      }
    }
  }

  logger.info(`Bulk update: ${customerIds.length} customers by ${req.user.email}`);

  res.json({
    status: 'success',
    message: `Bulk update completed`,
    data: {
      requested: customerIds.length,
      processed: existingIds.length,
      modified: modifiedCount,
    },
  });
});

/**
 * POST /api/customers/bulk-delete (soft)
 * Access: ADMIN, SUPER_ADMIN
 */
exports.bulkSoftDelete = asyncHandler(async (req, res) => {
  const { customerIds, reason } = req.body;

  const withDues = await Customer.find({
    _id: { $in: customerIds },
    isDeleted: false,
    currentDues: { $gt: 0 },
  }).select('_id customerName phone currentDues');

  if (withDues.length > 0) {
    throw ApiError.conflict(
      `${withDues.length} customer(s) have outstanding dues. Cannot bulk-delete.`,
      { customersWithDues: withDues }
    );
  }

  const result = await Customer.updateMany(
    { _id: { $in: customerIds }, isDeleted: false },
    {
      $set: {
        isDeleted: true,
        deletedAt: new Date(),
        deletedBy: req.user._id,
        deletionReason: reason,
        isActive: false,
        updatedBy: req.user._id,
      },
    }
  );

  logger.info(`Bulk soft-delete: ${result.modifiedCount} customers by ${req.user.email}. Reason: ${reason}`);

  res.json({
    status: 'success',
    message: 'Bulk soft-delete completed',
    data: {
      requested: customerIds.length,
      deleted: result.modifiedCount,
      skipped: customerIds.length - result.modifiedCount,
    },
  });
});

/**
 * POST /api/customers/bulk-restore
 * Access: SUPER_ADMIN only
 */
exports.bulkRestore = asyncHandler(async (req, res) => {
  const { customerIds } = req.body;

  const result = await Customer.updateMany(
    { _id: { $in: customerIds }, isDeleted: true },
    {
      $set: {
        isDeleted: false,
        deletedAt: null,
        deletedBy: null,
        deletionReason: null,
        isActive: true,
        updatedBy: req.user._id,
      },
    }
  );

  logger.info(`Bulk restore: ${result.modifiedCount} customers by ${req.user.email}`);

  res.json({
    status: 'success',
    message: 'Bulk restore completed',
    data: {
      requested: customerIds.length,
      restored: result.modifiedCount,
    },
  });
});

/**
 * POST /api/customers/bulk-add-tag
 * Access: ADMIN, SUPER_ADMIN, BILLING
 */
exports.bulkAddTag = asyncHandler(async (req, res) => {
  const { customerIds, tag } = req.body;

  const result = await Customer.updateMany(
    { _id: { $in: customerIds }, isDeleted: false },
    {
      $addToSet: { tags: tag },
      $set: { updatedBy: req.user._id },
    }
  );

  logger.info(`Bulk add tag '${tag}': ${result.modifiedCount} customers by ${req.user.email}`);

  res.json({
    status: 'success',
    message: `Tag '${tag}' added`,
    data: {
      requested: customerIds.length,
      modified: result.modifiedCount,
    },
  });
});

/**
 * POST /api/customers/bulk-remove-tag
 * Access: ADMIN, SUPER_ADMIN, BILLING
 */
exports.bulkRemoveTag = asyncHandler(async (req, res) => {
  const { customerIds, tag } = req.body;

  const result = await Customer.updateMany(
    { _id: { $in: customerIds }, isDeleted: false },
    {
      $pull: { tags: tag },
      $set: { updatedBy: req.user._id },
    }
  );

  logger.info(`Bulk remove tag '${tag}': ${result.modifiedCount} customers by ${req.user.email}`);

  res.json({
    status: 'success',
    message: `Tag '${tag}' removed`,
    data: {
      requested: customerIds.length,
      modified: result.modifiedCount,
    },
  });
});

// ════════════════════════════════════════════════════════════════
// EXPORT
// ════════════════════════════════════════════════════════════════

/**
 * Helper: build a QueryBuilder applying the same filter set as list().
 * Used by both CSV and Excel export.
 */
const buildExportQuery = async (q) => {
  const builder = new QueryBuilder(Customer, q);

  if (q.includeDeleted !== 'true') {
    builder.setFilter({ isDeleted: false });
  }

  if (q.search) {
    builder.addTextSearch(q.search, ['customerName', 'companyName', 'phone', 'email']);
  }

  builder
    .addObjectIdFilter('businessSegment', q.segment)
    .addFilter('businessSize', q.size)
    .addFilter('acquisitionSource', q.source)
    .addFilter('billingAddress.city', q.city)
    .addFilter('billingAddress.state', q.state);

  if (q.segmentCode) {
    const segment = await BusinessSegment.findByCode(q.segmentCode);
    if (segment) builder.addObjectIdFilter('businessSegment', segment._id.toString());
  }

  if (q.tags) builder.addArrayFilter('tags', q.tags, 'all');
  if (q.isActive !== undefined) builder.addBoolFilter('isActive', q.isActive);
  if (q.hasGST !== undefined) builder.addExistenceFilter('hasGST', q.hasGST, 'gstin');

  builder
    .setSort(q.sort || '-createdAt')
    .setPagination(1, 10000)
    .populate('businessSegment', 'code label');

  return builder;
};

/**
 * GET /api/customers/export/csv
 * Access: ADMIN, SUPER_ADMIN
 */
exports.exportCSV = asyncHandler(async (req, res) => {
  const builder = await buildExportQuery(req.query);
  const result = await builder.execute();

  const csv = exporters.customersToCSV(result.data);
  const filename = `customers-${new Date().toISOString().split('T')[0]}.csv`;

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('﻿' + csv);  // BOM for Excel UTF-8 support

  logger.info(`CSV export: ${result.data.length} customers by ${req.user.email}`);
});

/**
 * GET /api/customers/export/excel
 * Access: ADMIN, SUPER_ADMIN
 */
exports.exportExcel = asyncHandler(async (req, res) => {
  const q = req.query;
  const builder = await buildExportQuery(q);
  const result = await builder.execute();

  const analytics = {};

  if (q.includeAnalytics !== 'false') {
    const segmentStats = await Customer.aggregate([
      { $match: { isDeleted: false } },
      {
        $group: {
          _id: '$businessSegment',
          customerCount: { $sum: 1 },
          totalLifetimeValue: { $sum: '$purchaseInsights.lifetimeValue' },
          avgLifetimeValue: { $avg: '$purchaseInsights.lifetimeValue' },
          totalDues: { $sum: '$currentDues' },
        },
      },
      { $lookup: { from: 'businesssegments', localField: '_id', foreignField: '_id', as: 'segment' } },
      { $unwind: { path: '$segment', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          label: { $ifNull: ['$segment.label', 'Uncategorized'] },
          customerCount: 1,
          totalLifetimeValue: { $round: ['$totalLifetimeValue', 2] },
          avgLifetimeValue: { $round: ['$avgLifetimeValue', 2] },
          totalDues: { $round: ['$totalDues', 2] },
        },
      },
      { $sort: { totalLifetimeValue: -1 } },
    ]);

    const topCustomers = await Customer.find({ isDeleted: false })
      .sort({ 'purchaseInsights.lifetimeValue': -1 })
      .limit(20)
      .populate('businessSegment', 'label')
      .lean();

    const [total, active, deleted, withDues, totalDuesAgg, totalLifetimeAgg, newThisMonth] = await Promise.all([
      Customer.countDocuments({ isDeleted: false }),
      Customer.countDocuments({ isDeleted: false, isActive: true }),
      Customer.countDocuments({ isDeleted: true }),
      Customer.countDocuments({ isDeleted: false, currentDues: { $gt: 0 } }),
      Customer.aggregate([
        { $match: { isDeleted: false } },
        { $group: { _id: null, total: { $sum: '$currentDues' } } },
      ]),
      Customer.aggregate([
        { $match: { isDeleted: false } },
        { $group: { _id: null, total: { $sum: '$purchaseInsights.lifetimeValue' } } },
      ]),
      Customer.countDocuments({
        isDeleted: false,
        createdAt: { $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
      }),
    ]);

    analytics.segmentStats = segmentStats;
    analytics.topCustomers = topCustomers;
    analytics.summary = {
      counts: { total, active, inactive: total - active, deleted, withOutstandingDues: withDues, newThisMonth },
      financial: {
        totalOutstandingDues: totalDuesAgg[0]?.total || 0,
        totalLifetimeValue: totalLifetimeAgg[0]?.total || 0,
      },
    };
  }

  const buffer = await exporters.customersToExcel(result.data, analytics);
  const filename = `customers-report-${new Date().toISOString().split('T')[0]}.xlsx`;

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);

  logger.info(`Excel export: ${result.data.length} customers by ${req.user.email}`);
});
