const { z } = require('zod');
const mongoose = require('mongoose');

const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[0-9A-Z]{1}Z[0-9A-Z]{1}$/;
const PINCODE_REGEX = /^[1-9][0-9]{5}$/;
const PHONE_REGEX = /^[6-9]\d{9}$/;

const objectIdSchema = z.string().refine(
  (v) => mongoose.Types.ObjectId.isValid(v),
  { message: 'Invalid ObjectId' }
);

const addressSchema = z.object({
  line1: z.string().trim().max(200).optional(),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().max(100).optional(),
  state: z.string().trim().max(100).optional(),
  stateCode: z.string().trim().max(5).optional(),
  pincode: z.string().trim().refine((v) => !v || PINCODE_REGEX.test(v),
    { message: 'Invalid pincode (6 digits, starting 1-9)' }).optional(),
}).partial().optional();

exports.vendorCreateSchema = z.object({
  name: z.string().trim().min(2).max(200),
  companyName: z.string().trim().max(200).optional(),
  phone: z.string().refine((v) => !v || PHONE_REGEX.test(v),
    { message: 'Invalid phone (10 digits, starting 6-9)' }).optional(),
  email: z.string().email().toLowerCase().optional().or(z.literal('').transform(() => undefined)),
  gstin: z.string().trim().toUpperCase().refine((v) => !v || GSTIN_REGEX.test(v),
    { message: 'Invalid GSTIN format' }).optional().or(z.literal('').transform(() => undefined)),
  address: addressSchema,
  products: z.array(objectIdSchema).optional(),
  avgLeadTimeDays: z.number().int().min(0).max(365).optional(),
  paymentTerms: z.string().trim().max(100).optional(),
  notes: z.string().trim().max(2000).optional(),
}).passthrough();

// PATCH excludes GSTIN — immutability enforced in controller (since the user
// can SET an empty GSTIN to a value, but can't CHANGE an existing one).
// We keep gstin in the schema so the controller can apply the conditional rule.
exports.vendorUpdateSchema = z.object({
  name: z.string().trim().min(2).max(200).optional(),
  companyName: z.string().trim().max(200).optional(),
  phone: z.string().refine((v) => !v || PHONE_REGEX.test(v),
    { message: 'Invalid phone' }).optional(),
  email: z.string().email().toLowerCase().optional().or(z.literal('').transform(() => undefined)),
  gstin: z.string().trim().toUpperCase().refine((v) => !v || GSTIN_REGEX.test(v),
    { message: 'Invalid GSTIN format' }).optional(),
  address: addressSchema,
  products: z.array(objectIdSchema).optional(),
  avgLeadTimeDays: z.number().int().min(0).max(365).optional(),
  paymentTerms: z.string().trim().max(100).optional(),
  notes: z.string().trim().max(2000).optional(),
  isActive: z.boolean().optional(),
}).passthrough();

exports.vendorQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(20).optional(),
  search: z.string().trim().max(200).optional(),
  hasGstin: z.enum(['true', 'false', 'all']).default('all').optional(),
  city: z.string().trim().max(100).optional(),
  state: z.string().trim().max(100).optional(),
  isActive: z.enum(['true', 'false', 'all']).default('all').optional(),
  includeDeleted: z.enum(['true', 'false']).default('false').optional(),
  sortBy: z.enum(['createdAt', 'name']).default('createdAt').optional(),
  sortOrder: z.enum(['asc', 'desc']).default('desc').optional(),
}).passthrough();
