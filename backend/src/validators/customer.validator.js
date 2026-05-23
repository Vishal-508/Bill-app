const { z } = require('zod');
const mongoose = require('mongoose');

const objectIdSchema = z.string().refine(
  (val) => mongoose.Types.ObjectId.isValid(val),
  { message: 'Invalid ID format' }
);

const phoneSchema = z
  .string()
  .trim()
  .regex(/^[6-9]\d{9}$/, 'Must be a valid 10-digit Indian mobile number');

const optionalPhoneSchema = phoneSchema.optional().or(z.literal(''));

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Invalid email format')
  .optional()
  .or(z.literal(''));

const gstinSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(
    /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[0-9A-Z]{1}Z[0-9A-Z]{1}$/,
    'Invalid GSTIN format'
  )
  .optional()
  .or(z.literal(''));

const pincodeSchema = z
  .string()
  .trim()
  .regex(/^[1-9][0-9]{5}$/, 'Invalid Indian pincode')
  .optional()
  .or(z.literal(''));

const addressSchema = z
  .object({
    line1: z.string().trim().max(200).optional(),
    line2: z.string().trim().max(200).optional(),
    landmark: z.string().trim().max(100).optional(),
    city: z.string().trim().max(100).optional(),
    state: z.string().trim().max(100).optional(),
    stateCode: z.string().trim().max(2).optional(),
    pincode: pincodeSchema,
    country: z.string().trim().default('India').optional(),
  })
  .optional();

const createCustomerSchema = z.object({
  // Identity
  companyName: z.string().trim().max(200).optional(),
  customerName: z.string().trim().min(2, 'Name must be 2+ chars').max(100),
  phone: phoneSchema,
  altPhone: optionalPhoneSchema,
  email: emailSchema,

  // Business
  businessSegment: objectIdSchema.optional(),
  businessSubSegment: z.string().trim().max(200).optional(),
  businessSize: z.enum(['INDIVIDUAL', 'SMALL', 'MEDIUM', 'LARGE']).default('INDIVIDUAL'),
  gstin: gstinSchema,

  // Acquisition
  acquisitionSource: z
    .enum([
      'WALK_IN', 'REFERRAL', 'GOOGLE', 'JUSTDIAL', 'INDIAMART',
      'WHATSAPP', 'SOCIAL_MEDIA', 'EXHIBITION', 'EXISTING_CUSTOMER',
      'PHONE_INQUIRY', 'OTHER',
    ])
    .default('WALK_IN'),
  referredBy: objectIdSchema.optional(),

  // Addresses
  billingAddress: addressSchema,
  shippingAddress: addressSchema,
  shippingSameAsBilling: z.boolean().default(true),

  // Tags
  tags: z.array(z.string().trim().max(50)).max(10).default([]),

  // Pricing & Credit
  preferredUnit: z.enum(['sqft', 'sqinch', 'sheet']).default('sqft'),
  specialDiscountPct: z.number().min(0).max(100).default(0),
  creditLimit: z.number().min(0).default(0),

  // Communication
  communicationPrefs: z
    .object({
      whatsappEnabled: z.boolean().default(true),
      emailEnabled: z.boolean().default(true),
      smsEnabled: z.boolean().default(false),
      callPreferredTime: z.string().trim().max(50).optional(),
    })
    .optional(),

  // Admin notes
  notes: z.string().trim().max(2000).optional(),
});

// Update schema = all fields optional (partial update)
const updateCustomerSchema = createCustomerSchema.partial();

// Soft delete schema
const softDeleteCustomerSchema = z.object({
  reason: z.string().trim().min(3, 'Reason must be 3+ chars').max(500),
});

// ─── Bulk operation schemas ───
const objectIdArraySchema = z
  .array(objectIdSchema)
  .min(1, 'At least one customer ID required')
  .max(500, 'Maximum 500 customers per bulk operation');

const bulkUpdateSchema = z.object({
  customerIds: objectIdArraySchema,
  updates: z.object({
    isActive: z.boolean().optional(),
    businessSegment: objectIdSchema.optional(),
    businessSize: z.enum(['INDIVIDUAL', 'SMALL', 'MEDIUM', 'LARGE']).optional(),
    creditLimit: z.number().min(0).optional(),
    specialDiscountPct: z.number().min(0).max(100).optional(),
    preferredUnit: z.enum(['sqft', 'sqinch', 'sheet']).optional(),
    tags: z.object({
      add: z.array(z.string().trim().max(50)).optional(),
      remove: z.array(z.string().trim().max(50)).optional(),
      set: z.array(z.string().trim().max(50)).max(10).optional(),
    }).optional(),
    notes: z.string().trim().max(2000).optional(),
  }).refine((data) => Object.keys(data).length > 0, {
    message: 'At least one update field required',
  }),
});

const bulkDeleteSchema = z.object({
  customerIds: objectIdArraySchema,
  reason: z.string().trim().min(3).max(500),
});

const bulkRestoreSchema = z.object({
  customerIds: objectIdArraySchema,
});

const bulkTagSchema = z.object({
  customerIds: objectIdArraySchema,
  tag: z.string().trim().min(1).max(50),
});

module.exports = {
  createCustomerSchema,
  updateCustomerSchema,
  softDeleteCustomerSchema,
  bulkUpdateSchema,
  bulkDeleteSchema,
  bulkRestoreSchema,
  bulkTagSchema,
  // Re-export building blocks for reuse
  phoneSchema,
  emailSchema,
  gstinSchema,
  addressSchema,
};
