import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '../ui';

type AiTabId = 'overview' | 'providers' | 'integrations' | 'usage' | 'diagnostics';

interface AiTab {
  id: AiTabId;
  label: string;
  to: string;
}

const AI_TABS: AiTab[] = [
  { id: 'overview', label: 'Overview', to: '/ai' },
  { id: 'providers', label: 'Providers', to: '/ai/providers' },
  { id: 'integrations', label: 'Integrations', to: '/ai/integrations' },
  { id: 'usage', label: 'Usage', to: '/ai/usage' },
  { id: 'diagnostics', label: 'Diagnostics', to: '/ai/diagnostics' },
];

function activeTab(pathname: string): AiTabId {
  if (pathname === '/ai' || pathname === '/ai/') return 'overview';
  if (pathname.startsWith('/ai/providers')) return 'providers';
  if (pathname.startsWith('/ai/integrations')) return 'integrations';
  if (pathname.startsWith('/ai/usage')) return 'usage';
  if (pathname.startsWith('/ai/diagnostics')) return 'diagnostics';
  return 'overview';
}

export function AiTopTabs() {
  const navigate = useNavigate();
  const location = useLocation();
  const current = activeTab(location.pathname);

  return (
    <div className="px-6 py-3 border-b border-white/5 bg-[#0a0a0c]/70 backdrop-blur-xl sticky top-0 z-20">
      <div className="flex flex-wrap items-center gap-2">
        {AI_TABS.map(tab => (
          <Button
            key={tab.id}
            variant={current === tab.id ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => navigate(tab.to)}
          >
            {tab.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
