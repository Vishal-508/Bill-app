import { createSlice } from '@reduxjs/toolkit';
import { MAX_NOTIFICATIONS } from '../utils/constants.js';

let _nextId = 1;
function nextId() { return _nextId++; }

const initialState = {
  items: [],          // newest first
  unreadCount: 0,
};

const notificationsSlice = createSlice({
  name: 'notifications',
  initialState,
  reducers: {
    addNotification: {
      reducer(state, action) {
        const n = action.payload;
        state.items.unshift(n);
        state.unreadCount += n.read ? 0 : 1;
        if (state.items.length > MAX_NOTIFICATIONS) {
          const dropped = state.items.splice(MAX_NOTIFICATIONS);
          state.unreadCount -= dropped.filter(d => !d.read).length;
          if (state.unreadCount < 0) state.unreadCount = 0;
        }
      },
      prepare(payload) {
        // Allow callers to pass a partial; we stamp id + receivedAt + read=false
        return {
          payload: {
            id: nextId(),
            receivedAt: new Date().toISOString(),
            read: false,
            ...payload,
          },
        };
      },
    },
    markAsRead(state, action) {
      const id = action.payload;
      const item = state.items.find(i => i.id === id);
      if (item && !item.read) {
        item.read = true;
        state.unreadCount = Math.max(0, state.unreadCount - 1);
      }
    },
    markAllAsRead(state) {
      for (const item of state.items) item.read = true;
      state.unreadCount = 0;
    },
    removeNotification(state, action) {
      const idx = state.items.findIndex(i => i.id === action.payload);
      if (idx >= 0) {
        const [removed] = state.items.splice(idx, 1);
        if (!removed.read) state.unreadCount = Math.max(0, state.unreadCount - 1);
      }
    },
    clearAll(state) {
      state.items = [];
      state.unreadCount = 0;
    },
  },
});

export const {
  addNotification, markAsRead, markAllAsRead,
  removeNotification, clearAll,
} = notificationsSlice.actions;
export default notificationsSlice.reducer;

// Test-only: reset the id counter so unit tests are deterministic.
export const _resetIds = () => { _nextId = 1; };
