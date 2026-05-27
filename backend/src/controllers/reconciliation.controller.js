const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const reconciliationService = require('../utils/reconciliationService');

/**
 * GET /api/reconciliation/summary
 */
exports.getSummary = asyncHandler(async (req, res) => {
  const summary = await reconciliationService.getSummary({
    fromDate: req.query.fromDate,
    toDate: req.query.toDate,
  });
  res.json({ status: 'success', data: summary });
});

/**
 * GET /api/reconciliation/outstanding
 */
exports.getOutstanding = asyncHandler(async (req, res) => {
  const result = await reconciliationService.getOutstanding({
    limit: req.query.limit,
    skip: req.query.skip,
    customer: req.query.customer,
    minDueDays: req.query.minDueDays ? parseInt(req.query.minDueDays) : undefined,
  });
  res.json({ status: 'success', ...result });
});

/**
 * GET /api/reconciliation/daily/:date
 */
exports.getDailyReconciliation = asyncHandler(async (req, res) => {
  try {
    const result = await reconciliationService.getDailyReconciliation(req.params.date);
    res.json({ status: 'success', data: result });
  } catch (err) {
    if (err.message === 'Invalid date format') {
      throw ApiError.badRequest('Invalid date format (use YYYY-MM-DD)');
    }
    throw err;
  }
});

/**
 * GET /api/reconciliation/customer/:customerId
 */
exports.getCustomerReconciliation = asyncHandler(async (req, res) => {
  try {
    const result = await reconciliationService.getCustomerReconciliation(req.params.customerId);
    res.json({ status: 'success', data: result });
  } catch (err) {
    if (err.message === 'Invalid customer ID') {
      throw ApiError.badRequest('Invalid customer ID');
    }
    if (err.message === 'Customer not found') {
      throw ApiError.notFound('Customer not found');
    }
    throw err;
  }
});

/**
 * GET /api/reconciliation/discrepancies
 */
exports.getDiscrepancies = asyncHandler(async (req, res) => {
  const result = await reconciliationService.detectDiscrepancies({
    limit: req.query.limit,
  });
  res.json({ status: 'success', ...result });
});
