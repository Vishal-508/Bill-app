import { Outlet, Navigate } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { selectIsAuthenticated } from '../../store/index.js';
import { ROUTES } from '../../utils/constants.js';

/**
 * Frame for public/unauthenticated routes (currently /login). Bounces
 * authed users to /dashboard so the login page never shows once
 * tokens are valid.
 */
export default function AuthLayout() {
  const isAuthenticated = useSelector(selectIsAuthenticated);
  if (isAuthenticated) return <Navigate to={ROUTES.DASHBOARD} replace />;

  return (
    <div className="min-h-screen flex flex-col p-4
                    bg-gradient-to-br from-primary-50 to-primary-100">
      <div className="flex-1 flex flex-col items-center justify-center">
        {/* Logo + tagline above the card */}
        <div className="mb-6 text-center">
          <div className="inline-flex items-center justify-center h-12 w-12 rounded-xl
                          bg-primary-600 text-white font-bold text-lg mb-3 shadow-sm">
            SG
          </div>
          <h1 className="text-xl font-semibold text-secondary-900">Shree Gopal MDF</h1>
          <p className="text-xs text-secondary-500 mt-0.5">MDF Cutting Billing System</p>
        </div>

        <Outlet />
      </div>

      <footer className="mt-6 text-center text-xs text-secondary-500">
        © {new Date().getFullYear()} Shree Gopal MDF · All rights reserved.
      </footer>
    </div>
  );
}
