const express = require('express');
const router = express.Router();

const ctrl = require('../controllers/productAttribute.controller');
const { protect } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/rbac');
const validate = require('../middleware/validate');
const {
  createProductAttributeSchema,
  updateProductAttributeSchema,
} = require('../validators/productAttribute.validator');

router.use(protect);

router.get('/', ctrl.list);
router.get('/:id', ctrl.getById);
router.post('/', requireAdmin, validate(createProductAttributeSchema, 'body'), ctrl.create);
router.put('/:id', requireAdmin, validate(updateProductAttributeSchema, 'body'), ctrl.update);
router.delete('/:id', requireAdmin, ctrl.remove);

module.exports = router;
