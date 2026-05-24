const express = require('express');
const router = express.Router();

const ctrl = require('../controllers/bill.controller');
const { protect } = require('../middleware/auth');
const { allow, requireAdmin, requireSuperAdmin } = require('../middleware/rbac');
const validate = require('../middleware/validate');
const {
  createBillFromOrderSchema,
  updateBillSchema,
  finalizeBillSchema,
  markSentSchema,
  cancelBillSchema,
  uploadSignatureSchema,
} = require('../validators/bill.validator');

router.use(protect);

// Specialized GETs (before /:id)
router.get('/by-order/:orderId', ctrl.byOrder);
router.get('/by-customer/:customerId', ctrl.byCustomer);

// CRUD
router.get('/', ctrl.list);
router.get('/:id', ctrl.getById);
router.post('/from-order/:orderId',
  allow('SUPER_ADMIN', 'ADMIN', 'BILLING'),
  validate(createBillFromOrderSchema, 'body'),
  ctrl.createFromOrder
);
router.put('/:id',
  allow('SUPER_ADMIN', 'ADMIN', 'BILLING'),
  validate(updateBillSchema, 'body'),
  ctrl.update
);

// Status workflow
router.post('/:id/finalize',
  allow('SUPER_ADMIN', 'ADMIN', 'BILLING'),
  validate(finalizeBillSchema, 'body'),
  ctrl.finalize
);
router.post('/:id/mark-sent',
  allow('SUPER_ADMIN', 'ADMIN', 'BILLING'),
  validate(markSentSchema, 'body'),
  ctrl.markSent
);
router.post('/:id/cancel',
  requireAdmin,
  validate(cancelBillSchema, 'body'),
  ctrl.cancel
);

// PDF
router.get('/:id/pdf', ctrl.generatePdf);
router.post('/:id/regenerate-pdf',
  allow('SUPER_ADMIN', 'ADMIN', 'BILLING'),
  ctrl.regeneratePdf
);

// Signatures
router.get('/:id/signatures', ctrl.getSignatures);
router.post('/:id/customer-signature',
  allow('SUPER_ADMIN', 'ADMIN', 'BILLING'),
  validate(uploadSignatureSchema, 'body'),
  ctrl.uploadCustomerSignature
);
router.post('/:id/issuer-signature',
  allow('SUPER_ADMIN', 'ADMIN', 'BILLING'),
  validate(uploadSignatureSchema, 'body'),
  ctrl.uploadIssuerSignature
);
router.delete('/:id/customer-signature',
  requireAdmin,
  ctrl.clearCustomerSignature
);

// Destructive
router.delete('/:id', requireSuperAdmin, ctrl.softDelete);

module.exports = router;
