import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { authApi } from '../api/auth.api.js';
import { STORAGE_KEYS } from '../utils/constants.js';

function safeGetItem(key) {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(key);
}
function safeSetItem(key, value) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(key, value);
}
function safeRemoveItem(key) {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(key);
}

export const hydrateFromStorage = () => {
  const accessToken = safeGetItem(STORAGE_KEYS.ACCESS_TOKEN);
  const refreshToken = safeGetItem(STORAGE_KEYS.REFRESH_TOKEN);
  let user = null;
  try {
    const raw = safeGetItem(STORAGE_KEYS.USER);
    user = raw ? JSON.parse(raw) : null;
  } catch {
    user = null;
  }
  return {
    user,
    accessToken,
    refreshToken,
    isAuthenticated: !!(accessToken && user),
  };
};

const persistedInitial = hydrateFromStorage();

const initialState = {
  ...persistedInitial,
  status: 'idle',  // 'idle' | 'loading' | 'succeeded' | 'failed'
  error: null,
};

export const loginThunk = createAsyncThunk(
  'auth/login',
  async ({ email, password }, { rejectWithValue }) => {
    try {
      const res = await authApi.login({ email, password });
      return res; // expected { user, accessToken, refreshToken }
    } catch (err) {
      const message = err.response?.data?.message || err.message || 'Login failed';
      return rejectWithValue({ status: err.response?.status, message });
    }
  }
);

export const fetchMeThunk = createAsyncThunk(
  'auth/fetchMe',
  async (_, { rejectWithValue }) => {
    try {
      const res = await authApi.me();
      return res; // { user }
    } catch (err) {
      const message = err.response?.data?.message || err.message || 'Failed to fetch user';
      return rejectWithValue({ status: err.response?.status, message });
    }
  }
);

export const logoutThunk = createAsyncThunk(
  'auth/logout',
  async () => {
    try { await authApi.logout(); } catch { /* best effort */ }
    return true;
  }
);

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setCredentials(state, action) {
      const { user, accessToken, refreshToken } = action.payload || {};
      state.user = user || null;
      state.accessToken = accessToken || null;
      state.refreshToken = refreshToken || null;
      state.isAuthenticated = !!(accessToken && user);
      state.status = 'succeeded';
      state.error = null;
      if (accessToken) safeSetItem(STORAGE_KEYS.ACCESS_TOKEN, accessToken);
      if (refreshToken) safeSetItem(STORAGE_KEYS.REFRESH_TOKEN, refreshToken);
      if (user) safeSetItem(STORAGE_KEYS.USER, JSON.stringify(user));
    },
    logout(state) {
      state.user = null;
      state.accessToken = null;
      state.refreshToken = null;
      state.isAuthenticated = false;
      state.status = 'idle';
      state.error = null;
      safeRemoveItem(STORAGE_KEYS.ACCESS_TOKEN);
      safeRemoveItem(STORAGE_KEYS.REFRESH_TOKEN);
      safeRemoveItem(STORAGE_KEYS.USER);
    },
    updateUser(state, action) {
      state.user = { ...(state.user || {}), ...action.payload };
      safeSetItem(STORAGE_KEYS.USER, JSON.stringify(state.user));
    },
    clearError(state) {
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(loginThunk.pending, (state) => {
        state.status = 'loading';
        state.error = null;
      })
      .addCase(loginThunk.fulfilled, (state, action) => {
        authSlice.caseReducers.setCredentials(state, action);
      })
      .addCase(loginThunk.rejected, (state, action) => {
        state.status = 'failed';
        state.error = action.payload || { message: 'Login failed' };
      })
      .addCase(fetchMeThunk.fulfilled, (state, action) => {
        const user = action.payload?.data || action.payload?.user || action.payload;
        if (user) {
          state.user = user;
          state.isAuthenticated = !!state.accessToken;
          safeSetItem(STORAGE_KEYS.USER, JSON.stringify(user));
        }
      })
      .addCase(fetchMeThunk.rejected, (state, action) => {
        state.error = action.payload || { message: 'Could not fetch user' };
      })
      .addCase(logoutThunk.fulfilled, (state) => {
        authSlice.caseReducers.logout(state);
      });
  },
});

export const { setCredentials, logout, updateUser, clearError } = authSlice.actions;
export default authSlice.reducer;
