import { configureStore } from '@reduxjs/toolkit';
import authReducer from './auth.slice.js';
import uiReducer from './ui.slice.js';
import notificationsReducer from './notifications.slice.js';

/**
 * Root store.
 *
 * Persisted state: auth (tokens + user) is rehydrated from localStorage
 * inside auth.slice's initialState. Other slices stay in-memory only.
 *
 * `serializableCheck` is left default — slice payloads are plain objects
 * (no Date / Map / Set). Will add ignores here if a future slice needs to.
 */
export const store = configureStore({
  reducer: {
    auth: authReducer,
    ui: uiReducer,
    notifications: notificationsReducer,
  },
  devTools: typeof import.meta !== 'undefined' && import.meta.env?.DEV !== false,
});

// Convenience selectors (importable anywhere without circular deps)
export const selectAuth = (s) => s.auth;
export const selectIsAuthenticated = (s) => !!s.auth.isAuthenticated;
export const selectUser = (s) => s.auth.user;
export const selectUserRole = (s) => s.auth.user?.role;
export const selectAccessToken = (s) => s.auth.accessToken;
export const selectUI = (s) => s.ui;
export const selectNotifications = (s) => s.notifications.items;
export const selectUnreadCount = (s) => s.notifications.unreadCount;
