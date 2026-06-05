import axios from 'axios';
import { API_BASE_URL, STORAGE_KEYS, ROUTES } from '../utils/constants.js';

/**
 * Axios instance with JWT interceptors.
 *
 * Request: attaches Authorization: Bearer <accessToken> from storage.
 * Response: on 401, attempts a single refresh-then-retry; further 401
 * or refresh failure → clears storage + hard redirect to /login.
 * Toasts on 403/5xx/network errors are emitted via react-hot-toast.
 *
 * Toast import is lazy + guarded so smoke tests running in Node
 * (where react-hot-toast may not be importable without a DOM) don't
 * crash on module load. The toast() call no-ops if toast is unavailable.
 */

// Lazy toast loader — resolves at runtime, falls back to console.
let _toast = null;
function toast(level, msg) {
  if (!_toast) {
    try {
      // Resolved synchronously by Vite's bundler in the browser.
      // In Node smoke tests this require/import path is not exercised
      // (no 401/403/5xx in the unit tests).
      _toast = globalThis.__toast || null;
    } catch {
      _toast = null;
    }
  }
  if (_toast && typeof _toast[level] === 'function') _toast[level](msg);
  else if (_toast && typeof _toast === 'function') _toast(msg);
}

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = typeof localStorage !== 'undefined'
    ? localStorage.getItem(STORAGE_KEYS.ACCESS_TOKEN)
    : null;
  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Single in-flight refresh — multiple concurrent 401s wait on the same
// refresh attempt rather than firing N parallel /auth/refresh requests.
let _refreshing = null;

async function attemptRefresh() {
  if (_refreshing) return _refreshing;
  const refreshToken = typeof localStorage !== 'undefined'
    ? localStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN)
    : null;
  if (!refreshToken) throw new Error('No refresh token available');

  _refreshing = axios
    .post(`${API_BASE_URL}/auth/refresh`, { refreshToken })
    .then((res) => {
      const newAccess = res.data?.accessToken;
      const newRefresh = res.data?.refreshToken;
      if (!newAccess) throw new Error('Refresh response missing accessToken');
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEYS.ACCESS_TOKEN, newAccess);
        if (newRefresh) localStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, newRefresh);
      }
      return newAccess;
    })
    .finally(() => { _refreshing = null; });

  return _refreshing;
}

function forceLogout() {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(STORAGE_KEYS.ACCESS_TOKEN);
    localStorage.removeItem(STORAGE_KEYS.REFRESH_TOKEN);
    localStorage.removeItem(STORAGE_KEYS.USER);
  }
  if (typeof window !== 'undefined' && window.location.pathname !== ROUTES.LOGIN) {
    const returnUrl = encodeURIComponent(
      window.location.pathname + window.location.search
    );
    window.location.replace(`${ROUTES.LOGIN}?returnUrl=${returnUrl}`);
  }
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config || {};
    const status = error.response?.status;

    if (!error.response) {
      toast('error', 'Network unreachable — check your connection');
      return Promise.reject(error);
    }

    if (status === 401 && !original._retry) {
      original._retry = true;
      try {
        const newToken = await attemptRefresh();
        original.headers = original.headers || {};
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original);
      } catch {
        forceLogout();
        return Promise.reject(error);
      }
    }

    if (status === 403) toast('error', 'Permission denied');
    else if (status >= 500) toast('error', 'Server error — please retry');

    return Promise.reject(error);
  }
);

// Test-only exports — allow smoke tests to verify interceptor wiring
// + drive the refresh helper without going through a real HTTP call.
export const _internals = { attemptRefresh, forceLogout };
