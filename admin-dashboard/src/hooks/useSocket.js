import { useEffect, useRef } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { io } from 'socket.io-client';
import toast from 'react-hot-toast';
import { addNotification } from '../store/notifications.slice.js';
import { ROLES, SOCKET_URL } from '../utils/constants.js';

/**
 * Real-time hook. Should be mounted ONCE per app session — typically
 * inside MainLayout (which only renders for authenticated users).
 *
 * Connects to the backend Socket.IO server with a JWT, subscribes to
 * the relevant admin rooms, and dispatches every server event into
 * the `notifications` slice. High-signal events also fire a toast +
 * sound; low-signal events (order:updated, dashboard:refresh) just
 * record the notification.
 */
export function useSocket() {
  const socketRef = useRef(null);
  const { accessToken, isAuthenticated, user } = useSelector(s => s.auth);
  const dispatch = useDispatch();
  const userRole = user?.role;

  useEffect(() => {
    // Logged out → tear down existing socket and bail
    if (!isAuthenticated || !accessToken) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      return;
    }

    const socket = io(SOCKET_URL, {
      auth: { token: accessToken },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
    socketRef.current = socket;

    // ─── Connection lifecycle ───
    socket.on('connect', () => {
      // eslint-disable-next-line no-console
      console.info('[Socket] Connected:', socket.id);
      socket.emit('subscribe:orders');
      socket.emit('subscribe:dashboard');
      if ([ROLES.ADMIN, ROLES.SUPER_ADMIN].includes(userRole)) {
        socket.emit('subscribe:inventory');
      }
    });

    socket.on('disconnect', (reason) => {
      // eslint-disable-next-line no-console
      console.info('[Socket] Disconnected:', reason);
    });

    socket.on('connect_error', (err) => {
      // eslint-disable-next-line no-console
      console.error('[Socket] Connect error:', err.message);
    });

    socket.io.on('reconnect', (attempt) => {
      // eslint-disable-next-line no-console
      console.info('[Socket] Reconnected after', attempt, 'attempts');
    });

    socket.io.on('reconnect_failed', () => {
      // eslint-disable-next-line no-console
      console.error('[Socket] Reconnect failed permanently');
      toast.error('Real-time connection lost. Refresh the page.');
    });

    // ─── Business events ───
    socket.on('order:new', (data) => {
      toast.success(
        `New order ${data.orderNumber}: ₹${data.grandTotal}`,
        { duration: 5000 }
      );
      playSound('new-order.mp3');
      dispatch(addNotification({
        type: 'order:new',
        title: `New Order: ${data.orderNumber}`,
        message: `${data.customer?.name || 'Customer'} — ₹${data.grandTotal}`,
        link: `/orders/${data.orderNumber}`,
        data,
      }));
    });

    socket.on('order:status-changed', (data) => {
      toast(
        `Order ${data.orderNumber}: ${data.oldStatus} → ${data.newStatus}`,
        { icon: '🔄', duration: 4000 }
      );
      dispatch(addNotification({
        type: 'order:status-changed',
        title: `Order ${data.orderNumber}`,
        message: `Status: ${data.oldStatus} → ${data.newStatus}`,
        link: `/orders/${data.orderNumber}`,
        data,
      }));
    });

    socket.on('order:updated', (data) => {
      // Lighter touch — no toast, no sound; just record the notification
      dispatch(addNotification({
        type: 'order:updated',
        title: `Order ${data.orderNumber} updated`,
        message: `Status: ${data.status}`,
        link: `/orders/${data.orderNumber}`,
        data,
      }));
    });

    socket.on('payment:received', (data) => {
      toast.success(
        `Payment received: ₹${data.amount} for ${data.invoiceNo}`,
        { duration: 5000 }
      );
      playSound('payment-received.mp3');
      dispatch(addNotification({
        type: 'payment:received',
        title: 'Payment Received',
        message: `${data.invoiceNo} — ₹${data.amount} via ${data.mode || 'unknown'}`,
        link: '/payments',
        data,
      }));
    });

    socket.on('bill:generated', (data) => {
      dispatch(addNotification({
        type: 'bill:generated',
        title: `Bill ${data.invoiceNo} generated`,
        message: `${data.customer?.name || 'Customer'} — ₹${data.grandTotal}`,
        link: `/bills/${data.invoiceNo}`,
        data,
      }));
    });

    socket.on('inventory:low-stock', (data) => {
      const n = data.count;
      toast.error(
        `Low stock alert: ${n} product${n > 1 ? 's' : ''} need restock`,
        { duration: 6000 }
      );
      dispatch(addNotification({
        type: 'inventory:low-stock',
        title: 'Low Stock Alert',
        message: `${n} product${n > 1 ? 's' : ''} below reorder level`,
        link: '/inventory',
        data,
      }));
    });

    socket.on('dashboard:refresh', (data) => {
      dispatch(addNotification({
        type: 'dashboard:refresh',
        title: 'Dashboard refreshed',
        message: 'New data available',
        data,
      }));
    });

    // Cleanup — runs on dep change AND on unmount
    return () => {
      socket.off();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [isAuthenticated, accessToken, userRole, dispatch]);

  return socketRef.current;
}

// ─── Audio helper ───
// Browser autoplay policies typically block audio without a user
// gesture. We swallow the rejection because sound is enhancement,
// not requirement. If /public/sounds/<file> 404s, the constructor
// still succeeds (lazy decode) and play() rejects — same handling.
function playSound(filename) {
  try {
    const audio = new Audio(`/sounds/${filename}`);
    audio.volume = 0.5;
    audio.play().catch(() => { /* autoplay blocked or file missing — silent */ });
  } catch {
    /* defensive — Audio constructor failure on very old browsers */
  }
}

export default useSocket;
