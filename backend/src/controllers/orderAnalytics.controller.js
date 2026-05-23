const mongoose = require('mongoose');
const { Order, Customer, Product } = require('../models');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');

// ─────────────────────────────────────────────
// REVENUE ANALYTICS
// ─────────────────────────────────────────────

/**
 * GET /api/orders/analytics/revenue
 * Revenue by period (today/week/month/year/custom)
 */
exports.revenueByPeriod = asyncHandler(async (req, res) => {
  const { period = 'month', fromDate, toDate } = req.query;

  let startDate, endDate = new Date();

  switch (period) {
    case 'today':
      startDate = new Date();
      startDate.setHours(0, 0, 0, 0);
      break;
    case 'week':
      startDate = new Date();
      startDate.setDate(startDate.getDate() - 7);
      break;
    case 'month':
      startDate = new Date();
      startDate.setMonth(startDate.getMonth() - 1);
      break;
    case 'year':
      startDate = new Date();
      startDate.setFullYear(startDate.getFullYear() - 1);
      break;
    case 'custom':
      if (!fromDate || !toDate) {
        throw ApiError.badRequest('Custom period requires fromDate and toDate');
      }
      startDate = new Date(fromDate);
      endDate = new Date(toDate);
      break;
    default:
      throw ApiError.badRequest('Invalid period');
  }

  const result = await Order.aggregate([
    {
      $match: {
        isDeleted: false,
        status: { $nin: ['CANCELLED'] },
        orderDate: { $gte: startDate, $lte: endDate },
      },
    },
    {
      $group: {
        _id: null,
        totalOrders: { $sum: 1 },
        totalRevenue: { $sum: '$totalAmount' },
        totalGst: { $sum: '$totalGst' },
        totalCollected: { $sum: '$amountPaid' },
        totalOutstanding: { $sum: '$amountDue' },
        avgOrderValue: { $avg: '$totalAmount' },
        maxOrderValue: { $max: '$totalAmount' },
        minOrderValue: { $min: '$totalAmount' },
      },
    },
    {
      $project: {
        _id: 0,
        totalOrders: 1,
        totalRevenue: { $round: ['$totalRevenue', 2] },
        totalGst: { $round: ['$totalGst', 2] },
        totalCollected: { $round: ['$totalCollected', 2] },
        totalOutstanding: { $round: ['$totalOutstanding', 2] },
        avgOrderValue: { $round: ['$avgOrderValue', 2] },
        maxOrderValue: 1,
        minOrderValue: 1,
        collectionRatePct: {
          $cond: [
            { $gt: ['$totalRevenue', 0] },
            { $round: [{ $multiply: [{ $divide: ['$totalCollected', '$totalRevenue'] }, 100] }, 2] },
            0,
          ],
        },
      },
    },
  ]);

  res.json({
    status: 'success',
    data: {
      period,
      fromDate: startDate,
      toDate: endDate,
      ...(result[0] || {
        totalOrders: 0,
        totalRevenue: 0,
        totalGst: 0,
        totalCollected: 0,
        totalOutstanding: 0,
        avgOrderValue: 0,
        maxOrderValue: 0,
        minOrderValue: 0,
        collectionRatePct: 0,
      }),
    },
  });
});

/**
 * GET /api/orders/analytics/revenue-trend
 * Revenue trend over time (grouped by day/week/month)
 */
exports.revenueTrend = asyncHandler(async (req, res) => {
  const { groupBy = 'day', lastN = 30 } = req.query;
  const n = parseInt(lastN);

  const startDate = new Date();
  if (groupBy === 'day') startDate.setDate(startDate.getDate() - n);
  else if (groupBy === 'week') startDate.setDate(startDate.getDate() - (n * 7));
  else if (groupBy === 'month') startDate.setMonth(startDate.getMonth() - n);

  let dateFormat;
  if (groupBy === 'day') dateFormat = { format: '%Y-%m-%d', date: '$orderDate' };
  else if (groupBy === 'week') dateFormat = { format: '%Y-W%V', date: '$orderDate' };
  else dateFormat = { format: '%Y-%m', date: '$orderDate' };

  const trend = await Order.aggregate([
    {
      $match: {
        isDeleted: false,
        status: { $nin: ['CANCELLED'] },
        orderDate: { $gte: startDate },
      },
    },
    {
      $group: {
        _id: { $dateToString: dateFormat },
        orders: { $sum: 1 },
        revenue: { $sum: '$totalAmount' },
        collected: { $sum: '$amountPaid' },
      },
    },
    {
      $project: {
        period: '$_id',
        orders: 1,
        revenue: { $round: ['$revenue', 2] },
        collected: { $round: ['$collected', 2] },
        _id: 0,
      },
    },
    { $sort: { period: 1 } },
  ]);

  res.json({
    status: 'success',
    data: {
      groupBy,
      lastN: n,
      trend,
    },
  });
});

// ─────────────────────────────────────────────
// CUSTOMER ANALYTICS
// ─────────────────────────────────────────────

/**
 * GET /api/orders/analytics/top-customers
 */
exports.topCustomers = asyncHandler(async (req, res) => {
  const { limit = 10, period = 'all' } = req.query;

  const match = { isDeleted: false, status: { $nin: ['CANCELLED'] } };

  if (period !== 'all') {
    let startDate = new Date();
    if (period === 'month') startDate.setMonth(startDate.getMonth() - 1);
    else if (period === 'quarter') startDate.setMonth(startDate.getMonth() - 3);
    else if (period === 'year') startDate.setFullYear(startDate.getFullYear() - 1);
    match.orderDate = { $gte: startDate };
  }

  const result = await Order.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$customer',
        totalOrders: { $sum: 1 },
        totalRevenue: { $sum: '$totalAmount' },
        totalCollected: { $sum: '$amountPaid' },
        totalDues: { $sum: '$amountDue' },
        avgOrderValue: { $avg: '$totalAmount' },
        lastOrderDate: { $max: '$orderDate' },
      },
    },
    { $sort: { totalRevenue: -1 } },
    { $limit: parseInt(limit) },
    {
      $lookup: {
        from: 'customers',
        localField: '_id',
        foreignField: '_id',
        as: 'customer',
      },
    },
    { $unwind: '$customer' },
    {
      $project: {
        _id: 0,
        customerId: '$_id',
        customerName: '$customer.customerName',
        companyName: '$customer.companyName',
        phone: '$customer.phone',
        totalOrders: 1,
        totalRevenue: { $round: ['$totalRevenue', 2] },
        totalCollected: { $round: ['$totalCollected', 2] },
        totalDues: { $round: ['$totalDues', 2] },
        avgOrderValue: { $round: ['$avgOrderValue', 2] },
        lastOrderDate: 1,
      },
    },
  ]);

  res.json({ status: 'success', count: result.length, data: result });
});

/**
 * GET /api/orders/analytics/customer-patterns
 */
exports.customerPatterns = asyncHandler(async (req, res) => {
  const result = await Order.aggregate([
    {
      $match: {
        isDeleted: false,
        status: { $nin: ['CANCELLED'] },
      },
    },
    {
      $group: {
        _id: '$customer',
        orderCount: { $sum: 1 },
        totalRevenue: { $sum: '$totalAmount' },
        firstOrder: { $min: '$orderDate' },
        lastOrder: { $max: '$orderDate' },
      },
    },
    {
      $addFields: {
        daysSinceFirstOrder: {
          $divide: [{ $subtract: [new Date(), '$firstOrder'] }, 86400000],
        },
        daysSinceLastOrder: {
          $divide: [{ $subtract: [new Date(), '$lastOrder'] }, 86400000],
        },
      },
    },
    {
      $facet: {
        bySegment: [
          {
            $bucket: {
              groupBy: '$orderCount',
              boundaries: [1, 2, 5, 10, 50],
              default: 'VIP',
              output: {
                customers: { $sum: 1 },
                totalRevenue: { $sum: '$totalRevenue' },
                avgRevenue: { $avg: '$totalRevenue' },
              },
            },
          },
        ],
        activity: [
          {
            $group: {
              _id: {
                $cond: [
                  { $lte: ['$daysSinceLastOrder', 30] }, 'active',
                  {
                    $cond: [
                      { $lte: ['$daysSinceLastOrder', 90] }, 'recent',
                      'dormant',
                    ],
                  },
                ],
              },
              customers: { $sum: 1 },
              totalRevenue: { $sum: '$totalRevenue' },
            },
          },
        ],
      },
    },
  ]);

  res.json({ status: 'success', data: result[0] || { bySegment: [], activity: [] } });
});

// ─────────────────────────────────────────────
// PRODUCT ANALYTICS
// ─────────────────────────────────────────────

/**
 * GET /api/orders/analytics/top-products
 */
exports.topProducts = asyncHandler(async (req, res) => {
  const { limit = 10, period = 'all' } = req.query;

  const match = { isDeleted: false, status: { $nin: ['CANCELLED'] } };

  if (period !== 'all') {
    let startDate = new Date();
    if (period === 'month') startDate.setMonth(startDate.getMonth() - 1);
    else if (period === 'quarter') startDate.setMonth(startDate.getMonth() - 3);
    else if (period === 'year') startDate.setFullYear(startDate.getFullYear() - 1);
    match.orderDate = { $gte: startDate };
  }

  const result = await Order.aggregate([
    { $match: match },
    { $unwind: '$items' },
    {
      $group: {
        _id: '$items.product',
        productName: { $first: '$items.productSnapshot.name' },
        productSku: { $first: '$items.productSnapshot.sku' },
        productType: { $first: '$items.productSnapshot.productType' },
        totalQuantity: { $sum: '$items.quantity' },
        totalRevenue: { $sum: '$items.lineSubtotal' },
        orderCount: { $addToSet: '$_id' },
      },
    },
    {
      $project: {
        _id: 0,
        productId: '$_id',
        productName: 1,
        productSku: 1,
        productType: 1,
        totalQuantity: 1,
        totalRevenue: { $round: ['$totalRevenue', 2] },
        orderCount: { $size: '$orderCount' },
      },
    },
    { $sort: { totalRevenue: -1 } },
    { $limit: parseInt(limit) },
  ]);

  res.json({ status: 'success', count: result.length, data: result });
});

/**
 * GET /api/orders/analytics/sales-by-product-type
 */
exports.salesByProductType = asyncHandler(async (req, res) => {
  const result = await Order.aggregate([
    {
      $match: {
        isDeleted: false,
        status: { $nin: ['CANCELLED'] },
      },
    },
    { $unwind: '$items' },
    {
      $group: {
        _id: '$items.itemType',
        totalQuantity: { $sum: '$items.quantity' },
        totalRevenue: { $sum: '$items.lineSubtotal' },
        totalCutting: { $sum: '$items.cuttingCharges' },
        totalWastageSqFt: { $sum: '$items.wastageAreaSqFt' },
        orderCount: { $addToSet: '$_id' },
      },
    },
    {
      $project: {
        itemType: '$_id',
        totalQuantity: 1,
        totalRevenue: { $round: ['$totalRevenue', 2] },
        totalCuttingCharges: { $round: ['$totalCutting', 2] },
        totalWastageSqFt: { $round: ['$totalWastageSqFt', 2] },
        orderCount: { $size: '$orderCount' },
        _id: 0,
      },
    },
    { $sort: { totalRevenue: -1 } },
  ]);

  res.json({ status: 'success', data: result });
});

// ─────────────────────────────────────────────
// STATUS & PAYMENT ANALYTICS
// ─────────────────────────────────────────────

/**
 * GET /api/orders/analytics/status-distribution
 */
exports.statusDistribution = asyncHandler(async (req, res) => {
  const result = await Order.aggregate([
    { $match: { isDeleted: false } },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        totalAmount: { $sum: '$totalAmount' },
      },
    },
    {
      $project: {
        status: '$_id',
        count: 1,
        totalAmount: { $round: ['$totalAmount', 2] },
        _id: 0,
      },
    },
    { $sort: { count: -1 } },
  ]);

  const total = result.reduce((sum, r) => sum + r.count, 0);
  result.forEach(r => {
    r.pct = total > 0 ? +((r.count / total) * 100).toFixed(2) : 0;
  });

  res.json({ status: 'success', total, data: result });
});

/**
 * GET /api/orders/analytics/payment-mode-distribution
 */
exports.paymentModeDistribution = asyncHandler(async (req, res) => {
  const result = await Order.aggregate([
    { $match: { isDeleted: false } },
    { $unwind: '$payments' },
    { $match: { 'payments.amount': { $gt: 0 } } },
    {
      $group: {
        _id: '$payments.mode',
        count: { $sum: 1 },
        totalAmount: { $sum: '$payments.amount' },
      },
    },
    {
      $project: {
        mode: '$_id',
        count: 1,
        totalAmount: { $round: ['$totalAmount', 2] },
        _id: 0,
      },
    },
    { $sort: { totalAmount: -1 } },
  ]);

  const totalCount = result.reduce((sum, r) => sum + r.count, 0);
  const totalAmount = result.reduce((sum, r) => sum + r.totalAmount, 0);

  result.forEach(r => {
    r.countPct = totalCount > 0 ? +((r.count / totalCount) * 100).toFixed(2) : 0;
    r.amountPct = totalAmount > 0 ? +((r.totalAmount / totalAmount) * 100).toFixed(2) : 0;
  });

  res.json({
    status: 'success',
    summary: { totalPayments: totalCount, totalAmount: +totalAmount.toFixed(2) },
    data: result,
  });
});

/**
 * GET /api/orders/analytics/cancellation-rate
 */
exports.cancellationRate = asyncHandler(async (req, res) => {
  const { period = 'month' } = req.query;

  let startDate = new Date();
  if (period === 'month') startDate.setMonth(startDate.getMonth() - 1);
  else if (period === 'quarter') startDate.setMonth(startDate.getMonth() - 3);
  else if (period === 'year') startDate.setFullYear(startDate.getFullYear() - 1);

  const result = await Order.aggregate([
    {
      $match: {
        isDeleted: false,
        orderDate: { $gte: startDate },
      },
    },
    {
      $group: {
        _id: null,
        totalOrders: { $sum: 1 },
        cancelledCount: {
          $sum: { $cond: [{ $eq: ['$status', 'CANCELLED'] }, 1, 0] },
        },
        cancelledRevenue: {
          $sum: { $cond: [{ $eq: ['$status', 'CANCELLED'] }, '$totalAmount', 0] },
        },
        completedCount: {
          $sum: { $cond: [{ $in: ['$status', ['COMPLETED', 'DELIVERED']] }, 1, 0] },
        },
      },
    },
    {
      $project: {
        _id: 0,
        totalOrders: 1,
        cancelledCount: 1,
        cancelledRevenue: { $round: ['$cancelledRevenue', 2] },
        completedCount: 1,
        cancellationRatePct: {
          $cond: [
            { $gt: ['$totalOrders', 0] },
            { $round: [{ $multiply: [{ $divide: ['$cancelledCount', '$totalOrders'] }, 100] }, 2] },
            0,
          ],
        },
      },
    },
  ]);

  res.json({
    status: 'success',
    data: {
      period,
      fromDate: startDate,
      ...(result[0] || {
        totalOrders: 0,
        cancelledCount: 0,
        cancelledRevenue: 0,
        completedCount: 0,
        cancellationRatePct: 0,
      }),
    },
  });
});

// ─────────────────────────────────────────────
// DASHBOARD SUMMARY
// ─────────────────────────────────────────────

/**
 * GET /api/orders/analytics/dashboard
 */
exports.dashboardSummary = asyncHandler(async (req, res) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  const monthAgo = new Date();
  monthAgo.setMonth(monthAgo.getMonth() - 1);

  const [todayStats, weekStats, monthStats, statusBreakdown, outstandingTotal] = await Promise.all([
    Order.aggregate([
      {
        $match: {
          isDeleted: false,
          status: { $nin: ['CANCELLED'] },
          orderDate: { $gte: today },
        },
      },
      {
        $group: {
          _id: null,
          orders: { $sum: 1 },
          revenue: { $sum: '$totalAmount' },
        },
      },
    ]),
    Order.aggregate([
      {
        $match: {
          isDeleted: false,
          status: { $nin: ['CANCELLED'] },
          orderDate: { $gte: weekAgo },
        },
      },
      {
        $group: {
          _id: null,
          orders: { $sum: 1 },
          revenue: { $sum: '$totalAmount' },
        },
      },
    ]),
    Order.aggregate([
      {
        $match: {
          isDeleted: false,
          status: { $nin: ['CANCELLED'] },
          orderDate: { $gte: monthAgo },
        },
      },
      {
        $group: {
          _id: null,
          orders: { $sum: 1 },
          revenue: { $sum: '$totalAmount' },
        },
      },
    ]),
    Order.aggregate([
      { $match: { isDeleted: false } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
        },
      },
    ]),
    Order.aggregate([
      {
        $match: {
          isDeleted: false,
          status: { $nin: ['CANCELLED'] },
          amountDue: { $gt: 0 },
        },
      },
      {
        $group: {
          _id: null,
          totalOutstanding: { $sum: '$amountDue' },
          ordersWithDues: { $sum: 1 },
        },
      },
    ]),
  ]);

  res.json({
    status: 'success',
    data: {
      today: todayStats[0] || { orders: 0, revenue: 0 },
      thisWeek: weekStats[0] || { orders: 0, revenue: 0 },
      thisMonth: monthStats[0] || { orders: 0, revenue: 0 },
      statusBreakdown: statusBreakdown.reduce((acc, s) => {
        acc[s._id] = s.count;
        return acc;
      }, {}),
      outstanding: outstandingTotal[0] || { totalOutstanding: 0, ordersWithDues: 0 },
    },
  });
});
