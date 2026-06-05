const { Server } = require('socket.io');
const { User } = require('../models');
const { verifyAccessToken } = require('../utils/jwt');
const logger = require('../config/logger');

/**
 * Socket.IO server initialization + emit helpers (Prompt 9 Section A).
 *
 * Design:
 *   - Singleton io instance, set by init(httpServer) at boot time
 *   - JWT auth middleware on connection (socket.handshake.auth.token)
 *   - Connections auto-join `role:${role}` and `user:${userId}` rooms
 *   - Clients can subscribe to broadcast rooms via 'subscribe:*' events
 *
 * Defensive contract: every emitX() helper checks `io` and silently
 * no-ops + logs if the server isn't initialized. This keeps controllers
 * fire-and-forget safe in test environments where the HTTP server may
 * not be running.
 */

let io = null;

// ─── Room name constants (so controllers and tests use the same strings) ───
exports.ROOMS = {
  ORDERS_ALL: 'orders:all',
  INVENTORY_ALL: 'inventory:all',
  DASHBOARD: 'dashboard',
  ROLE: (role) => `role:${role}`,
  USER: (userId) => `user:${userId}`,
};

// ─── Auth middleware ───

async function authMiddleware(socket, next) {
  try {
    const token = socket.handshake.auth?.token ||
                  socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i, '');
    if (!token) {
      return next(new Error('Authentication required: missing token'));
    }

    let decoded;
    try {
      decoded = verifyAccessToken(token);
    } catch (err) {
      return next(new Error(`Authentication failed: ${err.message}`));
    }

    const user = await User.findById(decoded.sub);
    if (!user) return next(new Error('Authentication failed: user not found'));
    if (!user.isActive) return next(new Error('Authentication failed: user is inactive'));
    if (user.isLocked && user.isLocked()) {
      return next(new Error('Authentication failed: account locked'));
    }

    socket.user = {
      _id: String(user._id),
      email: user.email,
      role: user.role,
      name: user.name,
    };
    next();
  } catch (err) {
    logger.error('[socket:auth] middleware error:', err.message);
    next(new Error('Authentication error'));
  }
}

// ─── Connection handler ───

function onConnection(socket) {
  const { _id, email, role } = socket.user;
  logger.info(`[socket] connected ${email} (${role}) — id=${socket.id}`);

  // Auto-join role + user rooms
  socket.join(exports.ROOMS.ROLE(role));
  socket.join(exports.ROOMS.USER(_id));

  // ─── Subscribe events ───

  socket.on('subscribe:orders', (ack) => {
    socket.join(exports.ROOMS.ORDERS_ALL);
    if (typeof ack === 'function') ack({ ok: true, room: exports.ROOMS.ORDERS_ALL });
  });

  socket.on('subscribe:dashboard', (ack) => {
    socket.join(exports.ROOMS.DASHBOARD);
    if (typeof ack === 'function') ack({ ok: true, room: exports.ROOMS.DASHBOARD });
  });

  socket.on('subscribe:inventory', (ack) => {
    if (!['ADMIN', 'SUPER_ADMIN'].includes(role)) {
      if (typeof ack === 'function') ack({ ok: false, error: 'admin only' });
      return;
    }
    socket.join(exports.ROOMS.INVENTORY_ALL);
    if (typeof ack === 'function') ack({ ok: true, room: exports.ROOMS.INVENTORY_ALL });
  });

  socket.on('disconnect', (reason) => {
    logger.info(`[socket] disconnected ${email} — reason=${reason} id=${socket.id}`);
  });
}

// ─── Public: init Socket.IO server ───

/**
 * Attach Socket.IO to the given http.Server instance.
 * Idempotent — second call returns the existing instance.
 */
exports.init = (httpServer, opts = {}) => {
  if (io) return io;

  const allowedOrigins = [
    process.env.FRONTEND_ADMIN_URL,
    process.env.FRONTEND_CUSTOMER_URL,
  ].filter(Boolean);

  io = new Server(httpServer, {
    cors: {
      origin: opts.cors?.origin || (allowedOrigins.length ? allowedOrigins : true),
      credentials: true,
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 30000,
    pingInterval: 25000,
  });

  io.use(authMiddleware);
  io.on('connection', onConnection);

  logger.info(`[socket] Socket.IO initialized (origins=${allowedOrigins.length ? allowedOrigins.join(',') : 'any'})`);
  return io;
};

/**
 * Get current io instance (or null if not initialized).
 */
exports.getIO = () => io;

/**
 * Test-only: reset the singleton so a fresh init() can take effect.
 */
exports._reset = () => {
  if (io) {
    try { io.close(); } catch {}
  }
  io = null;
};

// ─── Emit helpers ───
// Every helper is defensive: io === null → log + skip. This keeps
// controllers safe in test/CI environments where the socket server
// may not be running.

/**
 * Build the target + emit. Critical: do NOT evaluate `io.to(...)` at the
 * CALL site of safeEmit — if io is null, that throws before safeEmit can
 * intercept. Pass room names as strings and let safeEmit construct the
 * target chain after the null check.
 */
function safeEmit(rooms, event, payload) {
  if (!io) {
    logger.debug(`[socket] skip emit ${event} (io not initialized)`);
    return false;
  }
  try {
    const roomList = Array.isArray(rooms) ? rooms : [rooms];
    let target = io;
    for (const room of roomList) {
      target = target.to(room);
    }
    target.emit(event, payload);
    return true;
  } catch (err) {
    logger.error(`[socket] emit ${event} failed:`, err.message);
    return false;
  }
}

exports.emitOrderNew = (order) => {
  if (!order) return false;
  const payload = {
    orderId: order._id,
    orderNumber: order.orderNumber,
    customer: order.customer
      ? {
          name: order.customer.customerName || order.customerInfo?.customerName,
          phone: order.customer.phone || order.customerInfo?.phone,
          companyName: order.customer.companyName,
        }
      : null,
    grandTotal: order.totalAmount,
    itemsCount: Array.isArray(order.items) ? order.items.length : 0,
    createdAt: order.createdAt,
  };
  return safeEmit(exports.ROOMS.ORDERS_ALL, 'order:new', payload);
};

exports.emitOrderUpdated = (order) => {
  if (!order) return false;
  const payload = {
    orderId: order._id,
    orderNumber: order.orderNumber,
    status: order.status,
    paymentStatus: order.paymentStatus,
    updatedAt: order.updatedAt || new Date(),
  };
  return safeEmit(exports.ROOMS.ORDERS_ALL, 'order:updated', payload);
};

exports.emitOrderStatusChanged = (order, oldStatus) => {
  if (!order) return false;
  const payload = {
    orderId: order._id,
    orderNumber: order.orderNumber,
    oldStatus,
    newStatus: order.status,
    changedAt: new Date(),
  };
  return safeEmit(exports.ROOMS.ORDERS_ALL, 'order:status-changed', payload);
};

exports.emitPaymentReceived = (payment, bill) => {
  if (!payment) return false;
  const amountRupees = typeof payment.amount === 'number' && payment.amount >= 1000
    ? payment.amount / 100  // paise → rupees if looks like paise
    : payment.amount;
  const payload = {
    paymentId: payment._id,
    paymentReference: payment.paymentReference,
    invoiceNo: bill?.billNumber,
    amount: amountRupees,
    mode: payment.method || payment.paymentMode,
    customer: bill?.customerInfo
      ? { name: bill.customerInfo.customerName, phone: bill.customerInfo.phone }
      : null,
    capturedAt: payment.capturedAt || new Date(),
  };
  return safeEmit([exports.ROOMS.ORDERS_ALL, exports.ROOMS.DASHBOARD], 'payment:received', payload);
};

exports.emitBillGenerated = (bill) => {
  if (!bill) return false;
  const payload = {
    billId: bill._id,
    invoiceNo: bill.billNumber,
    customer: bill.customerInfo
      ? { name: bill.customerInfo.customerName, phone: bill.customerInfo.phone }
      : null,
    grandTotal: bill.grandTotal,
    billType: bill.hasGst ? 'GST' : 'NON_GST',
    issueDate: bill.issueDate,
  };
  return safeEmit(exports.ROOMS.ORDERS_ALL, 'bill:generated', payload);
};

exports.emitLowStock = (products) => {
  if (!Array.isArray(products) || products.length === 0) return false;
  const payload = {
    count: products.length,
    products: products.slice(0, 50).map(p => ({
      productId: p._id,
      sku: p.sku,
      name: p.name,
      currentStock: p.currentStock || 0,
      threshold: p.minStockAlert || 0,
    })),
    detectedAt: new Date(),
  };
  return safeEmit(
    [exports.ROOMS.ROLE('ADMIN'), exports.ROOMS.ROLE('SUPER_ADMIN')],
    'inventory:low-stock',
    payload
  );
};

exports.emitDashboardRefresh = (reason) => {
  const payload = { timestamp: new Date(), reason: reason || 'manual' };
  return safeEmit(exports.ROOMS.DASHBOARD, 'dashboard:refresh', payload);
};
