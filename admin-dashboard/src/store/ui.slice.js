import { createSlice } from '@reduxjs/toolkit';

// SSR-safe initial sidebar state — open on desktop, collapsed on mobile.
// In tests / Node, window is undefined → defaults to true.
function defaultSidebarOpen() {
  if (typeof window === 'undefined') return true;
  return window.innerWidth >= 768;
}

const initialState = {
  sidebarOpen: defaultSidebarOpen(),
  mobileMenuOpen: false,
  theme: 'light',          // 'light' — dark reserved for later
  activeModal: null,       // null | string identifier
  pageTitle: '',           // set by routes for Topbar display
};

const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    toggleSidebar(state) {
      state.sidebarOpen = !state.sidebarOpen;
    },
    setSidebarOpen(state, action) {
      state.sidebarOpen = !!action.payload;
    },
    toggleMobileMenu(state) {
      state.mobileMenuOpen = !state.mobileMenuOpen;
    },
    closeMobileMenu(state) {
      state.mobileMenuOpen = false;
    },
    setTheme(state, action) {
      state.theme = action.payload;
    },
    openModal(state, action) {
      state.activeModal = action.payload;
    },
    closeModal(state) {
      state.activeModal = null;
    },
    setPageTitle(state, action) {
      state.pageTitle = action.payload || '';
    },
  },
});

export const {
  toggleSidebar, setSidebarOpen,
  toggleMobileMenu, closeMobileMenu,
  setTheme, openModal, closeModal, setPageTitle,
} = uiSlice.actions;
export default uiSlice.reducer;
