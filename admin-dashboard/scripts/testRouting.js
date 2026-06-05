// Section D smoke — file existence + structural checks for routing,
// layouts, and pages. JSX rendering is verified via manual browser
// steps in the spec (this script just enforces the wiring shape).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, '..', 'src');

let pass = 0, fail = 0;
const failures = [];
function assert(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`); failures.push(name); }
}

function read(rel) {
  return fs.readFileSync(path.join(SRC, rel), 'utf8');
}
function exists(rel) {
  return fs.existsSync(path.join(SRC, rel));
}

console.log('\n═══ Section D — Routing + Layouts Smoke Test ═══');

// ═══════════════════════════════════════════════
// File structure
// ═══════════════════════════════════════════════
console.log('\n--- File structure ---');
const FILES = [
  'main.jsx',
  'App.jsx',
  'components/auth/ProtectedRoute.jsx',
  'components/layout/MainLayout.jsx',
  'components/layout/AuthLayout.jsx',
  'components/layout/Sidebar.jsx',
  'components/layout/Topbar.jsx',
  'components/layout/MobileMenu.jsx',
  'pages/auth/Login.jsx',
  'pages/dashboard/Dashboard.jsx',
  'pages/_Placeholder.jsx',
  'pages/NotFound.jsx',
];
for (const f of FILES) assert(`${f} exists`, exists(f));

// ═══════════════════════════════════════════════
// main.jsx wiring — providers in correct order
// ═══════════════════════════════════════════════
console.log('\n--- main.jsx providers ---');
const mainSrc = read('main.jsx');
assert('Imports BrowserRouter from react-router-dom',
  mainSrc.includes("from 'react-router-dom'") && mainSrc.includes('BrowserRouter'));
assert('Imports Provider from react-redux',
  mainSrc.includes('react-redux') && /\bProvider\b/.test(mainSrc));
assert('Imports QueryClientProvider', mainSrc.includes('QueryClientProvider'));
assert('Imports Toaster from react-hot-toast',
  mainSrc.includes("from 'react-hot-toast'") && mainSrc.includes('Toaster'));
assert('Vite counter boilerplate removed',
  !mainSrc.includes('useState') &&
  !/from\s+['"]\.\/(?:App\.css|assets\/)/.test(mainSrc));

// ═══════════════════════════════════════════════
// App.jsx routes
// ═══════════════════════════════════════════════
console.log('\n--- App.jsx routes ---');
const appSrc = read('App.jsx');
assert('App imports Routes + Route + Navigate from react-router-dom',
  /import\s*{[^}]*\bRoutes\b[^}]*\bRoute\b[^}]*}\s*from\s*['"]react-router-dom['"]/.test(appSrc) &&
  appSrc.includes('Navigate'));
assert('App uses React.lazy for code-splitting',
  appSrc.includes('lazy(') && appSrc.includes('Suspense'));
assert('App wraps routes with ProtectedRoute', appSrc.includes('ProtectedRoute'));
assert('App wraps routes with MainLayout + AuthLayout',
  appSrc.includes('MainLayout') && appSrc.includes('AuthLayout'));
assert('App catches unknown routes with NotFound',
  /<Route\s+path=['"]\*['"]\s+element=\{<NotFound[^>]*>\s*}\s*\/?>/.test(appSrc));

// Count route definitions — expect 13+ (login + dashboard + 11 module pages + catch-all + root redirect)
const routeMatches = appSrc.match(/<Route\s+path=/g) || [];
assert(`App defines >=13 routes (got ${routeMatches.length})`,
  routeMatches.length >= 13);

// Specific module routes
const REQUIRED_ROUTES = [
  '/login', '/dashboard', '/orders', '/customers', '/products', '/bills',
  '/payments', '/inventory', '/analytics', '/whatsapp', '/vendors',
  '/purchases', '/settings',
];
for (const r of REQUIRED_ROUTES) {
  assert(`Route registered: ${r}`,
    new RegExp(`path=['"]${r}['"]`).test(appSrc));
}

// ═══════════════════════════════════════════════
// ProtectedRoute behavior
// ═══════════════════════════════════════════════
console.log('\n--- ProtectedRoute ---');
const prSrc = read('components/auth/ProtectedRoute.jsx');
assert('ProtectedRoute redirects to /login when unauthenticated',
  prSrc.includes('Navigate') && prSrc.includes('returnUrl'));
assert('ProtectedRoute renders Outlet when authed',
  prSrc.includes('<Outlet') && prSrc.includes('return <Outlet'));
assert('ProtectedRoute supports allowedRoles prop',
  prSrc.includes('allowedRoles'));

// ═══════════════════════════════════════════════
// Sidebar NAV_ITEMS
// ═══════════════════════════════════════════════
console.log('\n--- Sidebar nav items ---');
const sidebarSrc = read('components/layout/Sidebar.jsx');
assert('Sidebar exports NAV_ITEMS for MobileMenu reuse',
  /export\s+const\s+NAV_ITEMS\s*=/.test(sidebarSrc));
const expectedLabels = [
  'Dashboard', 'Orders', 'Customers', 'Products', 'Bills', 'Payments',
  'Inventory', 'Analytics', 'WhatsApp', 'Vendors', 'Purchases', 'Settings',
];
for (const label of expectedLabels) {
  assert(`Sidebar has nav item: ${label}`,
    new RegExp(`label:\\s*['"]${label}['"]`).test(sidebarSrc));
}
assert('Sidebar uses NavLink for active-state styling',
  sidebarSrc.includes('NavLink'));
assert('Sidebar renders role badge for logged-in user',
  sidebarSrc.includes('Badge'));

// ═══════════════════════════════════════════════
// Topbar interactions
// ═══════════════════════════════════════════════
console.log('\n--- Topbar ---');
const topbarSrc = read('components/layout/Topbar.jsx');
assert('Topbar dispatches toggleSidebar', topbarSrc.includes('toggleSidebar'));
assert('Topbar dispatches toggleMobileMenu', topbarSrc.includes('toggleMobileMenu'));
assert('Topbar reads unreadCount for notif badge',
  topbarSrc.includes('selectUnreadCount') || topbarSrc.includes('unreadCount'));
assert('Topbar wires logout via logoutThunk',
  topbarSrc.includes('logoutThunk'));
assert('Topbar uses Headless UI Menu for user dropdown',
  /from\s+['"]@headlessui\/react['"]/.test(topbarSrc) && /\bMenu\b/.test(topbarSrc));

// ═══════════════════════════════════════════════
// MobileMenu auto-closes on route change
// ═══════════════════════════════════════════════
console.log('\n--- MobileMenu ---');
const mobileSrc = read('components/layout/MobileMenu.jsx');
assert('MobileMenu imports useLocation for auto-close trigger',
  mobileSrc.includes('useLocation'));
assert('MobileMenu uses Headless UI Dialog (slide-over)',
  mobileSrc.includes('Dialog'));
assert('MobileMenu reuses NAV_ITEMS from Sidebar',
  mobileSrc.includes('NAV_ITEMS'));

// ═══════════════════════════════════════════════
// MainLayout grid + Outlet
// ═══════════════════════════════════════════════
console.log('\n--- MainLayout ---');
const mlSrc = read('components/layout/MainLayout.jsx');
assert('MainLayout includes Sidebar + Topbar + MobileMenu',
  mlSrc.includes('Sidebar') && mlSrc.includes('Topbar') && mlSrc.includes('MobileMenu'));
assert('MainLayout renders Outlet for nested route content',
  mlSrc.includes('<Outlet'));
assert('MainLayout has Section-F TODO for useSocket',
  mlSrc.includes('useSocket'));

// ═══════════════════════════════════════════════
// AuthLayout — redirects authed to /dashboard
// ═══════════════════════════════════════════════
console.log('\n--- AuthLayout ---');
const alSrc = read('components/layout/AuthLayout.jsx');
assert('AuthLayout redirects authenticated users to /dashboard',
  alSrc.includes('Navigate') && alSrc.includes('isAuthenticated'));
assert('AuthLayout renders gradient background',
  alSrc.includes('gradient'));

// ═══════════════════════════════════════════════
// Pages
// ═══════════════════════════════════════════════
console.log('\n--- Pages ---');
const dashSrc = read('pages/dashboard/Dashboard.jsx');
assert('Dashboard imports Card from UI library',
  /from\s+['"]\.\.\/\.\.\/components\/ui\/Card\.jsx['"]/.test(dashSrc) ||
  /from\s+['"]\.\.\/\.\.\/components\/ui\/index\.js['"]/.test(dashSrc));
assert('Dashboard displays user name from auth slice',
  dashSrc.includes('selectUser') || dashSrc.includes('user'));

const placeholderSrc = read('pages/_Placeholder.jsx');
assert('Placeholder accepts title prop and uses EmptyState',
  placeholderSrc.includes('title') && placeholderSrc.includes('EmptyState'));

const nfSrc = read('pages/NotFound.jsx');
assert('NotFound provides Link to /dashboard',
  nfSrc.includes('Link') && nfSrc.includes('DASHBOARD'));

const loginSrc = read('pages/auth/Login.jsx');
assert('Login page renders something (Card or form)',
  loginSrc.includes('Card') || loginSrc.includes('form'));

// ═══════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════
console.log('\n═══════════════════════════════════════');
console.log(`📊 Section D routing + layouts: ${pass}/${pass + fail} passed`);
if (failures.length > 0) {
  console.log('\nFailures:');
  failures.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
}
process.exit(fail === 0 ? 0 : 1);
