const mongoose = require('mongoose');
const { Order, Customer, Product, SystemSetting } = require('../models');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const logger = require('../config/logger');
const QueryBuilder = require('../utils/queryBuilder');
const { generateOrderNumber } = require('../utils/orderNumberGenerator');
const pricingEngine = require('../utils/pricingEngine');
const stockService = require('../utils/stockService');
const paymentService = require('../utils/paymentService');
const notificationOrchestrator = require('../services/notificationOrchestrator.service');
const sockets = require('../sockets');

/**
 * POST /api/orders
 */
exports.create = asyncHandler(async (req, res) => {
  const customer = await Customer.findOne({
    _id: req.body.customer,
    isDeleted: false
  });
  if (!customer) {
    throw ApiError.badRequest('Customer not found or deleted');
  }

  const productIds = [
    ...req.body.items.map(i => i.product),
    ...req.body.items.filter(i => i.fromRawSheet).map(i => i.fromRawSheet),
  ];
  const productCount = await Product.countDocuments({
    _id: { $in: productIds },
    isDeleted: false,
  });
  if (productCount < new Set(productIds).size) {
    throw ApiError.badRequest('One or more products not found or deleted');
  }

  const orderNumber = await generateOrderNumber();

  const businessState = await SystemSetting.getValue('BUSINESS_STATE', 'Madhya Pradesh');
  const customerState = customer.billingAddress?.state || businessState;
  const isIntraState = businessState === customerState;

  const customerSnapshot = {
    customerName: customer.customerName,
    phone: customer.phone,
    companyName: customer.companyName,
    gstin: customer.gstin,
    billingState: customerState,
  };

  const enrichedItems = await Promise.all(req.body.items.map(async (item) => {
    const product = await Product.findById(item.product).populate('grade', 'code');
    return {
      ...item,
      productSnapshot: {
        sku: product.sku,
        name: product.name,
        productType: product.productType,
        thicknessMM: product.thicknessMM,
        grade: product.grade?.code,
        brand: product.brand,
      },
    };
  }));

  const order = await Order.create({
    ...req.body,
    orderNumber,
    customer: customer._id,
    customerSnapshot,
    items: enrichedItems,
    isIntraState,
    createdBy: req.user._id,
  });

  await order.populate([
    { path: 'customer', select: 'customerName phone' },
    { path: 'items.product', select: 'sku name productType' },
    { path: 'createdBy', select: 'name email' },
  ]);

  logger.info(`Order created: ${order.orderNumber} by ${req.user.email} for ${customer.customerName}`);

  // Fire-and-forget real-time broadcast (Prompt 9 Section B).
  // safeEmit handles null io + throws internally — never blocks response.
  sockets.emitOrderNew(order);

  res.status(201).json({ status: 'success', data: order });
});

/**
 * GET /api/orders
 */
exports.list = asyncHandler(async (req, res) => {
  const q = req.query;
  const builder = new QueryBuilder(Order, q);

  const includeDeleted = q.includeDeleted === 'true';
  if (includeDeleted && !['ADMIN', 'SUPER_ADMIN'].includes(req.user.role)) {
    throw ApiError.forbidden('Only admins can view deleted orders');
  }
  if (!includeDeleted) {
    builder.setFilter({ isDeleted: false });
  }

  if (q.search) {
    builder.setFilter({ orderNumber: { $regex: q.search, $options: 'i' } });
  }

  builder
    .addObjectIdFilter('customer', q.customer)
    .addFilter('status', q.status)
    .addFilter('paymentStatus', q.paymentStatus)
    .addFilter('paymentMode', q.paymentMode)
    .addFilter('financialYear', q.financialYear)
    .addFilter('deliveryMethod', q.deliveryMethod);

  if (q.fromDate || q.toDate) {
    builder.addRangeFilter('orderDate',
      q.fromDate ? new Date(q.fromDate) : undefined,
      q.toDate ? new Date(q.toDate) : undefined
    );
  }

  if (q.minAmount || q.maxAmount) {
    builder.addRangeFilter('totalAmount',
      q.minAmount ? parseFloat(q.minAmount) : undefined,
      q.maxAmount ? parseFloat(q.maxAmount) : undefined
    );
  }

  if (q.tags) builder.addArrayFilter('tags', q.tags, 'all');

  builder
    .setSort(q.sort || '-orderDate')
    .setPagination(q.page, q.limit)
    .setFields(q.fields)
    .populate('customer', 'customerName phone companyName')
    .populate('createdBy', 'name email');

  const result = await builder.execute();

  res.json({ status: 'success', ...result });
});

/**
 * GET /api/orders/:id
 */
exports.getById = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw ApiError.badRequest('Invalid order ID');
  }

  const order = await Order.findById(req.params.id)
    .populate('customer', 'customerName phone email companyName gstin billingAddress')
    .populate('items.product', 'sku name productType thicknessMM grade brand')
    .populate('items.fromRawSheet', 'sku name')
    .populate('items.shape', 'code label baseMultiplier')
    .populate('items.cuttingRule', 'code name mode')
    .populate('createdBy', 'name email')
    .populate('updatedBy', 'name email')
    .populate('statusHistory.changedBy', 'name email')
    .populate('payments.receivedBy', 'name email')
    .populate('cancelledBy', 'name email');

  if (!order) throw ApiError.notFound('Order not found');
  if (order.isDeleted && !['ADMIN', 'SUPER_ADMIN'].includes(req.user.role)) {
    throw ApiError.notFound('Order not found');
  }

  res.json({ status: 'success', data: order });
});

/**
 * PUT /api/orders/:id
 */
exports.update = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw ApiError.badRequest('Invalid order ID');
  }

  const order = await Order.findById(req.params.id);
  if (!order || order.isDeleted) {
    throw ApiError.notFound('Order not found');
  }

  const canEdit = await order.canEdit();
  if (!canEdit) {
    const lockStatus = await SystemSetting.getValue('ORDER_EDIT_LOCK_STATUS', 'COMPLETED');
    throw ApiError.forbidden(
      `Cannot edit order in status '${order.status}' (lock at: ${lockStatus})`
    );
  }

  const protectedFields = [
    '_id', 'orderNumber', 'orderDate', 'financialYear',
    'customer', 'customerSnapshot', 'createdBy', 'createdAt',
    'status', 'statusHistory', 'payments', 'paymentStatus',
    'amountPaid', 'amountDue', 'isDeleted', 'deletedAt', 'deletedBy',
    'cancelledAt', 'cancelledBy', 'cancellationReason',
  ];
  protectedFields.forEach(f => delete req.body[f]);

  Object.assign(order, req.body);
  order.updatedBy = req.user._id;

  await order.save();

  await order.populate([
    { path: 'customer', select: 'customerName phone' },
    { path: 'updatedBy', select: 'name email' },
  ]);

  logger.info(`Order updated: ${order.orderNumber} by ${req.user.email}`);

  res.json({ status: 'success', data: order });
});

/**
 * POST /api/orders/:id/status
 */
exports.changeStatus = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw ApiError.badRequest('Invalid order ID');
  }

  const { status, notes } = req.body;

  const order = await Order.findById(req.params.id);
  if (!order || order.isDeleted) {
    throw ApiError.notFound('Order not found');
  }

  if (order.status === 'CANCELLED') {
    throw ApiError.badRequest('Cannot change status of cancelled order');
  }

  if (order.status === status) {
    throw ApiError.badRequest('Order is already in this status');
  }

  const oldStatus = order.status;

  // ═══ STOCK INTEGRATION ═══
  const stockDeductionTriggers = ['IN_PROGRESS', 'CUTTING'];
  const wasNotInProgress = !['IN_PROGRESS', 'CUTTING', 'BUNDLING', 'READY', 'COMPLETED', 'DELIVERED'].includes(oldStatus);

  let stockMovements = [];
  if (stockDeductionTriggers.includes(status) && wasNotInProgress) {
    const availability = await stockService.checkStockAvailability(order.items);
    if (!availability.sufficient) {
      throw ApiError.conflict(
        `Cannot move to ${status} — insufficient stock`,
        { issues: availability.issues }
      );
    }
    stockMovements = await stockService.deductForOrder(order, req.user._id);
  }

  // Update customer insights when COMPLETED
  if (status === 'COMPLETED' && oldStatus !== 'COMPLETED') {
    await stockService.updateCustomerInsights(order);
  }

  order._statusChangedByUser = req.user._id;
  order._statusChangeNotes = notes;
  order.status = status;
  order.updatedBy = req.user._id;

  await order.save();

  logger.info(`Order status: ${order.orderNumber} ${oldStatus} → ${status} by ${req.user.email}`);

  // Fire-and-forget real-time broadcasts (Prompt 9 Section B).
  // Specific event carries oldStatus → newStatus; the generic update
  // event is also emitted so dashboard widgets that only care about
  // "something changed on this order" can subscribe once.
  sockets.emitOrderStatusChanged(order, oldStatus);
  sockets.emitOrderUpdated(order);

  // Fire-and-forget notification when status becomes READY (Prompt 7 Section D).
  // Never blocks API response; orchestrator handles its own errors.
  if (status === 'READY' && oldStatus !== 'READY') {
    notificationOrchestrator.onOrderReady(order).catch(notificationOrchestrator.noop);
  }

  res.json({
    status: 'success',
    message: `Status changed to ${status}`,
    data: {
      orderNumber: order.orderNumber,
      oldStatus,
      newStatus: status,
      stockMovements: stockMovements.length,
      historyEntries: order.statusHistory.length,
    },
  });
});

/**
 * POST /api/orders/:id/cancel
 */
exports.cancel = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw ApiError.badRequest('Invalid order ID');
  }

  const { reason } = req.body;

  const order = await Order.findById(req.params.id);
  if (!order || order.isDeleted) {
    throw ApiError.notFound('Order not found');
  }

  if (order.status === 'CANCELLED') {
    throw ApiError.badRequest('Order is already cancelled');
  }

  if (['COMPLETED', 'DELIVERED'].includes(order.status)) {
    throw ApiError.badRequest('Cannot cancel completed/delivered orders');
  }

  // ═══ STOCK RESTORATION ═══
  const stockWasDeducted = ['IN_PROGRESS', 'CUTTING', 'BUNDLING', 'READY'].includes(order.status);
  let restorations = [];

  if (stockWasDeducted) {
    restorations = await stockService.restoreForOrder(order, req.user._id);
  }

  order._statusChangedByUser = req.user._id;
  order._statusChangeNotes = `Cancelled: ${reason}`;
  order.status = 'CANCELLED';
  order.cancelledAt = new Date();
  order.cancelledBy = req.user._id;
  order.cancellationReason = reason;
  order.updatedBy = req.user._id;

  await order.save();

  logger.info(`Order cancelled: ${order.orderNumber} by ${req.user.email}. Restored ${restorations.length} stock movements.`);

  res.json({
    status: 'success',
    message: 'Order cancelled',
    data: {
      orderNumber: order.orderNumber,
      cancelledAt: order.cancelledAt,
      stockRestored: restorations.length,
    },
  });
});

/**
 * DELETE /api/orders/:id
 */
exports.softDelete = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw ApiError.badRequest('Invalid order ID');
  }

  const order = await Order.findById(req.params.id);
  if (!order) throw ApiError.notFound('Order not found');
  if (order.isDeleted) throw ApiError.badRequest('Order already deleted');

  const reason = req.body?.reason || 'No reason provided';
  await order.softDelete(req.user._id, reason);

  logger.warn(`Order soft-deleted: ${order.orderNumber} by ${req.user.email}`);

  res.json({
    status: 'success',
    message: 'Order soft-deleted',
    data: { orderNumber: order.orderNumber },
  });
});

/**
 * POST /api/orders/:id/restore
 */
exports.restore = asyncHandler(async (req, res) => {
  const order = await Order.findById(req.params.id);
  if (!order) throw ApiError.notFound('Order not found');
  if (!order.isDeleted) throw ApiError.badRequest('Order is not deleted');

  order.isDeleted = false;
  order.deletedAt = null;
  order.deletedBy = null;
  order.updatedBy = req.user._id;

  await order.save();

  logger.info(`Order restored: ${order.orderNumber} by ${req.user.email}`);

  res.json({ status: 'success', message: 'Order restored', data: { orderNumber: order.orderNumber } });
});

/**
 * GET /api/orders/by-customer/:customerId
 */
exports.byCustomer = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.customerId)) {
    throw ApiError.badRequest('Invalid customer ID');
  }

  const orders = await Order.find({
    customer: req.params.customerId,
    isDeleted: false,
  })
    .sort({ orderDate: -1 })
    .select('orderNumber orderDate status paymentStatus totalAmount amountDue')
    .limit(50)
    .lean();

  res.json({ status: 'success', count: orders.length, data: orders });
});

/**
 * POST /api/orders/calculate-preview
 * Calculate pricing WITHOUT creating order (for quotes/estimation)
 */
exports.calculatePreview = asyncHandler(async (req, res) => {
  const { customer: customerId, items, ...options } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    throw ApiError.badRequest('items array required');
  }

  let customer = null;
  if (customerId) {
    if (!mongoose.Types.ObjectId.isValid(customerId)) {
      throw ApiError.badRequest('Invalid customer ID');
    }
    customer = await Customer.findById(customerId);
    if (!customer) throw ApiError.badRequest('Customer not found');
  }

  try {
    const pricing = await pricingEngine.calculateOrderTotal(items, customer, options);
    res.json({
      status: 'success',
      message: 'Pricing calculated (preview only, no order created)',
      data: pricing,
    });
  } catch (error) {
    throw ApiError.badRequest(`Pricing calculation failed: ${error.message}`);
  }
});

/**
 * POST /api/orders/:id/recalculate-pricing
 * Recalculate pricing for existing order
 */
exports.recalculatePricing = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw ApiError.badRequest('Invalid order ID');
  }

  const order = await Order.findById(req.params.id).populate('customer');
  if (!order || order.isDeleted) throw ApiError.notFound('Order not found');

  const canEdit = await order.canEdit();
  if (!canEdit) {
    throw ApiError.forbidden(`Cannot recalculate — order in status '${order.status}'`);
  }

  const pricing = await pricingEngine.calculateOrderTotal(
    order.items.map(item => ({
      itemType: item.itemType,
      product: item.product,
      fromRawSheet: item.fromRawSheet,
      dimensions: item.dimensions,
      shape: item.shape,
      cuttingRule: item.cuttingRule,
      quantity: item.quantity,
    })),
    order.customer,
    {
      gstRatePct: order.gstRatePct,
      hasGstBill: order.hasGstBill,
      additionalCharges: order.additionalCharges,
      discountAmount: order.discountAmount,
    }
  );

  order.items = order.items.map((item, i) => ({
    ...item.toObject(),
    pricePerUnit: pricing.items[i].pricePerUnit,
    materialCost: pricing.items[i].materialCost,
    cuttingCharges: pricing.items[i].cuttingCharges,
    wastageAreaSqFt: pricing.items[i].wastageAreaSqFt,
    wastageCost: pricing.items[i].wastageCost,
    discountPct: pricing.items[i].discountPct,
    discountAmount: pricing.items[i].discountAmount,
    lineSubtotal: pricing.items[i].lineSubtotal,
  }));

  order.subtotal = pricing.subtotal;
  order.additionalCharges = pricing.additionalCharges;
  order.discountAmount = pricing.discountAmount;
  order.taxableAmount = pricing.taxableAmount;
  order.cgst = pricing.cgst;
  order.sgst = pricing.sgst;
  order.igst = pricing.igst;
  order.totalGst = pricing.totalGst;
  order.totalAmount = pricing.totalAmount;
  order.isIntraState = pricing.isIntraState;
  order.updatedBy = req.user._id;

  await order.save();

  res.json({
    status: 'success',
    message: 'Pricing recalculated',
    data: { order, pricing },
  });
});

/**
 * POST /api/orders/check-stock
 * Pre-flight stock check (before creating order)
 */
exports.checkStock = asyncHandler(async (req, res) => {
  const { items } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    throw ApiError.badRequest('items array required');
  }

  const result = await stockService.checkStockAvailability(items);

  res.json({ status: 'success', data: result });
});

/**
 * POST /api/orders/:id/payments
 */
exports.addPayment = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw ApiError.badRequest('Invalid order ID');
  }

  const result = await paymentService.addPayment(req.params.id, req.body, req.user._id);

  res.status(201).json({
    status: 'success',
    message: 'Payment added',
    data: {
      orderNumber: result.order.orderNumber,
      paymentAdded: result.paymentAdded,
      totalPaid: result.order.amountPaid,
      amountDue: result.amountDue,
      paymentStatus: result.newStatus,
    },
  });
});

/**
 * POST /api/orders/:id/refund
 */
exports.refund = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw ApiError.badRequest('Invalid order ID');
  }

  const { paymentId, ...refundData } = req.body;

  const result = await paymentService.processRefund(
    req.params.id,
    paymentId,
    refundData,
    req.user._id
  );

  res.json({
    status: 'success',
    message: 'Refund processed',
    data: {
      orderNumber: result.order.orderNumber,
      refundAmount: result.refundAmount,
      newStatus: result.newStatus,
    },
  });
});

/**
 * GET /api/orders/:id/payments
 */
exports.getPayments = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw ApiError.badRequest('Invalid order ID');
  }

  const order = await Order.findById(req.params.id)
    .populate('payments.receivedBy', 'name email')
    .select('orderNumber totalAmount amountPaid amountDue paymentStatus payments');

  if (!order) throw ApiError.notFound('Order not found');

  res.json({
    status: 'success',
    data: {
      orderNumber: order.orderNumber,
      totalAmount: order.totalAmount,
      amountPaid: order.amountPaid,
      amountDue: order.amountDue,
      paymentStatus: order.paymentStatus,
      payments: order.payments,
      summary: {
        totalPayments: order.payments.length,
        positivePayments: order.payments.filter(p => p.amount > 0).length,
        refunds: order.payments.filter(p => p.amount < 0).length,
      },
    },
  });
});

/**
 * GET /api/orders/outstanding-payments
 */
exports.outstandingPayments = asyncHandler(async (req, res) => {
  const filters = {
    olderThanDays: req.query.olderThanDays ? parseInt(req.query.olderThanDays) : null,
    customerId: req.query.customerId,
  };

  const orders = await paymentService.getOutstandingPayments(filters);

  const totalOutstanding = orders.reduce((sum, o) => sum + o.amountDue, 0);
  const byUrgency = orders.reduce((acc, o) => {
    acc[o.urgency] = (acc[o.urgency] || 0) + 1;
    return acc;
  }, {});

  res.json({
    status: 'success',
    count: orders.length,
    summary: {
      totalOutstanding: +totalOutstanding.toFixed(2),
      byUrgency,
    },
    data: orders,
  });
});

/**
 * GET /api/orders/customer-dues/:customerId
 */
exports.customerDues = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.customerId)) {
    throw ApiError.badRequest('Invalid customer ID');
  }

  const orders = await Order.find({
    customer: req.params.customerId,
    isDeleted: false,
    status: { $nin: ['CANCELLED'] },
    amountDue: { $gt: 0 },
  })
    .select('orderNumber orderDate totalAmount amountPaid amountDue status')
    .sort({ orderDate: -1 })
    .lean();

  const totalDues = orders.reduce((sum, o) => sum + o.amountDue, 0);

  res.json({
    status: 'success',
    data: {
      totalDues: +totalDues.toFixed(2),
      orderCount: orders.length,
      orders,
    },
  });
});
