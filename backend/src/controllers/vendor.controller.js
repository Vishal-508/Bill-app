const mongoose = require('mongoose');
const { Vendor, Purchase } = require('../models');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');

/**
 * Vendor CRUD (Prompt 8 Section E).
 *
 * Standard pattern: soft delete with restore. GSTIN immutable once set
 * (audit-trail integrity — vendor identity should be stable across POs).
 */

const ACTIVE_PO_STATUSES = ['DRAFT', 'ORDERED', 'PARTIAL_RECEIVED'];

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── POST /api/vendors ───
exports.create = asyncHandler(async (req, res) => {
  const body = { ...req.body, createdBy: req.user._id };
  // If client sent a duplicate GSTIN, catch unique-index error gracefully
  try {
    const vendor = await Vendor.create(body);
    res.status(201).json({ status: 'success', data: vendor });
  } catch (err) {
    if (err.code === 11000) {
      throw ApiError.conflict('A vendor with this GSTIN already exists');
    }
    throw err;
  }
});

// ─── GET /api/vendors ───
exports.list = asyncHandler(async (req, res) => {
  const q = req.query;
  const page = parseInt(q.page) || 1;
  const limit = Math.min(parseInt(q.limit) || 20, 200);
  const skip = (page - 1) * limit;

  const filter = {};
  if (q.includeDeleted !== 'true') filter.isDeleted = false;
  if (q.isActive === 'true') filter.isActive = true;
  else if (q.isActive === 'false') filter.isActive = false;
  if (q.city) filter['address.city'] = q.city;
  if (q.state) filter['address.state'] = q.state;
  if (q.hasGstin === 'true') filter.gstin = { $exists: true, $ne: '' };
  else if (q.hasGstin === 'false') filter.$or = [
    { gstin: { $exists: false } },
    { gstin: '' },
    { gstin: null },
  ];

  if (q.search) {
    const safe = escapeRegex(q.search);
    const searchOr = [
      { name: { $regex: safe, $options: 'i' } },
      { companyName: { $regex: safe, $options: 'i' } },
      { phone: { $regex: safe, $options: 'i' } },
    ];
    // If we already added an $or for hasGstin=false, AND-combine with $and
    if (filter.$or) {
      const prevOr = filter.$or;
      delete filter.$or;
      filter.$and = [{ $or: prevOr }, { $or: searchOr }];
    } else {
      filter.$or = searchOr;
    }
  }

  const sortField = q.sortBy === 'name' ? 'name' : 'createdAt';
  const sortDir = q.sortOrder === 'asc' ? 1 : -1;

  const [data, total] = await Promise.all([
    Vendor.find(filter)
      .sort({ [sortField]: sortDir })
      .skip(skip).limit(limit)
      .lean(),
    Vendor.countDocuments(filter),
  ]);

  res.json({
    status: 'success',
    data,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  });
});

// ─── GET /api/vendors/:id ───
exports.getOne = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw ApiError.badRequest('Invalid vendor ID');
  }
  const vendor = await Vendor.findById(req.params.id)
    .populate('products', 'sku name productType')
    .lean();
  if (!vendor) throw ApiError.notFound('Vendor not found');
  if (vendor.isDeleted) {
    return res.status(410).json({
      status: 'error',
      message: 'Vendor was deleted',
      hint: `POST /api/vendors/${vendor._id}/restore to undelete`,
      data: { id: vendor._id, deletedAt: vendor.deletedAt },
    });
  }

  // Stats
  const [stats] = await Purchase.aggregate([
    { $match: { vendor: new mongoose.Types.ObjectId(vendor._id) } },
    {
      $group: {
        _id: null,
        totalPurchases: { $sum: 1 },
        totalSpent: { $sum: '$grandTotal' },
        lastPurchaseAt: { $max: '$createdAt' },
        activePurchasesCount: {
          $sum: { $cond: [{ $in: ['$status', ACTIVE_PO_STATUSES] }, 1, 0] },
        },
      },
    },
  ]);

  res.json({
    status: 'success',
    data: {
      ...vendor,
      stats: stats || {
        totalPurchases: 0,
        totalSpent: 0,
        lastPurchaseAt: null,
        activePurchasesCount: 0,
      },
    },
  });
});

// ─── PATCH /api/vendors/:id ───
exports.update = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw ApiError.badRequest('Invalid vendor ID');
  }
  const vendor = await Vendor.findById(req.params.id);
  if (!vendor || vendor.isDeleted) throw ApiError.notFound('Vendor not found');

  // GSTIN immutability — block change once set, allow setting if previously empty
  if (req.body.gstin !== undefined && req.body.gstin !== '') {
    if (vendor.gstin && vendor.gstin !== req.body.gstin) {
      throw ApiError.badRequest(
        'GSTIN is immutable once set — contact admin to delete + re-create vendor if needed'
      );
    }
  }

  Object.assign(vendor, req.body);
  vendor.updatedBy = req.user._id;
  try {
    await vendor.save();
  } catch (err) {
    if (err.code === 11000) throw ApiError.conflict('GSTIN conflict — another vendor uses this GSTIN');
    throw err;
  }
  res.json({ status: 'success', data: vendor });
});

// ─── DELETE /api/vendors/:id (soft delete) ───
exports.softDelete = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw ApiError.badRequest('Invalid vendor ID');
  }
  const vendor = await Vendor.findById(req.params.id);
  if (!vendor) throw ApiError.notFound('Vendor not found');
  if (vendor.isDeleted) throw ApiError.badRequest('Vendor already deleted');

  // Block if active purchases exist
  const activeCount = await Purchase.countDocuments({
    vendor: vendor._id,
    status: { $in: ACTIVE_PO_STATUSES },
  });
  if (activeCount > 0) {
    throw ApiError.conflict(
      `Vendor has ${activeCount} active purchase order(s) (DRAFT/ORDERED/PARTIAL_RECEIVED). ` +
      'Complete or cancel them before deleting the vendor.'
    );
  }

  await vendor.softDelete(req.user._id);
  res.json({ status: 'success', data: vendor });
});

// ─── POST /api/vendors/:id/restore ───
exports.restore = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw ApiError.badRequest('Invalid vendor ID');
  }
  const vendor = await Vendor.findById(req.params.id);
  if (!vendor) throw ApiError.notFound('Vendor not found');
  if (!vendor.isDeleted) throw ApiError.badRequest('Vendor is not deleted');

  await vendor.restore();
  res.json({ status: 'success', data: vendor });
});
