const express = require('express');
const router = express.Router();

const authController = require('../controllers/auth.controller');
const { authLimiter } = require('../middleware/rateLimiters');
const { protect } = require('../middleware/auth');
const validate = require('../middleware/validate');
const {
  loginSchema,
  refreshSchema,
  changePasswordSchema,
} = require('../validators/auth.validator');

router.use(authLimiter);

// Public routes with Zod validation
router.post('/login', validate(loginSchema, 'body'), authController.login);
router.post('/refresh', validate(refreshSchema, 'body'), authController.refresh);

// Protected routes
router.post('/logout', protect, authController.logout);
router.get('/me', protect, authController.getMe);
router.post(
  '/change-password',
  protect,
  validate(changePasswordSchema, 'body'),
  authController.changePassword
);

module.exports = router;
