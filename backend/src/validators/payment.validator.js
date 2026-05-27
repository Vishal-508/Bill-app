const { z } = require('zod');
const mongoose = require('mongoose');

const objectIdSchema = z.string().refine(
  (val) => mongoose.Types.ObjectId.isValid(val),
  { message: 'Invalid ID format' }
);

// Initiate payment (creates Razorpay order)
const initiatePaymentSchema = z.object({
  order: objectIdSchema,
  amount: z.number().positive().max(10_000_000), // Max ₹1 crore
  notes: z.string().trim().max(500).optional(),
  bill: objectIdSchema.optional(),
});

// Verify payment (after customer pays via Razorpay)
const verifyPaymentSchema = z.object({
  paymentReference: z.string().trim().regex(/^PAY-\d{4}-[A-Z0-9]+$/),
  razorpayOrderId: z.string().trim().min(1),
  razorpayPaymentId: z.string().trim().min(1),
  razorpaySignature: z.string().trim().min(1),
});

// Cancel payment
const cancelPaymentSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

const initiateRefundSchema = z.object({
  amount: z.number().positive().optional(),
  reason: z.string().trim().min(3).max(500),
  notes: z.string().trim().max(500).optional(),
  refundType: z.enum(['full', 'partial']).optional(),
});

module.exports = {
  initiatePaymentSchema,
  verifyPaymentSchema,
  cancelPaymentSchema,
  initiateRefundSchema,
};
