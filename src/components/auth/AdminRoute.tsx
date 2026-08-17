/**
 * AdminRoute — route guard. Wraps admin-only pages so a non-admin user
 * (role === 'user') is redirected to '/' instead of seeing the page.
 *
 * When auth is disabled, the gate in App.tsx never renders the routes at
 * all (the whole app is unauthenticated), so this guard is only reached
 * when auth is enabled and the user is logged in.
 */

import { Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuthStore } from '../../stores/auth';

interface AdminRouteProps {
  children: ReactNode;
}

export function AdminRoute({ children }: AdminRouteProps) {
  const user = useAuthStore(state => state.user);

  if (!user) {
    // No session — the gate in App.tsx should have caught this, but guard
    // against direct navigation just in case.
    return <Navigate to="/" replace />;
  }

  if (user.role !== 'admin') {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
