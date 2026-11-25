import { useAuthStore, effectiveRole } from '@/stores/auth';

/**
 * True when the current session may use admin-only runtime controls.
 * Fails open on desktop (auth disabled — single-user machine); otherwise
 * the effective role (preview-aware) must be 'admin'.
 */
export function useEffectiveAdmin(): boolean {
  const user = useAuthStore(s => s.user);
  const authEnabled = useAuthStore(s => s.enabled);
  return !authEnabled || effectiveRole(user) === 'admin';
}
