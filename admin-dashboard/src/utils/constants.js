// Read Vite envs with safe fallbacks so this module is import-safe
// in Node (smoke tests) where import.meta.env is undefined.
const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};

export const API_BASE_URL = env.VITE_API_BASE_URL || 'http://localhost:5000/api';
export const SOCKET_URL = env.VITE_SOCKET_URL || 'http://localhost:5000';

// localStorage keys — kept central so renames stay consistent across slices.
export const STORAGE_KEYS = Object.freeze({
  ACCESS_TOKEN: 'sgmdf_access_token',
  REFRESH_TOKEN: 'sgmdf_refresh_token',
  USER: 'sgmdf_user',
});

export const ROUTES = Object.freeze({
  LOGIN: '/login',
  DASHBOARD: '/dashboard',
  CUSTOMERS: '/customers',
  PRODUCTS: '/products',
  ORDERS: '/orders',
  BILLS: '/bills',
  PAYMENTS: '/payments',
  INVENTORY: '/inventory',
  ANALYTICS: '/analytics',
  WHATSAPP: '/whatsapp',
  VENDORS: '/vendors',
  PURCHASES: '/purchases',
  SETTINGS: '/settings',
});

// Match backend's User.ROLES enum (src/models/User.js).
export const ROLES = Object.freeze({
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN: 'ADMIN',
  BILLING: 'BILLING',
  CUTTING: 'CUTTING',
  DELIVERY: 'DELIVERY',
});

export const ADMIN_ROLES = [ROLES.ADMIN, ROLES.SUPER_ADMIN];

// Notification slice cap — drops oldest beyond this.
export const MAX_NOTIFICATIONS = 50;
