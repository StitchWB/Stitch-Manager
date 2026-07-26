import { useLocation, useNavigate } from 'react-router-dom';

import { t } from '@/lib/i18n';
import { TabButton } from '@/components/ui';

type AiTabId = 'providers' | 'routing' | 'monitor' | 'antigravity' | 'apiKeys' | 'opencodeConfig' | 'chat';

interface AiTab {
  id: AiTabId;
  label: string;
  to: string;
}

const AI_TABS: AiTab[] = [
  { id: 'providers', label: 'aiHub.tabs.providers', to: '/ai/providers' },
  { id: 'routing', label: 'aiHub.tabs.routing', to: '/ai/routing' },
  { id: 'monitor', label: 'aiHub.tabs.monitor', to: '/ai/monitor' },
  { id: 'chat', label: 'aiHub.tabs.chat', to: '/ai/chat' },
  { id: 'antigravity', label: 'aiHub.tabs.antigravity', to: '/ai/antigravity' },
  { id: 'apiKeys', label: 'aiHub.tabs.apiKeys', to: '/ai/api-keys' },
  { id: 'opencodeConfig', label: 'aiHub.tabs.opencodeConfig', to: '/ai/opencode-config' },
];

function activeTab(pathname: string): AiTabId {
  if (pathname.startsWith('/ai/routing')) return 'routing';
  if (pathname.startsWith('/ai/monitor')) return 'monitor';
  if (pathname.startsWith('/ai/chat')) return 'chat';
  if (pathname.startsWith('/ai/antigravity')) return 'antigravity';
  if (pathname.startsWith('/ai/api-keys')) return 'apiKeys';
  if (pathname.startsWith('/ai/opencode-config')) return 'opencodeConfig';
  // Legacy redirects fall through to providers as the default landing tab.
  return 'providers';
}

export function AiTopTabs() {
  const navigate = useNavigate();
  const location = useLocation();
  const current = activeTab(location.pathname);

  return (
    <div className="px-6 py-3 border-b border-white/5 bg-vsc-bg/70 backdrop-blur-xl sticky top-0 z-20">
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
