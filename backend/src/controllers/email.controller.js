const mongoose = require('mongoose');
const { EmailLog } = require('../models');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const emailService = require('../utils/emailService');

/**
 * Shared helper: build a MongoDB filter from log-query params.
 */
function buildLogFilter(q) {
  const filter = {};
  if (q.type && q.type !== 'all') filter.type = q.type;
  if (q.status && q.status !== 'all') filter.status = q.status;
  if (q.customer) filter.customer = q.customer;
  if (q.relatedBill) filter.relatedBill = q.relatedBill;
  if (q.relatedOrder) filter.relatedOrder = q.relatedOrder;

  if (q.dateFrom || q.dateTo) {
    filter.createdAt = {};
    if (q.dateFrom) filter.createdAt.$gte = new Date(q.dateFrom);
    if (q.dateTo) filter.createdAt.$lte = new Date(q.dateTo);
  }

  if (q.search && q.search.length > 0) {
    const safe = q.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [
      { to: { $regex: safe, $options: 'i' } },
      { subject: { $regex: safe, $options: 'i' } },
    ];
  }
  return filter;
}

/**
 * GET /api/email/logs
 */
exports.listLogs = asyncHandler(async (req, res) => {
  const q = req.query;
  const page = parseInt(q.page) || 1;
  const limit = Math.min(parseInt(q.limit) || 20, 100);
  const skip = (page - 1) * limit;

  const filter = buildLogFilter(q);

  const [data, total] = await Promise.all([
    EmailLog.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('customer', 'customerName phone companyName email')
      .lean(),
    EmailLog.countDocuments(filter),
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

/**
 * GET /api/email/logs/stats
 * Registered BEFORE /logs/:id so 'stats' isn't matched as an ObjectId.
 */
exports.statsLogs = asyncHandler(async (req, res) => {
  const now = new Date();
  const dayAgo = new Date(now - 24 * 60 * 60 * 1000);
  const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);

  const [byType, byStatus, last24h, last7d, total] = await Promise.all([
    EmailLog.aggregate([{ $group: { _id: '$type', count: { $sum: 1 } } }]),
    EmailLog.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    EmailLog.countDocuments({ createdAt: { $gte: dayAgo } }),
    EmailLog.countDocuments({ createdAt: { $gte: weekAgo } }),
    EmailLog.countDocuments({}),
  ]);

  const toRecord = (arr) => arr.reduce((acc, r) => { acc[r._id || 'UNKNOWN'] = r.count; return acc; }, {});
  res.json({
    status: 'success',
    data: {
      byType: toRecord(byType),
      byStatus: toRecord(byStatus),
      last24h,
      last7d,
      total,
    },
  });
});

/**
 * GET /api/email/logs/:id
 */
exports.getLog = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw ApiError.badRequest('Invalid log ID');
  }
  const log = await EmailLog.findById(req.params.id)
    .populate('customer', 'customerName phone companyName email')
    .populate('relatedBill', 'billNumber grandTotal')
    .populate('relatedOrder', 'orderNumber status totalAmount')
    .lean();
  if (!log) throw ApiError.notFound('Log not found');
  res.json({ status: 'success', data: log });
});

/**
 * GET /api/email/health
 * Mock mode: returns { status: 'mock' }.
 * Live mode: nodemailer transport.verify().
 */
exports.health = asyncHandler(async (req, res) => {
  if (emailService.isMockMode()) {
    return res.json({
      status: 'mock',
      message: 'email service in mock mode (placeholder credentials)',
      host: process.env.EMAIL_HOST?.trim() || null,
    });
  }

  try {
    const result = await emailService.healthCheck();
    return res.json({ status: 'ok', ...result });
  } catch (err) {
    return res.status(503).json({
      status: 'error',
      host: process.env.EMAIL_HOST?.trim(),
      port: parseInt(process.env.EMAIL_PORT?.trim() || '587', 10),
      error: err.message,
    });
  }
});
