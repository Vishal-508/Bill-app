const { Customer, SystemSetting, WhatsAppLog } = require('../models');
const whatsappService = require('../utils/whatsappService');
const emailService = require('../utils/emailService');
const sockets = require('../sockets');
const logger = require('../config/logger');

/**
 * Notification Orchestrator (Prompt 7 Section D).
 *
 * Fires WhatsApp + email notifications on business events. Every public
 * function is wrapped in try/catch and NEVER throws — failures here must
 * not block business logic in controllers that fire-and-forget us.
 *
 * Return shape (uniform across functions):
 *   {
 *     whatsapp: { sent, waMessageId, error, skipped },
 *     email:    { sent, isMock, error, skipped },
 *     error?:   string  // top-level catch
 *   }
 */

async function isWhatsAppEnabled() {
  return await SystemSetting.getValue('WHATSAPP_ENABLED', true);
}

async function shouldFallbackToEmail() {
  return await SystemSetting.getValue('WHATSAPP_FALLBACK_TO_EMAIL', true);
}

/**
 * Hydrate customer from bill/order if not already populated.
 */
async function resolveCustomer(entity) {
  if (!entity?.customer) return null;
  if (typeof entity.customer === 'object' && entity.customer.customerName) {
    return entity.customer;
  }
  return Customer.findById(entity.customer)
    .select('customerName phone email companyName')
    .lean();
}

/**
 * Create a WhatsAppLog (best-effort — orchestrator does not throw on log failures).
 */
async function createLog(fields) {
  try {
    return await WhatsAppLog.create(fields);
  } catch (err) {
    logger.error('orchestrator: WhatsAppLog.create failed:', err.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────
// Event: Bill generated
// ─────────────────────────────────────────────────────────
exports.onBillGenerated = async (bill) => {
  const result = { whatsapp: { sent: false }, email: { sent: false } };

  try {
    const customer = await resolveCustomer(bill);
    if (!customer) {
      result.error = 'customer_not_found';
      return result;
    }

    const enabled = await isWhatsAppEnabled();
    let waAttempted = false;

    if (enabled && customer.phone) {
      waAttempted = true;
      const pdfUrl = `${process.env.PUBLIC_API_BASE || 'https://placeholder.example.com'}/api/bills/${bill._id}/pdf`;
      const sendArgs = {
        to: customer.phone,
        templateName: 'bill_pdf_v1',
        pdfUrl,
        customerName: customer.customerName,
        billNumber: bill.billNumber,
        amount: bill.grandTotal,
        filename: `${bill.billNumber}.pdf`,
      };
      const retryContext = { sendFn: 'sendBillTemplate', args: sendArgs };
      try {
        const response = await whatsappService.sendBillTemplate(sendArgs);
        const waMessageId = response?.messages?.[0]?.id;

        await createLog({
          to: whatsappService.formatPhone(customer.phone),
          customer: customer._id,
          type: 'BILL',
          templateName: 'bill_pdf_v1',
          waMessageId,
          payload: response,
          status: 'SENT',
          relatedBill: bill._id,
          isMock: whatsappService.isMockMode(),
          retryContext,
        });

        result.whatsapp.sent = true;
        result.whatsapp.waMessageId = waMessageId;
      } catch (err) {
        result.whatsapp.error = err.message;
        await createLog({
          to: whatsappService.formatPhone(customer.phone),
          customer: customer._id,
          type: 'BILL',
          templateName: 'bill_pdf_v1',
          payload: { error: err.message },
          status: 'FAILED',
          errorMessage: err.message,
          relatedBill: bill._id,
          isMock: whatsappService.isMockMode(),
          retryContext,
        });
      }
    } else if (!enabled) {
      result.whatsapp.skipped = 'WHATSAPP_ENABLED=false';
    } else {
      result.whatsapp.skipped = 'no_phone';
    }

    // Email fallback (only if WA was disabled, skipped, or failed AND fallback ON)
    if (!result.whatsapp.sent && customer.email) {
      const fallback = await shouldFallbackToEmail();
      if (fallback) {
        try {
          const er = await emailService.sendBillEmail({
            to: customer.email,
            customerName: customer.customerName,
            invoiceNo: bill.billNumber,
            amount: bill.grandTotal,
            orderNo: bill.orderNumber,
            pdfUrl: `${process.env.PUBLIC_API_BASE || 'https://placeholder.example.com'}/api/bills/${bill._id}/pdf`,
            paymentLinkUrl: bill.paymentLinkUrl,
            // Log-context refs so EmailLog has searchable foreign keys.
            customer: customer._id,
            relatedBill: bill._id,
            relatedOrder: bill.order,
          });
          result.email.sent = !!er?.success;
          result.email.isMock = !!er?.isMock;
          if (er?.error) result.email.error = er.error;
        } catch (err) {
          result.email.error = err.message;
        }
      } else {
        result.email.skipped = 'FALLBACK_TO_EMAIL=false';
      }
    } else if (!result.whatsapp.sent && !customer.email) {
      result.email.skipped = 'no_email';
    } else {
      result.email.skipped = 'whatsapp_succeeded';
    }
  } catch (err) {
    result.error = err.message;
    logger.error('onBillGenerated failed:', { billId: bill?._id, error: err.message });
  }

  return result;
};

// ─────────────────────────────────────────────────────────
// Event: Payment captured (Razorpay)
// ─────────────────────────────────────────────────────────
exports.onPaymentReceived = async (payment, bill) => {
  const result = { whatsapp: { sent: false }, email: { sent: false } };

  try {
    if (!payment) {
      result.error = 'payment_required';
      return result;
    }

    // Fire-and-forget real-time broadcast (Prompt 9 Section B).
    // Single source of truth: both Razorpay webhook and any future manual
    // payment confirmation path call this orchestrator, so the socket emit
    // lives here (not duplicated in each caller). safeEmit catches throws.
    sockets.emitPaymentReceived(payment, bill);

    // Payment has customer ObjectId — hydrate
    const customer = await Customer.findById(payment.customer)
      .select('customerName phone email')
      .lean();
    if (!customer) {
      result.error = 'customer_not_found';
      return result;
    }

    const enabled = await isWhatsAppEnabled();

    if (enabled && customer.phone) {
      // Free-text needs 24h customer-service window (last INBOUND from customer).
      const lastInbound = await WhatsAppLog.findOne({
        customer: customer._id,
        type: 'INBOUND',
      }).sort({ createdAt: -1 }).select('createdAt').lean();

      const inWindow = lastInbound &&
        (Date.now() - new Date(lastInbound.createdAt).getTime()) <= 24 * 60 * 60 * 1000;

      if (!inWindow) {
        // No approved "payment_received" template in spec yet — skip WA, fall to email.
        result.whatsapp.skipped = lastInbound ? 'outside_24h_window' : 'no_inbound_history';
      } else {
        const amountRupees = (payment.amount / 100).toFixed(2);
        const text = `Payment received: ₹${amountRupees}` +
          (bill?.billNumber ? ` for ${bill.billNumber}` : '') +
          `. Thank you!`;
        const retryContext = { sendFn: 'sendTextMessage', args: { to: customer.phone, text } };
        try {
          const response = await whatsappService.sendTextMessage(customer.phone, text);
          const waMessageId = response?.messages?.[0]?.id;

          await createLog({
            to: whatsappService.formatPhone(customer.phone),
            customer: customer._id,
            type: 'TEXT',
            waMessageId,
            payload: { text: { body: text }, response },
            status: 'SENT',
            relatedBill: bill?._id,
            isMock: whatsappService.isMockMode(),
            retryContext,
          });

          result.whatsapp.sent = true;
          result.whatsapp.waMessageId = waMessageId;
        } catch (err) {
          result.whatsapp.error = err.message;
        }
      }
    } else if (!enabled) {
      result.whatsapp.skipped = 'WHATSAPP_ENABLED=false';
    } else {
      result.whatsapp.skipped = 'no_phone';
    }

    // Email fallback for payment receipt
    if (!result.whatsapp.sent && customer.email) {
      const fallback = await shouldFallbackToEmail();
      if (fallback) {
        try {
          const er = await emailService.sendPaymentReceiptEmail({
            to: customer.email,
            customerName: customer.customerName,
            amount: (payment.amount / 100).toFixed(2),
            invoiceNo: bill?.billNumber,
            paymentMode: payment.method,
            paymentDate: payment.capturedAt || new Date(),
            customer: customer._id,
            relatedBill: bill?._id,
            relatedOrder: payment.order,
          });
          result.email.sent = !!er?.success;
          result.email.isMock = !!er?.isMock;
          if (er?.error) result.email.error = er.error;
        } catch (err) {
          result.email.error = err.message;
        }
      } else {
        result.email.skipped = 'FALLBACK_TO_EMAIL=false';
      }
    } else if (!result.whatsapp.sent && !customer.email) {
      result.email.skipped = 'no_email';
    } else {
      result.email.skipped = 'whatsapp_succeeded';
    }
  } catch (err) {
    result.error = err.message;
    logger.error('onPaymentReceived failed:', { paymentId: payment?._id, error: err.message });
  }

  return result;
};

// ─────────────────────────────────────────────────────────
// Event: Order ready for pickup/delivery
// ─────────────────────────────────────────────────────────
exports.onOrderReady = async (order) => {
  const result = { whatsapp: { sent: false }, email: { sent: false } };

  try {
    const customer = await resolveCustomer(order);
    if (!customer) {
      result.error = 'customer_not_found';
      return result;
    }

    const enabled = await isWhatsAppEnabled();

    if (enabled && customer.phone) {
      const sendArgs = {
        to: customer.phone,
        templateName: 'order_ready_v1',
        customerName: customer.customerName,
        orderNumber: order.orderNumber,
      };
      const retryContext = { sendFn: 'sendOrderReadyTemplate', args: sendArgs };
      try {
        const response = await whatsappService.sendOrderReadyTemplate(sendArgs);
        const waMessageId = response?.messages?.[0]?.id;

        await createLog({
          to: whatsappService.formatPhone(customer.phone),
          customer: customer._id,
          type: 'ORDER_READY',
          templateName: 'order_ready_v1',
          waMessageId,
          payload: response,
          status: 'SENT',
          relatedOrder: order._id,
          isMock: whatsappService.isMockMode(),
          retryContext,
        });

        result.whatsapp.sent = true;
        result.whatsapp.waMessageId = waMessageId;
      } catch (err) {
        result.whatsapp.error = err.message;
        await createLog({
          to: whatsappService.formatPhone(customer.phone),
          customer: customer._id,
          type: 'ORDER_READY',
          templateName: 'order_ready_v1',
          payload: { error: err.message },
          status: 'FAILED',
          errorMessage: err.message,
          relatedOrder: order._id,
          isMock: whatsappService.isMockMode(),
          retryContext,
        });
      }
    } else if (!enabled) {
      result.whatsapp.skipped = 'WHATSAPP_ENABLED=false';
    } else {
      result.whatsapp.skipped = 'no_phone';
    }

    if (!result.whatsapp.sent && customer.email) {
      const fallback = await shouldFallbackToEmail();
      if (fallback) {
        try {
          const er = await emailService.sendOrderReadyEmail({
            to: customer.email,
            customerName: customer.customerName,
            orderNo: order.orderNumber,
            total: order.totalAmount,
            customer: customer._id,
            relatedOrder: order._id,
          });
          result.email.sent = !!er?.success;
          result.email.isMock = !!er?.isMock;
          if (er?.error) result.email.error = er.error;
        } catch (err) {
          result.email.error = err.message;
        }
      } else {
        result.email.skipped = 'FALLBACK_TO_EMAIL=false';
      }
    } else if (!result.whatsapp.sent && !customer.email) {
      result.email.skipped = 'no_email';
    } else {
      result.email.skipped = 'whatsapp_succeeded';
    }
  } catch (err) {
    result.error = err.message;
    logger.error('onOrderReady failed:', { orderId: order?._id, error: err.message });
  }

  return result;
};

// ─────────────────────────────────────────────────────────
// Event: Order confirmation (typically customer-placed orders)
// ─────────────────────────────────────────────────────────
exports.onOrderConfirmation = async (order) => {
  const result = { whatsapp: { sent: false }, email: { sent: false } };

  try {
    const customer = await resolveCustomer(order);
    if (!customer) {
      result.error = 'customer_not_found';
      return result;
    }

    const enabled = await isWhatsAppEnabled();

    if (enabled && customer.phone) {
      const sendArgs = {
        to: customer.phone,
        templateName: 'order_confirmation_v1',
        customerName: customer.customerName,
        orderNumber: order.orderNumber,
        totalAmount: order.totalAmount,
      };
      const retryContext = { sendFn: 'sendOrderConfirmationTemplate', args: sendArgs };
      try {
        const response = await whatsappService.sendOrderConfirmationTemplate(sendArgs);
        const waMessageId = response?.messages?.[0]?.id;

        await createLog({
          to: whatsappService.formatPhone(customer.phone),
          customer: customer._id,
          type: 'ORDER_CONFIRMATION',
          templateName: 'order_confirmation_v1',
          waMessageId,
          payload: response,
          status: 'SENT',
          relatedOrder: order._id,
          isMock: whatsappService.isMockMode(),
          retryContext,
        });

        result.whatsapp.sent = true;
        result.whatsapp.waMessageId = waMessageId;
      } catch (err) {
        result.whatsapp.error = err.message;
        await createLog({
          to: whatsappService.formatPhone(customer.phone),
          customer: customer._id,
          type: 'ORDER_CONFIRMATION',
          templateName: 'order_confirmation_v1',
          payload: { error: err.message },
          status: 'FAILED',
          errorMessage: err.message,
          relatedOrder: order._id,
          isMock: whatsappService.isMockMode(),
          retryContext,
        });
      }
    } else if (!enabled) {
      result.whatsapp.skipped = 'WHATSAPP_ENABLED=false';
    } else {
      result.whatsapp.skipped = 'no_phone';
    }

    if (!result.whatsapp.sent && customer.email) {
      const fallback = await shouldFallbackToEmail();
      if (fallback) {
        try {
          const er = await emailService.sendOrderConfirmationEmail({
            to: customer.email,
            customerName: customer.customerName,
            orderNo: order.orderNumber,
            itemsSummary: Array.isArray(order.items) && order.items.length
              ? `${order.items.length} item(s)` : undefined,
            estimatedReady: undefined, // future enhancement
            customer: customer._id,
            relatedOrder: order._id,
          });
          result.email.sent = !!er?.success;
          result.email.isMock = !!er?.isMock;
          if (er?.error) result.email.error = er.error;
        } catch (err) {
          result.email.error = err.message;
        }
      } else {
        result.email.skipped = 'FALLBACK_TO_EMAIL=false';
      }
    } else if (!result.whatsapp.sent && !customer.email) {
      result.email.skipped = 'no_email';
    } else {
      result.email.skipped = 'whatsapp_succeeded';
    }
  } catch (err) {
    result.error = err.message;
    logger.error('onOrderConfirmation failed:', { orderId: order?._id, error: err.message });
  }

  return result;
};

// Common fire-and-forget logger for controller wiring
exports.noop = (err) => {
  if (err) logger.warn('Notification orchestrator (non-blocking):', err?.message || err);
};
