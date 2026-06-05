import { Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { Spinner } from './components/ui/index.js';
import ProtectedRoute from './components/auth/ProtectedRoute.jsx';
import MainLayout from './components/layout/MainLayout.jsx';
import AuthLayout from './components/layout/AuthLayout.jsx';

// Lazy-loaded pages — Vite code-splits each into a separate chunk.
const Login = lazy(() => import('./pages/auth/Login.jsx'));
const Dashboard = lazy(() => import('./pages/dashboard/Dashboard.jsx'));
const NotFound = lazy(() => import('./pages/NotFound.jsx'));
const Placeholder = lazy(() => import('./pages/_Placeholder.jsx'));

function PageFallback() {
  return (
    <div className="flex items-center justify-center h-screen">
      <Spinner size="lg" />
    </div>
  );
}

function App() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        {/* Public — AuthLayout redirects authed users to /dashboard */}
        <Route element={<AuthLayout />}>
          <Route path="/login" element={<Login />} />
        </Route>

        {/* Protected — auth-gated */}
        <Route element={<ProtectedRoute />}>
          <Route element={<MainLayout />}>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/orders" element={<Placeholder title="Orders" />} />
            <Route path="/customers" element={<Placeholder title="Customers" />} />
            <Route path="/products" element={<Placeholder title="Products" />} />
            <Route path="/bills" element={<Placeholder title="Bills" />} />
            <Route path="/payments" element={<Placeholder title="Payments" />} />
            <Route path="/inventory" element={<Placeholder title="Inventory" />} />
            <Route path="/analytics" element={<Placeholder title="Analytics" />} />
            <Route path="/whatsapp" element={<Placeholder title="WhatsApp" />} />
            <Route path="/vendors" element={<Placeholder title="Vendors" />} />
            <Route path="/purchases" element={<Placeholder title="Purchases" />} />
            <Route path="/settings" element={<Placeholder title="Settings" />} />
          </Route>
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}

export default App;
