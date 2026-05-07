import { useLocation, useNavigate } from 'react-router-dom';

import { t } from '../../lib/i18n';
import { TabButton } from '@/components/ui';

type AiTabId =
  | 'overview'
  | 'providers'
  | 'integrations'
  | 'usage'
  | 'diagnostics'
  | 'antigravity'
  | 'apiKeys';

interface AiTab {
  id: AiTabId;
  label: string;
  to: string;
}

const AI_TABS: AiTab[] = [
  { id: 'overview', label: 'aiHub.tabs.overview', to: '/ai' },
  { id: 'providers', label: 'aiHub.tabs.providers', to: '/ai/providers' },
  { id: 'integrations', label: 'aiHub.tabs.integrations', to: '/ai/integrations' },
  { id: 'usage', label: 'aiHub.tabs.usage', to: '/ai/usage' },
  { id: 'diagnostics', label: 'aiHub.tabs.diagnostics', to: '/ai/diagnostics' },
  { id: 'antigravity', label: 'aiHub.tabs.antigravity', to: '/ai/antigravity' },
  { id: 'apiKeys', label: 'aiHub.tabs.apiKeys', to: '/ai/api-keys' },
];

function activeTab(pathname: string): AiTabId {
  if (pathname === '/ai' || pathname === '/ai/') return 'overview';
  if (pathname.startsWith('/ai/providers')) return 'providers';
  if (pathname.startsWith('/ai/integrations')) return 'integrations';
  if (pathname.startsWith('/ai/usage')) return 'usage';
  if (pathname.startsWith('/ai/diagnostics')) return 'diagnostics';
  if (pathname.startsWith('/ai/antigravity')) return 'antigravity';
  if (pathname.startsWith('/ai/api-keys')) return 'apiKeys';
  return 'overview';
}

export function AiTopTabs() {
  const navigate = useNavigate();
  const location = useLocation();
  const current = activeTab(location.pathname);

  return (
    <div className="px-6 py-3 border-b border-white/5 bg-ds-surface-base/70 backdrop-blur-xl sticky top-0 z-20">
      <div className="flex flex-wrap items-center gap-2">
        {AI_TABS.map(tab => (
          <TabButton
            key={tab.id}
            onClick={() => navigate(tab.to)}
            active={current === tab.id}
            label={t(tab.label)}
          />
        ))}
      </div>
    </div>
  );
}
