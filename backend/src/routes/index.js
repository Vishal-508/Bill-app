const express = require('express');
const router = express.Router();

const authRoutes = require('./auth.routes');
const customerRoutes = require('./customer.routes');
const segmentRoutes = require('./businessSegment.routes');
const productRoutes = require('./product.routes');
const gradeRoutes = require('./productGrade.routes');
const attributeRoutes = require('./productAttribute.routes');

router.use('/auth', authRoutes);
router.use('/customers', customerRoutes);
router.use('/business-segments', segmentRoutes);
router.use('/products', productRoutes);
router.use('/product-grades', gradeRoutes);
router.use('/product-attributes', attributeRoutes);

module.exports = router;
