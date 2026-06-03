const mongoose = require('mongoose');

const { Bill, Order } = require('../models');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const QueryBuilder = require('../utils/queryBuilder');
const logger = require('../config/logger');

const { generateBillNumber } = require('../utils/billNumberGenerator');
const { amountToWords } = require('../utils/amountToWords');
const billService = require('../utils/billService');
const pdfService = require('../utils/pdfService');
const { mapBillToTemplate } = require('../utils/billDataMapper');
const notificationOrchestrator = require('../services/notificationOrchestrator.service');

// ─── Internal helper: PDF generation ───
async function generatePdfForBill(bill) {
  const fullBill = await Bill.findById(bill._id);
  const templateData = await mapBillToTemplate(fullBill);

  const templateName = {
    'detailed': 'detailed-gst',
    'simple': 'simple-bill',
    'minimal': 'minimal-bill',
  }[fullBill.format] || 'detailed-gst';

  const pdfBuffer = await pdfService.generatePdfFromTemplate(templateName, templateData);

  const filename = `${fullBill.billNumber}_${Date.now()}`;
  const filePath = await pdfService.savePdf(pdfBuffer, filename);

  fullBill.pdfPath = filePath;
  fullBill.pdfGeneratedAt = new Date();
  fullBill.pdfSizeBytes = pdfBuffer.length;
  await fullBill.save();

  return pdfBuffer;
}

/**
 * POST /api/bills/from-order/:orderId
 */
exports.createFromOrder = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.orderId)) {
    throw ApiError.badRequest('Invalid order ID');
  }

  const order = await Order.findById(req.params.orderId);
  if (!order || order.isDeleted) {
    throw ApiError.notFound('Order not found');
  }

  if (order.status === 'CANCELLED') {
    throw ApiError.badRequest('Cannot create bill for cancelled order');
  }

  const existingBill = await Bill.findOne({
    order: order._id,
    isLatestRevision: true,
    isDeleted: false,
  });

  if (existingBill && existingBill.status !== 'CANCELLED') {
    throw ApiError.conflict(
      `Bill already exists for this order (${existingBill.billNumber})`
    );
  }

  const billData = await billService.buildBillFromOrder(order, req.body);
  const billNumber = await generateBillNumber();
  const amountInWords = amountToWords(billData.grandTotal);

  const bill = await Bill.create({
    ...billData,
    billNumber,
    amountInWords,
    status: 'DRAFT',
    createdBy: req.user._id,
  });

  await bill.populate([
    { path: 'customer', select: 'customerName phone' },
    { path: 'order', select: 'orderNumber' },
    { path: 'createdBy', select: 'name email' },
  ]);

  logger.info(`Bill created: ${bill.billNumber} from order ${order.orderNumber} by ${req.user.email}`);

  // Fire-and-forget notification (Prompt 7 Section D). Never blocks response;
  // failures logged via the orchestrator's own try/catch + noop tail.
  notificationOrchestrator.onBillGenerated(bill).catch(notificationOrchestrator.noop);

  res.status(201).json({ status: 'success', data: bill });
});

exports.create = exports.createFromOrder;

/**
 * GET /api/bills
 */
exports.list = asyncHandler(async (req, res) => {
  const q = req.query;
  const builder = new QueryBuilder(Bill, q);

  const includeDeleted = q.includeDeleted === 'true';
  if (includeDeleted && !['ADMIN', 'SUPER_ADMIN'].includes(req.user.role)) {
    throw ApiError.forbidden('Only admins can view deleted bills');
  }
  if (!includeDeleted) {
    builder.setFilter({ isDeleted: false });
  }

  if (q.includeRevisions !== 'true') {
    builder.setFilter({ isLatestRevision: true });
  }

  if (q.search) {
    builder.setFilter({ billNumber: { $regex: q.search, $options: 'i' } });
  }

  builder
    .addObjectIdFilter('customer', q.customer)
    .addObjectIdFilter('order', q.order)
    .addFilter('status', q.status)
    .addFilter('paymentStatus', q.paymentStatus)
    .addFilter('format', q.format)
    .addFilter('hasGst', q.hasGst === 'true' ? true : q.hasGst === 'false' ? false : undefined)
    .addFilter('fiscalYear', q.fiscalYear);

  if (q.fromDate || q.toDate) {
    builder.addRangeFilter('issueDate',
      q.fromDate ? new Date(q.fromDate) : undefined,
      q.toDate ? new Date(q.toDate) : undefined
    );
  }

  if (q.minAmount || q.maxAmount) {
    builder.addRangeFilter('grandTotal',
      q.minAmount ? parseFloat(q.minAmount) : undefined,
      q.maxAmount ? parseFloat(q.maxAmount) : undefined
    );
  }

  builder
    .setSort(q.sort || '-issueDate')
    .setPagination(q.page, q.limit)
    .setFields(q.fields)
    .populate('customer', 'customerName phone companyName')
    .populate('order', 'orderNumber')
    .populate('createdBy', 'name email');

  const result = await builder.execute();
  res.json({ status: 'success', ...result });
});

/**
 * GET /api/bills/:id
 */
exports.getById = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw ApiError.badRequest('Invalid bill ID');
  }

  const bill = await Bill.findById(req.params.id)
    .populate('customer', 'customerName phone email companyName gstin')
    .populate('order', 'orderNumber orderDate status')
    .populate('createdBy', 'name email')
    .populate('finalizedBy', 'name email')
    .populate('cancelledBy', 'name email')
    .populate('events.performedBy', 'name email');

  if (!bill) throw ApiError.notFound('Bill not found');
  if (bill.isDeleted && !['ADMIN', 'SUPER_ADMIN'].includes(req.user.role)) {
    throw ApiError.notFound('Bill not found');
  }

  res.json({ status: 'success', data: bill });
});

/**
 * PUT /api/bills/:id
 */
exports.update = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw ApiError.badRequest('Invalid bill ID');
  }

  const bill = await Bill.findById(req.params.id);
  if (!bill || bill.isDeleted) throw ApiError.notFound('Bill not found');

  if (bill.status !== 'DRAFT') {
    throw ApiError.forbidden(`Cannot edit bill in '${bill.status}' status (only DRAFT bills are editable)`);
  }

  const protectedFields = [
    '_id', 'billNumber', 'fiscalYear', 'order', 'orderNumber', 'customer',
    'customerInfo', 'businessInfo', 'items', 'createdBy', 'createdAt',
    'status', 'events', 'amountPaid', 'paymentStatus', 'isDeleted',
    'parentBill', 'revisionNumber', 'isLatestRevision',
    'finalizedAt', 'finalizedBy', 'cancelledAt', 'cancelledBy',
  ];
  protectedFields.forEach(f => delete req.body[f]);

  Object.assign(bill, req.body);
  bill.updatedBy = req.user._id;

  await bill.save();

  logger.info(`Bill updated: ${bill.billNumber} by ${req.user.email}`);
  res.json({ status: 'success', data: bill });
});

/**
 * POST /api/bills/:id/finalize
 */
exports.finalize = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw ApiError.badRequest('Invalid bill ID');
  }

  const bill = await Bill.findById(req.params.id);
  if (!bill || bill.isDeleted) throw ApiError.notFound('Bill not found');

  if (bill.status !== 'DRAFT') {
    throw ApiError.badRequest(`Cannot finalize bill in '${bill.status}' status`);
  }

  const { notes } = req.body;
  await bill.finalize(req.user._id, notes);

  // Generate PDF in background — don't block response
  generatePdfForBill(bill).catch(err => {
    logger.error(`PDF generation failed for ${bill.billNumber}:`, err);
  });

  logger.info(`Bill finalized: ${bill.billNumber} by ${req.user.email}`);
  res.json({ status: 'success', message: 'Bill finalized', data: bill });
});

/**
 * GET /api/bills/:id/pdf
 */
exports.generatePdf = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw ApiError.badRequest('Invalid bill ID');
  }

  const bill = await Bill.findById(req.params.id);
  if (!bill || bill.isDeleted) throw ApiError.notFound('Bill not found');

  if (bill.status !== 'CANCELLED') {
    await billService.syncPaymentFromOrder(bill);
  }

  const freshBill = await Bill.findById(bill._id);
  const pdfBuffer = await generatePdfForBill(freshBill);

  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="${freshBill.billNumber}.pdf"`,
    'Content-Length': pdfBuffer.length,
  });

  res.send(pdfBuffer);
});

/**
 * POST /api/bills/:id/regenerate-pdf
 */
exports.regeneratePdf = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw ApiError.badRequest('Invalid bill ID');
  }

  const bill = await Bill.findById(req.params.id);
  if (!bill || bill.isDeleted) throw ApiError.notFound('Bill not found');

  await billService.syncPaymentFromOrder(bill);

  const freshBill = await Bill.findById(bill._id);
  await generatePdfForBill(freshBill);

  const refetched = await Bill.findById(bill._id);
  res.json({
    status: 'success',
    message: 'PDF regenerated',
    data: {
      billNumber: refetched.billNumber,
      pdfPath: refetched.pdfPath,
      pdfSizeBytes: refetched.pdfSizeBytes,
    },
  });
});

/**
 * POST /api/bills/:id/mark-sent
 */
exports.markSent = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw ApiError.badRequest('Invalid bill ID');
  }

  const bill = await Bill.findById(req.params.id);
  if (!bill || bill.isDeleted) throw ApiError.notFound('Bill not found');

  const { channel, notes, recipientInfo } = req.body;

  await bill.markSent(req.user._id, channel, notes);

  if (recipientInfo) {
    const lastEvent = bill.events[bill.events.length - 1];
    if (lastEvent) {
      lastEvent.metadata = { ...lastEvent.metadata, recipientInfo };
      await bill.save();
    }
  }

  logger.info(`Bill ${bill.billNumber} marked sent via ${channel} by ${req.user.email}`);
  res.json({
    status: 'success',
    message: `Bill marked as sent via ${channel}`,
    data: {
      billNumber: bill.billNumber,
      status: bill.status,
      sentVia: channel,
    },
  });
});

/**
 * POST /api/bills/:id/cancel
 */
exports.cancel = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw ApiError.badRequest('Invalid bill ID');
  }

  const bill = await Bill.findById(req.params.id);
  if (!bill || bill.isDeleted) throw ApiError.notFound('Bill not found');

  const { reason } = req.body;
  await bill.cancel(req.user._id, reason);

  logger.warn(`Bill cancelled: ${bill.billNumber} by ${req.user.email}. Reason: ${reason}`);
  res.json({
    status: 'success',
    message: 'Bill cancelled',
    data: { billNumber: bill.billNumber, cancelledAt: bill.cancelledAt },
  });
});

/**
 * DELETE /api/bills/:id
 */
exports.softDelete = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw ApiError.badRequest('Invalid bill ID');
  }

  const bill = await Bill.findById(req.params.id);
  if (!bill) throw ApiError.notFound('Bill not found');
  if (bill.isDeleted) throw ApiError.badRequest('Bill already deleted');

  const reason = req.body?.reason || 'No reason provided';
  await bill.softDelete(req.user._id, reason);

  logger.warn(`Bill soft-deleted: ${bill.billNumber} by ${req.user.email}`);
  res.json({ status: 'success', message: 'Bill soft-deleted', data: { billNumber: bill.billNumber } });
});

/**
 * GET /api/bills/by-order/:orderId
 */
exports.byOrder = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.orderId)) {
    throw ApiError.badRequest('Invalid order ID');
  }

  const bills = await Bill.find({
    order: req.params.orderId,
    isDeleted: false,
  })
    .sort({ revisionNumber: -1, createdAt: -1 })
    .select('billNumber issueDate status paymentStatus grandTotal amountPaid amountDue revisionNumber isLatestRevision format')
    .lean();

  res.json({ status: 'success', count: bills.length, data: bills });
});

/**
 * POST /api/bills/:id/customer-signature
 */
exports.uploadCustomerSignature = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw ApiError.badRequest('Invalid bill ID');
  }

  const bill = await Bill.findById(req.params.id);
  if (!bill || bill.isDeleted) throw ApiError.notFound('Bill not found');

  if (bill.status === 'CANCELLED') {
    throw ApiError.badRequest('Cannot add signature to cancelled bill');
  }

  const { signatureImage, signedByName } = req.body;

  const normalizedImage = signatureImage.startsWith('data:')
    ? signatureImage
    : `data:image/png;base64,${signatureImage}`;

  bill.customerSignature = {
    signatureImage: normalizedImage,
    signedAt: new Date(),
    signedByName: signedByName || bill.customerInfo?.customerName,
  };
  bill.updatedBy = req.user._id;

  bill.events.push({
    eventType: 'CUSTOMER_SIGNED',
    eventAt: new Date(),
    performedBy: req.user._id,
    notes: `Customer signature received from ${signedByName || 'customer'}`,
  });

  await bill.save();

  logger.info(`Customer signature uploaded for bill ${bill.billNumber} by ${req.user.email}`);

  res.json({
    status: 'success',
    message: 'Customer signature recorded',
    data: {
      billNumber: bill.billNumber,
      signedAt: bill.customerSignature.signedAt,
      signedByName: bill.customerSignature.signedByName,
    },
  });
});

/**
 * POST /api/bills/:id/issuer-signature
 */
exports.uploadIssuerSignature = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw ApiError.badRequest('Invalid bill ID');
  }

  const bill = await Bill.findById(req.params.id);
  if (!bill || bill.isDeleted) throw ApiError.notFound('Bill not found');

  if (bill.status === 'CANCELLED') {
    throw ApiError.badRequest('Cannot add signature to cancelled bill');
  }

  const { signatureImage } = req.body;

  const normalizedImage = signatureImage.startsWith('data:')
    ? signatureImage
    : `data:image/png;base64,${signatureImage}`;

  bill.issuerSignature = {
    signatureImage: normalizedImage,
    signedByUser: req.user._id,
  };
  bill.updatedBy = req.user._id;

  bill.events.push({
    eventType: 'ISSUER_SIGNED',
    eventAt: new Date(),
    performedBy: req.user._id,
    notes: 'Bill signed by authorized signatory',
  });

  await bill.save();

  logger.info(`Issuer signature uploaded for bill ${bill.billNumber} by ${req.user.email}`);

  res.json({
    status: 'success',
    message: 'Issuer signature recorded',
    data: {
      billNumber: bill.billNumber,
      signedByUser: req.user.email,
    },
  });
});

/**
 * GET /api/bills/:id/signatures
 */
exports.getSignatures = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw ApiError.badRequest('Invalid bill ID');
  }

  const includeImages = req.query.includeImages === 'true';

  const projection = includeImages
    ? 'customerSignature issuerSignature billNumber'
    : 'customerSignature.signedAt customerSignature.signedByName issuerSignature.signedByUser billNumber';

  const bill = await Bill.findById(req.params.id)
    .select(projection)
    .populate('issuerSignature.signedByUser', 'name email');

  if (!bill) throw ApiError.notFound('Bill not found');

  res.json({
    status: 'success',
    data: {
      billNumber: bill.billNumber,
      customerSignature: bill.customerSignature || null,
      issuerSignature: bill.issuerSignature || null,
      // Compute presence from fields always in projection (not signatureImage which
      // may be excluded when includeImages=false).
      hasCustomerSignature: !!(bill.customerSignature?.signedAt),
      hasIssuerSignature: !!(bill.issuerSignature?.signedByUser),
    },
  });
});

/**
 * DELETE /api/bills/:id/customer-signature
 */
exports.clearCustomerSignature = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    throw ApiError.badRequest('Invalid bill ID');
  }

  const bill = await Bill.findById(req.params.id);
  if (!bill || bill.isDeleted) throw ApiError.notFound('Bill not found');

  if (!bill.customerSignature?.signatureImage) {
    throw ApiError.badRequest('No customer signature to clear');
  }

  bill.customerSignature = undefined;
  bill.updatedBy = req.user._id;

  bill.events.push({
    eventType: 'SIGNATURE_CLEARED',
    eventAt: new Date(),
    performedBy: req.user._id,
    notes: 'Customer signature cleared',
  });

  await bill.save();

  logger.warn(`Customer signature cleared for bill ${bill.billNumber} by ${req.user.email}`);

  res.json({ status: 'success', message: 'Customer signature cleared' });
});

/**
 * GET /api/bills/by-customer/:customerId
 */
exports.byCustomer = asyncHandler(async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.customerId)) {
    throw ApiError.badRequest('Invalid customer ID');
  }

  const bills = await Bill.find({
    customer: req.params.customerId,
    isDeleted: false,
    isLatestRevision: true,
  })
    .sort({ issueDate: -1 })
    .select('billNumber issueDate orderNumber status paymentStatus grandTotal amountPaid amountDue')
    .limit(50)
    .lean();

  res.json({ status: 'success', count: bills.length, data: bills });
});
