const express = require('express');
const router = express.Router();

const ctrl = require('../controllers/productGrade.controller');
const { protect } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/rbac');
const validate = require('../middleware/validate');
const {
  createProductGradeSchema,
  updateProductGradeSchema,
} = require('../validators/productGrade.validator');

router.use(protect);

router.get('/', ctrl.list);
router.get('/:id', ctrl.getById);
router.post('/', requireAdmin, validate(createProductGradeSchema, 'body'), ctrl.create);
router.put('/:id', requireAdmin, validate(updateProductGradeSchema, 'body'), ctrl.update);
router.delete('/:id', requireAdmin, ctrl.remove);

module.exports = router;
