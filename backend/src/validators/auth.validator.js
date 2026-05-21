const { z } = require('zod');

// Password rules: min 8 chars, at least 1 uppercase, 1 lowercase, 1 number
// Special chars optional but allowed
const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password is too long')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number');

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Invalid email format')
  .max(255, 'Email is too long');

const phoneSchema = z
  .string()
  .trim()
  .regex(/^[6-9]\d{9}$/, 'Phone must be a valid 10-digit Indian mobile number')
  .optional();

// Login: simple — email + password (no strength check on login, only registration)
const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required'),
});

// Register (admin creates staff): strict password requirements
const registerSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(100),
  email: emailSchema,
  password: passwordSchema,
  phone: phoneSchema,
  role: z.enum(['SUPER_ADMIN', 'ADMIN', 'BILLING', 'CUTTING', 'DELIVERY']).default('CUTTING'),
});

// Refresh token request
const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

// Change password
const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: passwordSchema,
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: 'New password must be different from current password',
    path: ['newPassword'],
  });

module.exports = {
  loginSchema,
  registerSchema,
  refreshSchema,
  changePasswordSchema,
  // Export the building blocks too for reuse in other validators later
  emailSchema,
  passwordSchema,
  phoneSchema,
};
