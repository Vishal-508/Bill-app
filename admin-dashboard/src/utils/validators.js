import { z } from 'zod';

/**
 * Zod schemas used by react-hook-form via `@hookform/resolvers/zod`.
 * Kept centralized so the rules are reusable + consistent (e.g., the
 * same phone/GSTIN regex everywhere).
 */

export const loginSchema = z.object({
  email: z.string()
    .min(1, 'Email is required')
    .email('Please enter a valid email'),
  password: z.string()
    .min(8, 'Password must be at least 8 characters'),
  rememberMe: z.boolean().optional(),
});

// Future forms will extend this file (customer/product/order schemas etc.)
