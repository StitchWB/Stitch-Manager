import { useEffect } from 'react';
import { Navigate, Route, useNavigate, useSearchParams } from 'react-router-dom';

export const LEGACY_REDIRECTS: Array<{
  from: string;
  to: string | ((search: URLSearchParams) => string);
}> = [
  { from: '/ai/overview', to: '/ai' },
  { from: '/ai/groups', to: '/groups' },
  { from: '/ai/usage', to: '/ai/monitor' },
  { from: '/ai/diagnostics', to: '/ai/monitor' },
  { from: '/ai/freemodel', to: '/ai/providers' },
  { from: '/ai/api-keys', to: '/ai/providers' },
  { from: '/ai/gateway', to: '/ai/providers' },
  { from: '/ai-providers', to: '/ai/providers' },
  { from: '/ai-analytics', to: '/ai/monitor?tab=analytics' },
  { from: '/antigravity', to: '/ai/antigravity' },
  { from: '/notebooklm', to: '/ai/notebooklm' },
  { from: '/api-keys', to: '/ai/providers' },
  { from: '/ai/tools', to: search => '/ai/routing?tab=' + (search.get('tab') || 'holone') },
  { from: '/ai/holone', to: '/ai/routing?tab=holone' },
  { from: '/ai/analytics', to: '/ai/monitor?tab=analytics' },
  { from: '/chat', to: '/ai/chat' },
  { from: '/ai/plugin/stitch-antigravity', to: '/ai/antigravity' },
  { from: '/ai/plugin/stitch-notebooklm', to: '/ai/notebooklm' },
  { from: '/ai/plugin/stitch-opencode', to: '/ai/opencode-config' },
  { from: '/ai/plugin/stitch-totp', to: '/totp' },
];

export function RedirectWithTab({ to }: { to: (search: URLSearchParams) => string }) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  useEffect(() => {
    navigate(to(searchParams), { replace: true });
  }, [navigate, searchParams, to]);
  return null;
}

export type LegacyRedirectScope = 'ai-hub' | 'top-level';

export function LegacyRedirectRoutes(scope: LegacyRedirectScope) {
  const entries = LEGACY_REDIRECTS.filter(entry =>
    scope === 'ai-hub' ? entry.from.startsWith('/ai/') : !entry.from.startsWith('/ai/'),
  );
  return (
    <>
      {entries.map(entry => (
        <Route
          key={entry.from}
          path={entry.from}
          element={
            typeof entry.to === 'function' ? (
              <RedirectWithTab to={entry.to} />
            ) : (
              <Navigate to={entry.to} replace />
            )
          }
        />
      ))}
    </>
  );
}
