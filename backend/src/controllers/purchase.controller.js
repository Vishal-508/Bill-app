const mongoose = require('mongoose');
const { Purchase, Vendor, Product, StockMovement } = require('../models');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const logger = require('../config/logger');

/**
 * Purchase Order CRUD + lifecycle (Prompt 8 Section E).
 *
 * Lifecycle: DRAFT → ORDERED → (PARTIAL_RECEIVED →) RECEIVED, or → CANCELLED.
 *
 * On RECEIVE: creates StockMovement entries (type=RESTOCK using the existing
 * enum — DO NOT add new types) and bumps Product.currentStock. See
 * [[codebase_stock_model_conventions]] memory.
 */

const ACTIVE_STATUSES = ['DRAFT', 'ORDERED', 'PARTIAL_RECEIVED'];

function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── POST /api/purchases ───
exports.create = asyncHandler(async (req, res) => {
  const { vendorId, items, gstRatePct, expectedAt, notes } = req.body;

  const vendor = await Vendor.findById(vendorId);
  if (!vendor || vendor.isDeleted) throw ApiError.badRequest('Vendor not found');
  if (!vendor.isActive) throw ApiError.badRequest('Cannot create PO for inactive vendor');

  // Validate + snapshot products
  const productIds = items.map(it => it.productId);
  const products = await Product.find({
    _id: { $in: productIds },
    isDeleted: false,
  }).select('_id sku name productType thicknessMM lengthFT widthFT isActive').lean();

  if (products.length !== new Set(productIds.map(String)).size) {
    throw ApiError.badRequest('One or more products not found or deleted');
  }
  const inactive = products.find(p => !p.isActive);
  if (inactive) throw ApiError.badRequest(`Product ${inactive.sku} is inactive`);

  const productMap = new Map(products.map(p => [String(p._id), p]));

  const builtItems = items.map(it => {
    const p = productMap.get(String(it.productId));
    return {
      product: p._id,
      productSnapshot: {
        sku: p.sku,
        name: p.name,
        productType: p.productType,
        thicknessMM: p.thicknessMM,
        sizeDisplay: p.lengthFT && p.widthFT ? `${p.lengthFT}x${p.widthFT}` : undefined,
      },
      quantity: it.quantity,
      ratePerSheet: it.ratePerSheet,
      totalAmount: +(it.quantity * it.ratePerSheet).toFixed(2),
      notes: it.notes,
    };
  });

  const purchase = await Purchase.create({
    vendor: vendor._id,
    vendorSnapshot: {
      name: vendor.name,
      companyName: vendor.companyName,
      phone: vendor.phone,
      gstin: vendor.gstin,
    },
    items: builtItems,
    gstRatePct: gstRatePct != null ? gstRatePct : 18,
    expectedAt,
    notes,
    createdBy: req.user._id,
  });

  res.status(201).json({ status: 'success', data: purchase });
});

// ─── GET /api/purchases ───
exports.list = asyncHandler(async (req, res) => {
  const q = req.query;
  const page = parseInt(q.page) || 1;
  const limit = Math.min(parseInt(q.limit) || 20, 200);
  const skip = (page - 1) * limit;

  const filter = {};
  if (q.status) filter.status = q.status;
  if (q.vendorId) filter.vendor = q.vendorId;
  if (q.paymentStatus) filter.paymentStatus = q.paymentStatus;
  if (q.dateFrom || q.dateTo) {
    filter.createdAt = {};
    if (q.dateFrom) filter.createdAt.$gte = new Date(q.dateFrom);
    if (q.dateTo) filter.createdAt.$lte = new Date(q.dateTo);
  }
  if (q.search) {
    const safe = escapeRegex(q.search);
    filter.$or = [
      { purchaseNo: { $regex: safe, $options: 'i' } },
      { 'vendorSnapshot.name': { $regex: safe, $options: 'i' } },
      { invoiceNo: { $regex: safe, $options: 'i' } },
    ];
  }

  const sortField = q.sortBy || 'createdAt';
  const sortDir = q.sortOrder === 'asc' ? 1 : -1;

  const [data, total] = await Promise.all([
    Purchase.find(filter)
      .populate('vendor', 'name companyName phone')
      .sort({ [sortField]: sortDir })
      .skip(skip).limit(limit)
      .lean(),
    Purchase.countDocuments(filter),
  ]);

  res.json({
    status: 'success',
    data,
    pagination: {
      total, page, limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  });
});

// ─── GET /api/purchases/stats ───
// IMPORTANT: must be registered BEFORE /:id route
exports.stats = asyncHandler(async (req, res) => {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const [active, thisMonth, topVendor] = await Promise.all([
    Purchase.aggregate([
      { $match: { status: { $in: ACTIVE_STATUSES } } },
      {
        $group: {
          _id: null,
          activeCount: { $sum: 1 },
          pendingValue: { $sum: '$grandTotal' },
        },
      },
    ]),
    Purchase.aggregate([
      { $match: { createdAt: { $gte: monthStart } } },
      { $group: { _id: null, count: { $sum: 1 }, value: { $sum: '$grandTotal' } } },
    ]),
    Purchase.aggregate([
      { $match: { status: { $ne: 'CANCELLED' } } },
      {
        $group: {
          _id: '$vendor',
          vendorName: { $first: '$vendorSnapshot.name' },
          totalValue: { $sum: '$grandTotal' },
          poCount: { $sum: 1 },
        },
      },
      { $sort: { totalValue: -1 } },
      { $limit: 1 },
    ]),
  ]);

  res.json({
    status: 'success',
    data: {
      activeCount: active[0]?.activeCount || 0,
      pendingValue: +(active[0]?.pendingValue || 0).toFixed(2),
      thisMonth: {
        count: thisMonth[0]?.count || 0,
        value: +(thisMonth[0]?.value || 0).toFixed(2),
      },
      topVendor: topVendor[0]
        ? {
            vendorId: topVendor[0]._id,
            name: topVendor[0].vendorName,
            totalValue: +topVendor[0].totalValue.toFixed(2),
            poCount: topVendor[0].poCount,
          }
        : null,
    },
  });
});

// ─── GET /api/purchases/:id ───
exports.getOne = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw ApiError.badRequest('Invalid purchase ID');
  }
  const po = await Purchase.findById(req.params.id)
    .populate('vendor', 'name companyName phone email gstin')
    .populate('items.product', 'sku name productType thicknessMM currentStock')
    .lean();
  if (!po) throw ApiError.notFound('Purchase not found');
  res.json({ status: 'success', data: po });
});

// ─── PATCH /api/purchases/:id (DRAFT only) ───
exports.update = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw ApiError.badRequest('Invalid purchase ID');
  }
  const po = await Purchase.findById(req.params.id);
  if (!po) throw ApiError.notFound('Purchase not found');
  if (po.status !== 'DRAFT') {
    throw ApiError.conflict(`Cannot edit PO in status ${po.status} — only DRAFT POs are editable`);
  }

  // Rebuild items if provided (re-snapshot products + recompute totalAmount)
  if (req.body.items) {
    const productIds = req.body.items.map(it => it.productId);
    const products = await Product.find({ _id: { $in: productIds }, isDeleted: false })
      .select('_id sku name productType thicknessMM lengthFT widthFT isActive').lean();
    if (products.length !== new Set(productIds.map(String)).size) {
      throw ApiError.badRequest('One or more products not found or deleted');
    }
    const productMap = new Map(products.map(p => [String(p._id), p]));
    po.items = req.body.items.map(it => {
      const p = productMap.get(String(it.productId));
      return {
        product: p._id,
        productSnapshot: {
          sku: p.sku,
          name: p.name,
          productType: p.productType,
          thicknessMM: p.thicknessMM,
          sizeDisplay: p.lengthFT && p.widthFT ? `${p.lengthFT}x${p.widthFT}` : undefined,
        },
        quantity: it.quantity,
        ratePerSheet: it.ratePerSheet,
        totalAmount: +(it.quantity * it.ratePerSheet).toFixed(2),
        notes: it.notes,
      };
    });
  }
  if (req.body.gstRatePct != null) po.gstRatePct = req.body.gstRatePct;
  if (req.body.expectedAt) po.expectedAt = new Date(req.body.expectedAt);
  if (req.body.notes !== undefined) po.notes = req.body.notes;
  po.updatedBy = req.user._id;

  await po.save();
  res.json({ status: 'success', data: po });
});

// ─── POST /api/purchases/:id/order ───
exports.markOrdered = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw ApiError.badRequest('Invalid purchase ID');
  }
  const po = await Purchase.findById(req.params.id);
  if (!po) throw ApiError.notFound('Purchase not found');
  if (po.status !== 'DRAFT') {
    throw ApiError.conflict(`Cannot mark ORDERED — current status is ${po.status}`);
  }
  if (!po.items.length) throw ApiError.badRequest('Cannot order an empty PO');

  po.status = 'ORDERED';
  po.orderedAt = new Date();
  po.orderedBy = req.user._id;
  await po.save();
  res.json({ status: 'success', data: po });
});

// ─── POST /api/purchases/:id/receive ───
// Creates StockMovement(s) using existing enum (RESTOCK) + updates currentStock.
exports.receive = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw ApiError.badRequest('Invalid purchase ID');
  }
  const po = await Purchase.findById(req.params.id);
  if (!po) throw ApiError.notFound('Purchase not found');

  if (!['ORDERED', 'PARTIAL_RECEIVED'].includes(po.status)) {
    throw ApiError.conflict(`Cannot receive in status ${po.status} (must be ORDERED or PARTIAL_RECEIVED)`);
  }

  const { items: receivedItems, receivedAt, invoiceNo } = req.body;
  const receivedAtDate = receivedAt ? new Date(receivedAt) : new Date();

  // Build a Map<productId, receivedQty> from request
  const receivedByProduct = new Map();
  for (const r of receivedItems) {
    if (r.receivedQuantity > 0) {
      receivedByProduct.set(String(r.productId), r.receivedQuantity);
    }
  }

  // Per-item: validate over-receipt + update receivedQuantity
  const movementIds = [];
  for (const item of po.items) {
    const newlyReceived = receivedByProduct.get(String(item.product));
    if (!newlyReceived) continue;

    const totalAfter = (item.receivedQuantity || 0) + newlyReceived;
    if (totalAfter > item.quantity) {
      throw ApiError.badRequest(
        `Cannot receive ${newlyReceived} more of ${item.productSnapshot?.sku || item.product} — ` +
        `would exceed ordered ${item.quantity} (already received ${item.receivedQuantity})`
      );
    }

    // Fetch current product stock to snapshot before/after
    const product = await Product.findById(item.product).select('currentStock sku');
    if (!product) {
      logger.error(`receive: product ${item.product} not found — skipping stock update`);
      continue;
    }
    const before = product.currentStock || 0;
    const after = before + newlyReceived;

    const movement = await StockMovement.create({
      product: item.product,
      productSnapshot: {
        sku: item.productSnapshot?.sku,
        name: item.productSnapshot?.name,
        productType: item.productSnapshot?.productType,
      },
      movementType: 'RESTOCK',
      quantityBefore: before,
      quantityChange: newlyReceived,
      quantityAfter: after,
      reason: `PO ${po.purchaseNo} received`,
      performedBy: req.user._id,
      performedAt: receivedAtDate,
    });
    movementIds.push(movement._id);

    product.currentStock = after;
    product.lastRestockedAt = receivedAtDate;
    await product.save();

    item.receivedQuantity = totalAfter;
  }

  // Determine new PO status
  const allFullyReceived = po.items.every(it => (it.receivedQuantity || 0) >= it.quantity);
  const anyReceived = po.items.some(it => (it.receivedQuantity || 0) > 0);
  if (allFullyReceived) {
    po.status = 'RECEIVED';
    po.receivedAt = receivedAtDate;
  } else if (anyReceived) {
    po.status = 'PARTIAL_RECEIVED';
    if (!po.receivedAt) po.receivedAt = receivedAtDate;
  }

  if (invoiceNo) po.invoiceNo = invoiceNo;
  po.receivedBy = req.user._id;
  await po.save();

  res.json({
    status: 'success',
    data: {
      purchase: po,
      movementsCreated: movementIds,
    },
  });
});

// ─── POST /api/purchases/:id/cancel ───
exports.cancel = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw ApiError.badRequest('Invalid purchase ID');
  }
  const po = await Purchase.findById(req.params.id);
  if (!po) throw ApiError.notFound('Purchase not found');
  if (po.status === 'RECEIVED') {
    throw ApiError.conflict('Cannot cancel a fully-received PO');
  }
  if (po.status === 'CANCELLED') {
    throw ApiError.badRequest('PO already cancelled');
  }

  po.status = 'CANCELLED';
  po.cancelledAt = new Date();
  po.cancellationReason = req.body.reason;
  po.updatedBy = req.user._id;
  await po.save();

  // Note: already-received stock from PARTIAL_RECEIVED stays — we don't
  // reverse StockMovements. To return goods, admin issues a separate
  // RESTORATION movement via the existing stockMovement controller.
  res.json({ status: 'success', data: po });
});
