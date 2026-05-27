const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs/promises');
const { Payment, SystemSetting } = require('../models');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const QueryBuilder = require('../utils/queryBuilder');
const logger = require('../config/logger');
const gatewayPaymentService = require('../utils/gatewayPaymentService');
const razorpayService = require('../utils/razorpayService');
const upiHelper = require('../utils/upiHelper');
const pdfService = require('../utils/pdfService');
const { mapPaymentToReceipt } = require('../utils/receiptDataMapper');

/**
 * POST /api/payments/initiate
 */
exports.initiate = asyncHandler(async (req, res) => {
  const { order, amount, notes, bill } = req.body;

  const result = await gatewayPaymentService.initiatePayment({
    orderId: order,
    amount,
    billId: bill,
    notes,
  }, req.user._id);

  res.status(201).json({
    status: 'success',
    data: {
      paymentReference: result.payment.paymentReference,
      paymentId: result.payment._id,
      razorpayOrderId: result.razorpayOrder.id,
      amount: result.razorpayOrder.amount,
      currency: result.razorpayOrder.currency,
      keyId: result.keyId,
      orderNumber: result.payment.orderNumber,
      isMock: razorpayService.isMockMode(),
    },
  });
});

/**
 * POST /api/payments/verify
 */
exports.verify = asyncHandler(async (req, res) => {
  const payment = await gatewayPaymentService.verifyPayment(req.body, req.user._id);

  res.json({
    status: 'success',
    message: 'Payment verified successfully',
    data: {
      paymentReference: payment.paymentReference,
      status: payment.status,
      amount: razorpayService.toRupees(payment.amount),
      capturedAt: payment.capturedAt,
      method: payment.method,
    },
  });
});

/**
 * GET /api/payments
 */
exports.list = asyncHandler(async (req, res) => {
  const q = req.query;
  const builder = new QueryBuilder(Payment, q);

  const includeDeleted = q.includeDeleted === 'true';
  if (includeDeleted && !['ADMIN', 'SUPER_ADMIN'].includes(req.user.role)) {
    throw ApiError.forbidden('Only admins can view deleted payments');
  }
  if (!includeDeleted) {
    builder.setFilter({ isDeleted: false });
  }

  if (q.search) {
    builder.setFilter({ paymentReference: { $regex: q.search, $options: 'i' } });
  }

  builder
    .addObjectIdFilter('customer', q.customer)
    .addObjectIdFilter('order', q.order)
    .addObjectIdFilter('bill', q.bill)
    .addFilter('status', q.status)
    .addFilter('gateway', q.gateway)
    .addFilter('method', q.method);

  if (q.fromDate || q.toDate) {
    builder.addRangeFilter('createdAt',
      q.fromDate ? new Date(q.fromDate) : undefined,
      q.toDate ? new Date(q.toDate) : undefined
    );
  }

  if (q.minAmount || q.maxAmount) {
    builder.addRangeFilter('amount',
      q.minAmount ? razorpayService.toPaise(parseFloat(q.minAmount)) : undefined,
      q.maxAmount ? razorpayService.toPaise(parseFloat(q.maxAmount)) : undefined
    );
  }

  builder
    .setSort(q.sort || '-createdAt')
    .setPagination(q.page, q.limit)
    .populate('customer', 'customerName phone')
    .populate('order', 'orderNumber')
    .populate('bill', 'billNumber')
    .populate('createdBy', 'name email');

  const result = await builder.execute();
  res.json({ status: 'success', ...result });
});

/**
 * GET /api/payments/:id
 */
exports.getById = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw ApiError.badRequest('Invalid payment ID');
  }

  const payment = await Payment.findById(req.params.id)
    .populate('customer', 'customerName phone email')
    .populate('order', 'orderNumber totalAmount amountPaid paymentStatus')
    .populate('bill', 'billNumber grandTotal')
    .populate('createdBy', 'name email');

  if (!payment) throw ApiError.notFound('Payment not found');
  if (payment.isDeleted && !['ADMIN', 'SUPER_ADMIN'].includes(req.user.role)) {
    throw ApiError.notFound('Payment not found');
  }

  res.json({ status: 'success', data: payment });
});

/**
 * POST /api/payments/:id/cancel
 */
exports.cancel = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw ApiError.badRequest('Invalid payment ID');
  }

  const payment = await Payment.findById(req.params.id);
  if (!payment || payment.isDeleted) throw ApiError.notFound('Payment not found');

  if (!['CREATED', 'ATTEMPTED'].includes(payment.status)) {
    throw ApiError.badRequest(`Cannot cancel payment in '${payment.status}' status`);
  }

  const { reason } = req.body;
  payment.status = 'CANCELLED';
  payment.addEvent('CANCELLED', { source: 'api', notes: reason });
  payment.updatedBy = req.user._id;
  await payment.save();

  logger.warn(`Payment cancelled: ${payment.paymentReference} by ${req.user.email}`);

  res.json({
    status: 'success',
    message: 'Payment cancelled',
    data: { paymentReference: payment.paymentReference, status: payment.status },
  });
});

/**
 * GET /api/payments/by-order/:orderId
 */
exports.byOrder = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.orderId)) {
    throw ApiError.badRequest('Invalid order ID');
  }

  const payments = await Payment.find({
    order: req.params.orderId,
    isDeleted: false,
  })
    .sort({ createdAt: -1 })
    .select('paymentReference status amount amountRefunded currency method gateway createdAt capturedAt')
    .lean();

  res.json({ status: 'success', count: payments.length, data: payments });
});

/**
 * GET /api/payments/by-customer/:customerId
 */
exports.byCustomer = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.customerId)) {
    throw ApiError.badRequest('Invalid customer ID');
  }

  const payments = await Payment.find({
    customer: req.params.customerId,
    isDeleted: false,
  })
    .sort({ createdAt: -1 })
    .select('paymentReference status amount currency method gateway createdAt capturedAt orderNumber')
    .limit(50)
    .lean();

  res.json({ status: 'success', count: payments.length, data: payments });
});

/**
 * GET /api/payments/:id/upi-uri
 */
exports.getUpiUri = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw ApiError.badRequest('Invalid payment ID');
  }

  const payment = await Payment.findById(req.params.id);
  if (!payment || payment.isDeleted) throw ApiError.notFound('Payment not found');

  if (['CAPTURED', 'REFUNDED', 'CANCELLED'].includes(payment.status)) {
    throw ApiError.badRequest(
      `Payment already ${payment.status.toLowerCase()} — QR no longer needed`
    );
  }

  const upiUri = await upiHelper.buildUpiUriForPayment(payment);

  res.json({
    status: 'success',
    data: {
      paymentReference: payment.paymentReference,
      amount: payment.amount / 100,
      upiUri,
    },
  });
});

/**
 * GET /api/payments/:id/qr
 * ?format=dataurl (default) → JSON with base64 data URL
 * ?format=png → raw PNG
 * ?format=svg → raw SVG
 * ?size=N → QR pixel size (default 300)
 */
exports.getQrCode = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw ApiError.badRequest('Invalid payment ID');
  }

  const payment = await Payment.findById(req.params.id);
  if (!payment || payment.isDeleted) throw ApiError.notFound('Payment not found');

  if (['CAPTURED', 'REFUNDED', 'CANCELLED'].includes(payment.status)) {
    throw ApiError.badRequest(
      `Payment already ${payment.status.toLowerCase()} — QR no longer needed`
    );
  }

  const upiUri = await upiHelper.buildUpiUriForPayment(payment);
  const format = req.query.format || 'dataurl';
  const size = parseInt(req.query.size) || 300;

  if (format === 'png') {
    const buffer = await upiHelper.generateQrBuffer(upiUri, { width: size });
    res.set({
      'Content-Type': 'image/png',
      'Content-Disposition': `inline; filename="qr-${payment.paymentReference}.png"`,
      'Content-Length': buffer.length,
    });
    return res.send(buffer);
  }

  if (format === 'svg') {
    const svg = await upiHelper.generateQrSvg(upiUri, { width: size });
    res.set({
      'Content-Type': 'image/svg+xml',
      'Content-Disposition': `inline; filename="qr-${payment.paymentReference}.svg"`,
    });
    return res.send(svg);
  }

  const dataUrl = await upiHelper.generateQrDataUrl(upiUri, { width: size });
  res.json({
    status: 'success',
    data: {
      paymentReference: payment.paymentReference,
      amount: payment.amount / 100,
      upiUri,
      qrDataUrl: dataUrl,
      size,
    },
  });
});

/**
 * POST /api/payments/:id/refund
 */
exports.initiateRefund = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw ApiError.badRequest('Invalid payment ID');
  }

  const result = await gatewayPaymentService.initiateRefund(
    req.params.id,
    req.body,
    req.user._id
  );

  res.status(201).json({
    status: 'success',
    message: `${result.refundType} refund initiated`,
    data: {
      paymentReference: result.payment.paymentReference,
      paymentStatus: result.payment.status,
      refundId: result.razorpayRefund.id,
      refundAmount: result.refundAmount,
      refundType: result.refundType,
      totalRefunded: razorpayService.toRupees(result.payment.amountRefunded),
      remainingRefundable: razorpayService.toRupees(
        result.payment.amount - result.payment.amountRefunded
      ),
    },
  });
});

/**
 * GET /api/payments/refunds
 */
exports.listRefunds = asyncHandler(async (req, res) => {
  const q = req.query;
  const limit = Math.min(parseInt(q.limit) || 20, 100);
  const skip = parseInt(q.skip) || 0;

  const filter = {
    amountRefunded: { $gt: 0 },
    isDeleted: false,
  };

  if (q.fromDate || q.toDate) {
    filter.refundedAt = {};
    if (q.fromDate) filter.refundedAt.$gte = new Date(q.fromDate);
    if (q.toDate) filter.refundedAt.$lte = new Date(q.toDate);
  }

  if (q.customer) {
    if (!mongoose.Types.ObjectId.isValid(q.customer)) {
      throw ApiError.badRequest('Invalid customer ID');
    }
    filter.customer = q.customer;
  }

  const [refunds, total] = await Promise.all([
    Payment.find(filter)
      .sort({ refundedAt: -1, updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('customer', 'customerName phone')
      .populate('order', 'orderNumber')
      .select('paymentReference razorpayRefundId amount amountRefunded status orderNumber customer order refundedAt events'),
    Payment.countDocuments(filter),
  ]);

  const data = refunds.map(p => {
    const refundEvent = p.events?.find(e => e.eventType === 'REFUND_INITIATED');
    return {
      paymentReference: p.paymentReference,
      razorpayRefundId: p.razorpayRefundId,
      paymentAmount: razorpayService.toRupees(p.amount),
      refundedAmount: razorpayService.toRupees(p.amountRefunded),
      isFullRefund: p.amountRefunded >= p.amount,
      status: p.status,
      orderNumber: p.orderNumber,
      customer: p.customer,
      refundedAt: p.refundedAt || refundEvent?.eventAt,
      refundReason: refundEvent?.notes,
    };
  });

  res.json({
    status: 'success',
    count: data.length,
    total,
    data,
  });
});

/**
 * GET /api/payments/refunds/:id
 */
exports.getRefundDetail = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw ApiError.badRequest('Invalid payment ID');
  }

  const payment = await Payment.findById(req.params.id)
    .populate('customer', 'customerName phone email')
    .populate('order', 'orderNumber totalAmount')
    .populate('bill', 'billNumber grandTotal');

  if (!payment || payment.isDeleted) {
    throw ApiError.notFound('Payment not found');
  }

  if (!payment.amountRefunded || payment.amountRefunded <= 0) {
    throw ApiError.notFound('No refund found for this payment');
  }

  const refundEvents = payment.events?.filter(e =>
    ['REFUND_INITIATED', 'REFUNDED'].includes(e.eventType)
  );

  res.json({
    status: 'success',
    data: {
      paymentReference: payment.paymentReference,
      razorpayPaymentId: payment.razorpayPaymentId,
      razorpayRefundId: payment.razorpayRefundId,
      paymentAmount: razorpayService.toRupees(payment.amount),
      refundedAmount: razorpayService.toRupees(payment.amountRefunded),
      remainingRefundable: razorpayService.toRupees(payment.amount - payment.amountRefunded),
      isFullRefund: payment.amountRefunded >= payment.amount,
      paymentStatus: payment.status,
      customer: payment.customer,
      order: payment.order,
      bill: payment.bill,
      refundEvents,
      refundedAt: payment.refundedAt,
    },
  });
});

/**
 * GET /api/payments/:id/receipt
 * Generate and return payment receipt PDF
 */
exports.getReceipt = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw ApiError.badRequest('Invalid payment ID');
  }

  const payment = await Payment.findById(req.params.id);
  if (!payment || payment.isDeleted) {
    throw ApiError.notFound('Payment not found');
  }

  if (!['CAPTURED', 'REFUNDED'].includes(payment.status)) {
    throw ApiError.badRequest(
      `Cannot generate receipt for payment in '${payment.status}' status (must be CAPTURED or REFUNDED)`
    );
  }

  const receiptData = await mapPaymentToReceipt(payment);

  const pdfBuffer = await pdfService.generatePdfFromTemplate('receipts/payment-receipt', receiptData);

  const filename = `receipt_${payment.paymentReference}_${Date.now()}`;
  const outputPath = path.join(__dirname, '..', '..', 'storage', 'receipts', `${filename}.pdf`);
  await fs.writeFile(outputPath, pdfBuffer);

  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `inline; filename="receipt_${payment.paymentReference}.pdf"`,
    'Content-Length': pdfBuffer.length,
  });

  res.send(pdfBuffer);
});

/**
 * GET /api/payments/config
 */
exports.getConfig = asyncHandler(async (req, res) => {
  const [enabled, provider, autoCapture] = await Promise.all([
    SystemSetting.getValue('PAYMENT_GATEWAY_ENABLED'),
    SystemSetting.getValue('PAYMENT_GATEWAY_PROVIDER'),
    SystemSetting.getValue('PAYMENT_AUTO_CAPTURE'),
  ]);

  res.json({
    status: 'success',
    data: {
      enabled,
      provider,
      autoCapture,
      keyId: razorpayService.getKeyId(),
      isMockMode: razorpayService.isMockMode(),
    },
  });
});
