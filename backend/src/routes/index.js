const express = require('express');
const router = express.Router();

const authRoutes = require('./auth.routes');

router.use('/auth', authRoutes);

// Future routes will mount here:
// router.use('/customers', customerRoutes);
// router.use('/products', productRoutes);
// router.use('/orders', orderRoutes);

module.exports = router;
