const express = require('express');
const router = express.Router();

const ctrl = require('../controllers/purchase.controller');
const { protect } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/rbac');
const validate = require('../middleware/validate');
const {
  purchaseCreateSchema,
  purchaseUpdateSchema,
  purchaseReceiveSchema,
  purchaseCancelSchema,
  purchaseQuerySchema,
} = require('../validators/purchase.validator');

router.use(protect);

router.get('/', validate(purchaseQuerySchema, 'query'), ctrl.list);
router.post('/', requireAdmin, validate(purchaseCreateSchema), ctrl.create);

// Literals BEFORE /:id
router.get('/stats', requireAdmin, ctrl.stats);
router.post('/:id/order', requireAdmin, ctrl.markOrdered);
router.post('/:id/receive', requireAdmin, validate(purchaseReceiveSchema), ctrl.receive);
router.post('/:id/cancel', requireAdmin, validate(purchaseCancelSchema), ctrl.cancel);

// Param-based
router.get('/:id', ctrl.getOne);
router.patch('/:id', requireAdmin, validate(purchaseUpdateSchema), ctrl.update);

module.exports = router;
