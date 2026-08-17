import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  BookOpen,
  Cable,
  LayoutDashboard,
  MessageSquare,
  Network,
  Orbit,
  Route,
  Server,
  Wrench,
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';

import { TabButton } from '@/components/ui';
import { t } from '@/lib/i18n';
import { useAppStore } from '@/stores/app';

type AiTabId =
  | 'overview'
  | 'providers'
  | 'gateway'
  | 'routing'
  | 'connections'
  | 'monitor'
  | 'chat'
  | 'tools'
  | 'antigravity'
  | 'notebooklm';

interface AiTab {
  id: AiTabId;
  label: string;
  to: string;
  icon: LucideIcon;
}

const AI_TABS: AiTab[] = [
  { id: 'overview', label: 'Overview', to: '/ai', icon: LayoutDashboard },
  { id: 'providers', label: 'aiHub.tabs.providers', to: '/ai/providers', icon: Server },
  { id: 'gateway', label: 'Gateway', to: '/ai/gateway', icon: Network },
  { id: 'antigravity', label: 'aiHub.tabs.antigravity', to: '/ai/antigravity', icon: Orbit },
  { id: 'routing', label: 'aiHub.tabs.routing', to: '/ai/routing', icon: Route },
  { id: 'connections', label: 'Connections', to: '/ai/integrations', icon: Cable },
  { id: 'monitor', label: 'aiHub.tabs.monitor', to: '/ai/monitor', icon: Activity },
  { id: 'chat', label: 'aiHub.tabs.chat', to: '/ai/chat', icon: MessageSquare },
  { id: 'tools', label: 'aiHub.tabs.tools', to: '/ai/tools', icon: Wrench },
  { id: 'notebooklm', label: 'aiHub.tabs.notebooklm', to: '/ai/notebooklm', icon: BookOpen },
];

function activeTab(pathname: string): AiTabId {
  if (pathname === '/ai' || pathname === '/ai/overview') return 'overview';
  if (pathname.startsWith('/ai/gateway')) return 'gateway';
  if (pathname.startsWith('/ai/routing')) return 'routing';
  if (pathname.startsWith('/ai/integrations') || pathname.startsWith('/ai/opencode-config')) {
    return 'connections';
  }
  if (pathname.startsWith('/ai/monitor') || pathname.startsWith('/ai/analytics')) return 'monitor';
  if (pathname.startsWith('/ai/chat')) return 'chat';
  if (pathname.startsWith('/ai/antigravity')) return 'antigravity';
  if (pathname.startsWith('/ai/tools') || pathname.startsWith('/ai/holone')) return 'tools';
  if (pathname.startsWith('/ai/notebooklm')) return 'notebooklm';
  // Redirect old api-keys route to providers
  if (pathname.startsWith('/ai/api-keys')) return 'providers';
  return 'providers';
}

function getLabel(label: string): string {
  return label.includes('.') ? t(label) : label;
}

export function AiTopTabs() {
  const navigate = useNavigate();
  const location = useLocation();
  const language = useAppStore(state => state.language);
  const current = activeTab(location.pathname);

  return (
    <nav
      aria-label={language === 'ru' ? 'Рабочее пространство AI Hub' : 'AI Hub workspace'}
      className="shrink-0 overflow-x-auto border-b border-vsc-border-light bg-vsc-panel/95 px-3 shadow-[0_1px_0_rgba(255,255,255,0.025)] md:px-5 [scrollbar-width:thin]"
    >
      <div className="flex h-12 min-w-max items-center gap-0.5 py-1.5">
        {AI_TABS.map(tab => {
          const Icon = tab.icon;
          const isActive = current === tab.id;
          const label =
            tab.id === 'overview'
              ? language === 'ru'
                ? 'Обзор'
                : 'Overview'
              : tab.id === 'connections'
                ? language === 'ru'
                  ? 'Подключения'
                  : 'Connections'
                : getLabel(tab.label);

          return (
            <TabButton
              key={tab.id}
              active={isActive}
              appearance="workspace"
              size="sm"
              onClick={() => navigate(tab.to)}
              aria-current={isActive ? 'page' : undefined}
              title={label}
              icon={<Icon size={14} />}
              label={label}
            />
          );
        })}
      </div>
    </nav>
  );
}
