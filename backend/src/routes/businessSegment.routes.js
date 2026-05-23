const express = require('express');
const router = express.Router();

const segmentController = require('../controllers/businessSegment.controller');
const { protect } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/rbac');
const validate = require('../middleware/validate');
const {
  createBusinessSegmentSchema,
  updateBusinessSegmentSchema,
} = require('../validators/businessSegment.validator');

router.use(protect);

// Read — any authenticated user (used for dropdowns)
router.get('/', segmentController.list);
router.get('/:id', segmentController.getById);

// Write — admin only
router.post(
  '/',
  requireAdmin,
  validate(createBusinessSegmentSchema, 'body'),
  segmentController.create
);

router.put(
  '/:id',
  requireAdmin,
  validate(updateBusinessSegmentSchema, 'body'),
  segmentController.update
);

router.delete(
  '/:id',
  requireAdmin,
  segmentController.remove
);

module.exports = router;
