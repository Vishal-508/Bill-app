import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useSelector } from 'react-redux';
import { selectIsAuthenticated, selectUser } from '../../store/index.js';
import { ROUTES } from '../../utils/constants.js';

/**
 * Wraps protected sub-routes. Redirects to /login (preserving the
 * attempted URL via returnUrl) when unauthenticated. If `allowedRoles`
 * is provided, also enforces role membership — non-matching users
 * bounce to /dashboard.
 */
export default function ProtectedRoute({ allowedRoles }) {
  const isAuthenticated = useSelector(selectIsAuthenticated);
  const user = useSelector(selectUser);
  const location = useLocation();

  if (!isAuthenticated) {
    const returnUrl = location.pathname + location.search;
    return (
      <Navigate
        to={`${ROUTES.LOGIN}?returnUrl=${encodeURIComponent(returnUrl)}`}
        replace
      />
    );
  }

  if (allowedRoles && !allowedRoles.includes(user?.role)) {
    return <Navigate to={ROUTES.DASHBOARD} replace />;
  }

  return <Outlet />;
}
