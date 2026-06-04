const express = require('express');
const router = express.Router();

const ctrl = require('../controllers/vendor.controller');
const { protect } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/rbac');
const validate = require('../middleware/validate');
const {
  vendorCreateSchema,
  vendorUpdateSchema,
  vendorQuerySchema,
} = require('../validators/vendor.validator');

router.use(protect);

router.get('/', validate(vendorQuerySchema, 'query'), ctrl.list);
router.post('/', requireAdmin, validate(vendorCreateSchema), ctrl.create);

// Literal sub-paths BEFORE /:id
router.post('/:id/restore', requireAdmin, ctrl.restore);

// Then the param-based routes
router.get('/:id', ctrl.getOne);
router.patch('/:id', requireAdmin, validate(vendorUpdateSchema), ctrl.update);
router.delete('/:id', requireAdmin, ctrl.softDelete);

module.exports = router;
