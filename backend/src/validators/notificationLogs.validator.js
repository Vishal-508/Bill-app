const { z } = require('zod');
const mongoose = require('mongoose');

const objectIdSchema = z.string().refine(
  (val) => mongoose.Types.ObjectId.isValid(val),
  { message: 'Invalid ID format' }
);

const optionalObjectId = objectIdSchema.optional().or(z.literal('').transform(() => undefined));
const optionalIsoDate = z.string().optional().refine(
  (val) => !val || !Number.isNaN(new Date(val).getTime()),
  { message: 'Invalid date (expecting ISO 8601 or YYYY-MM-DD)' }
);

const WHATSAPP_TYPES = ['BILL', 'PAYMENT_LINK', 'ORDER_CONFIRMATION', 'ORDER_READY', 'TEXT', 'INBOUND'];
const EMAIL_TYPES = ['BILL', 'PAYMENT_LINK', 'ORDER_CONFIRMATION', 'ORDER_READY', 'PAYMENT_RECEIPT', 'TEXT'];

const WHATSAPP_STATUSES = ['SENT', 'DELIVERED', 'READ', 'FAILED', 'PERMANENTLY_FAILED'];
const EMAIL_STATUSES = ['SENT', 'FAILED', 'BOUNCED', 'PERMANENTLY_FAILED'];

/**
 * Shared base query schema used by WhatsApp + email log endpoints.
 * Caller picks which `type`/`status` enum to validate.
 */
function buildLogsQuerySchema({ types, statuses }) {
  return z.object({
    page: z.coerce.number().int().min(1).default(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20).optional(),
    type: z.union([z.enum(types), z.literal('all')]).optional(),
    status: z.union([z.enum(statuses), z.literal('all')]).optional(),
    customer: optionalObjectId,
    relatedBill: optionalObjectId,
    relatedOrder: optionalObjectId,
    dateFrom: optionalIsoDate,
    dateTo: optionalIsoDate,
    search: z.string().trim().max(200).optional(),
  }).passthrough(); // tolerate unknown query params (e.g., cache busters)
}

module.exports = {
  whatsappLogsQuerySchema: buildLogsQuerySchema({
    types: WHATSAPP_TYPES,
    statuses: WHATSAPP_STATUSES,
  }),
  emailLogsQuerySchema: buildLogsQuerySchema({
    types: EMAIL_TYPES,
    statuses: EMAIL_STATUSES,
  }),
  WHATSAPP_TYPES,
  WHATSAPP_STATUSES,
  EMAIL_TYPES,
  EMAIL_STATUSES,
};
