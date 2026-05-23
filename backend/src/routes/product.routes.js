const express = require('express');
const router = express.Router();

const productController = require('../controllers/product.controller');
const { protect } = require('../middleware/auth');
const { allow, requireAdmin, requireSuperAdmin } = require('../middleware/rbac');
const validate = require('../middleware/validate');
const {
  createProductSchema,
  updateProductSchema,
  softDeleteProductSchema,
  updatePriceSchema,
  adjustStockSchema,
} = require('../validators/product.validator');

router.use(protect);

// Analytics + low-stock — MUST come before /:id
router.get('/low-stock', productController.lowStock);
router.get('/analytics/by-grade', requireAdmin, productController.analyticsByGrade);
router.get('/analytics/inventory-value', requireAdmin, productController.inventoryValue);

// CRUD
router.get('/', productController.list);
router.get('/:id', productController.getById);

router.post(
  '/',
  requireAdmin,
  validate(createProductSchema, 'body'),
  productController.create
);

router.put(
  '/:id',
  requireAdmin,
  validate(updateProductSchema, 'body'),
  productController.update
);

// Specialized endpoints
router.post(
  '/:id/update-price',
  requireAdmin,
  validate(updatePriceSchema, 'body'),
  productController.updatePrice
);

router.post(
  '/:id/adjust-stock',
  allow('SUPER_ADMIN', 'ADMIN', 'BILLING'),
  validate(adjustStockSchema, 'body'),
  productController.adjustStock
);

router.post(
  '/:id/calculate-price',
  productController.calculatePrice
);

// Destructive
router.delete(
  '/:id',
  requireAdmin,
  validate(softDeleteProductSchema, 'body'),
  productController.softDelete
);

router.post('/:id/restore', requireSuperAdmin, productController.restore);
router.delete('/:id/hard-delete', requireSuperAdmin, productController.hardDelete);

module.exports = router;
