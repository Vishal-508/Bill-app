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

// ─── Shared building blocks ───
// Reused inside customer + future vendor/order schemas.

const phoneRegex = /^[6-9]\d{9}$/;
const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[0-9A-Z]{1}Z[0-9A-Z]{1}$/;
const pincodeRegex = /^[1-9][0-9]{5}$/;
const stateCodeRegex = /^\d{2}$/;

export const phoneField = z.string()
  .regex(phoneRegex, 'Invalid Indian mobile number');

// Optional phone — accepts empty string OR a valid mobile.
export const optionalPhoneField = z.union([
  z.literal(''),
  z.string().regex(phoneRegex, 'Invalid Indian mobile number'),
]).optional();

export const optionalEmailField = z.union([
  z.literal(''),
  z.string().email('Invalid email format'),
]).optional();

export const addressFieldsSchema = z.object({
  line1:     z.string().trim().min(3, 'Address line 1 is required').max(200),
  line2:     z.string().trim().max(200).optional().or(z.literal('')),
  city:      z.string().trim().min(2, 'City is required').max(100),
  state:     z.string().trim().min(2, 'State is required').max(100),
  stateCode: z.string().trim().regex(stateCodeRegex, '2-digit state code'),
  pincode:   z.string().trim().regex(pincodeRegex, 'Invalid 6-digit pincode'),
});

// ─── Customer create/update schema ───
// Matches backend's createCustomerSchema (validators/customer.validator.js):
//   - field is `customerName` not `name`
//   - address is nested under `billingAddress` (not flat)
//   - billType is FRONTEND-ONLY (drives GSTIN visibility); we strip
//     it before sending to the API
//   - GSTIN required IFF billType === 'GST', enforced via refine()
export const customerSchema = z.object({
  customerName:    z.string().trim().min(2, 'Name must be at least 2 characters').max(100),
  companyName:     z.string().trim().max(200).optional().or(z.literal('')),
  phone:           phoneField,
  altPhone:        optionalPhoneField,
  email:           optionalEmailField,

  billType:        z.enum(['GST', 'NON_GST']),
  gstin:           z.string().trim().toUpperCase().optional().or(z.literal('')),

  billingAddress:  addressFieldsSchema,

  creditLimit:     z.coerce.number().min(0, 'Credit limit cannot be negative').optional(),
  notes:           z.string().trim().max(500, 'Notes must be under 500 characters')
                       .optional().or(z.literal('')),
}).superRefine((data, ctx) => {
  if (data.billType === 'GST') {
    if (!data.gstin) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['gstin'],
        message: 'GSTIN is required for GST customers',
      });
    } else if (!gstinRegex.test(data.gstin)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['gstin'],
        message: 'Invalid GSTIN format',
      });
    }
  }
});

// Export regexes for the form's runtime UX (auto-uppercase, mask, etc.)
export const _patterns = { phoneRegex, gstinRegex, pincodeRegex, stateCodeRegex };

// ─── Order line item ───
// FORM shape only — submit-time we transform discountMode + discountValue
// into the backend's split (discountPct vs discountAmount) and stamp
// itemType + lineSubtotal. See OrderFormModal's onSubmit.
export const orderItemSchema = z.object({
  product: z.string().min(1, 'Product is required'),
  // Snapshot is local-only state used to render the picked-product card;
  // not sent to the backend. .passthrough() so RHF doesn't complain.
  productSnapshot: z.any().optional(),
  quantity: z.coerce.number().int('Quantity must be a whole number').positive('Quantity must be ≥ 1'),
  pricePerUnit: z.coerce.number().nonnegative('Price cannot be negative'),
  discountMode: z.enum(['percent', 'amount']).default('percent'),
  discountValue: z.coerce.number().nonnegative().default(0),
  notes: z.string().trim().max(500).optional().or(z.literal('')),
});

// ─── Order schema (form-shape) ───
// CustomerStateCode is captured into the form so the GST calculator can
// pick CGST+SGST vs IGST; it's NOT a backend field, derived from
// customer.billingAddress.stateCode on selection.
export const orderSchema = z.object({
  customer:               z.string().min(1, 'Customer is required'),
  customerStateCode:      z.string().optional().or(z.literal('')),
  orderDate:              z.string().min(1, 'Order date is required'),
  expectedDeliveryDate:   z.string().optional().or(z.literal('')),
  items:                  z.array(orderItemSchema).min(1, 'Add at least one item'),
  gstRatePct:             z.coerce.number().min(0).max(100).default(18),

  // Order-level discount
  orderDiscountMode:      z.enum(['percent', 'amount']).default('amount'),
  orderDiscountValue:     z.coerce.number().nonnegative().default(0),
  discountReason:         z.string().trim().max(500).optional().or(z.literal('')),

  // Toggles
  roundOff:               z.boolean().default(false),
  hasGstBill:             z.boolean().default(true),
  deliveryMethod:         z.enum(['PICKUP', 'DELIVERY']).default('PICKUP'),
  paymentMode:            z.enum(['FULL_UPFRONT', 'PARTIAL', 'CREDIT']).default('FULL_UPFRONT'),

  // Notes
  customerNotes:          z.string().trim().max(2000).optional().or(z.literal('')),
  internalNotes:          z.string().trim().max(2000).optional().or(z.literal('')),
}).superRefine((data, ctx) => {
  // discountReason required when an order-level discount is applied
  const hasDiscount = (+data.orderDiscountValue || 0) > 0;
  if (hasDiscount && (!data.discountReason || data.discountReason.trim().length < 3)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['discountReason'],
      message: 'Reason required (≥3 chars) when applying a discount',
    });
  }
});
