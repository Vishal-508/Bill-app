const { StockMovement } = require('../models');
const asyncHandler = require('../utils/asyncHandler');
const QueryBuilder = require('../utils/queryBuilder');

/**
 * GET /api/stock-movements
 */
exports.list = asyncHandler(async (req, res) => {
  const q = req.query;
  const builder = new QueryBuilder(StockMovement, q);

  builder
    .addObjectIdFilter('product', q.product)
    .addObjectIdFilter('relatedOrder', q.relatedOrder)
    .addFilter('movementType', q.movementType);

  if (q.fromDate || q.toDate) {
    builder.addRangeFilter('performedAt',
      q.fromDate ? new Date(q.fromDate) : undefined,
      q.toDate ? new Date(q.toDate) : undefined
    );
  }

  builder
    .setSort(q.sort || '-performedAt')
    .setPagination(q.page, q.limit)
    .populate('product', 'sku name')
    .populate('relatedOrder', 'orderNumber')
    .populate('performedBy', 'name email');

  const result = await builder.execute();
  res.json({ status: 'success', ...result });
});

/**
 * GET /api/stock-movements/by-product/:productId
 */
exports.byProduct = asyncHandler(async (req, res) => {
  const movements = await StockMovement.find({ product: req.params.productId })
    .sort({ performedAt: -1 })
    .limit(50)
    .populate('relatedOrder', 'orderNumber')
    .populate('performedBy', 'name email')
    .lean();

  res.json({ status: 'success', count: movements.length, data: movements });
});
