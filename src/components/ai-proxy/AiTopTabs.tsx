import { useEffect, useSyncExternalStore } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  BookOpen,
  Cable,
  LayoutDashboard,
  MessageSquare,
  Network,
  Orbit,
  Puzzle,
  Route,
  Server,
  Users,
  Wrench,
} from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';

import { TabButton, Badge } from '@/components/ui';
import { t } from '@/lib/i18n';
import {
  fetchServicePlugins,
  getServicePlugins,
  subscribeServicePlugins,
} from '@/lib/backend/modules/servicePlugins';
import { useAppStore } from '@/stores/app';
import { useAuthStore } from '@/stores/auth';
import { useGroupsStore } from '@/stores/groups';

type AiTabId =
  | 'overview'
  | 'providers'
  | 'gateway'
  | 'groups'
  | 'routing'
  | 'connections'
  | 'monitor'
  | 'chat'
  | 'tools'
  | 'antigravity'
  | 'notebooklm';

interface AiTab {
  id: string;
  label: string;
  to: string;
  icon: LucideIcon;
  /** Only render when auth is enabled (web mode). Hidden on desktop. */
  authOnly?: boolean;
  /** Present when this tab is contributed by a service plugin. */
  pluginId?: string;
}

const AI_TABS: AiTab[] = [
  { id: 'overview', label: 'Overview', to: '/ai', icon: LayoutDashboard },
  { id: 'providers', label: 'aiHub.tabs.providers', to: '/ai/providers', icon: Server },
  { id: 'gateway', label: 'Gateway', to: '/ai/gateway', icon: Network },
  { id: 'antigravity', label: 'aiHub.tabs.antigravity', to: '/ai/antigravity', icon: Orbit },
  { id: 'groups', label: 'ai.groups.title', to: '/ai/groups', icon: Users, authOnly: true },
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
  if (pathname.startsWith('/ai/groups')) return 'groups';
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

/**
 * Whitelist of lucide-react icon names service plugins may reference in
 * `ui.tabs[].icon`. Names not in this map fall back to Puzzle. Keeping the
 * map small avoids importing the entire lucide-react barrel.
 */
const PLUGIN_ICON_MAP: Record<string, LucideIcon> = {
  Activity,
  BookOpen,
  Cable,
  LayoutDashboard,
  MessageSquare,
  Network,
  Orbit,
  Puzzle,
  Route,
  Server,
  Users,
  Wrench,
};

function getPluginIcon(name?: string): LucideIcon {
  if (name && PLUGIN_ICON_MAP[name]) return PLUGIN_ICON_MAP[name];
  return Puzzle;
}

/**
 * Resolve a plugin-contributed tab label. When the label looks like a
 * translation key (contains a dot), look it up via t('plugin.{id}.{label}')
 * so the plugin's i18n bundle (registered by fetchServicePlugins) is
 * consulted. Otherwise return the raw label string.
 */
function getPluginTabLabel(pluginId: string, label: string): string {
  return label.includes('.') ? t(`plugin.${pluginId}.${label}`) : label;
}

export function AiTopTabs() {
  const navigate = useNavigate();
  const location = useLocation();
  const language = useAppStore(state => state.language);
  const authEnabled = useAuthStore(state => state.enabled);
  const pendingInvites = useGroupsStore(state => state.invites);
  const current = activeTab(location.pathname);

  const plugins = useSyncExternalStore(
    subscribeServicePlugins,
    getServicePlugins,
    getServicePlugins,
  );

  // Fetch service plugins on mount. AiTopTabs mounts on navigation to any
  // /ai/* route, so this is the primary invalidation channel when no event
  // bus exists. Window focus is a passive refresh for out-of-band installs.
  useEffect(() => {
    void fetchServicePlugins();
  }, []);

  useEffect(() => {
    const onFocus = () => { void fetchServicePlugins(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  // Build dynamic tabs from service-plugin manifests. Each tab navigates to
  // /ai/plugin/{pluginId}; active when pathname starts with that prefix.
  const pluginTabs: AiTab[] = [];
  for (const plugin of plugins) {
    const tabs = plugin.ui?.tabs;
    if (!Array.isArray(tabs)) continue;
    for (const tab of tabs) {
      if (!tab.id || !tab.label) continue;
      pluginTabs.push({
        id: `plugin:${plugin.id}:${tab.id}`,
        pluginId: plugin.id,
        label: tab.label,
        to: `/ai/plugin/${plugin.id}`,
        icon: getPluginIcon(tab.icon),
      });
    }
  }

  const visibleTabs = [
    ...(authEnabled ? AI_TABS : AI_TABS.filter(tab => !tab.authOnly)),
    ...pluginTabs,
  ];

  return (
    <nav
      aria-label={language === 'ru' ? 'Рабочее пространство AI Hub' : 'AI Hub workspace'}
      className="shrink-0 overflow-x-auto border-b border-vsc-border-light bg-vsc-panel/95 px-3 shadow-[0_1px_0_rgba(255,255,255,0.025)] md:px-5 [scrollbar-width:thin]"
    >
      <div className="flex h-12 min-w-max items-center gap-0.5 py-1.5">
        {visibleTabs.map(tab => {
          const Icon = tab.icon;
          const isActive = tab.pluginId
            ? location.pathname.startsWith('/ai/plugin/' + tab.pluginId)
            : current === tab.id;
          const label =
            tab.id === 'overview'
              ? language === 'ru'
                ? 'Обзор'
                : 'Overview'
              : tab.id === 'connections'
                ? language === 'ru'
                  ? 'Подключения'
                  : 'Connections'
                : tab.pluginId
                  ? getPluginTabLabel(tab.pluginId, tab.label)
                  : getLabel(tab.label);
          const pendingCount = tab.id === 'groups' ? pendingInvites.length : 0;

          return (
            <div key={tab.id} className="relative">
              <TabButton
                active={isActive}
                appearance="workspace"
                size="sm"
                onClick={() => navigate(tab.to)}
                aria-current={isActive ? 'page' : undefined}
                title={label}
                icon={<Icon size={14} />}
                label={label}
              />
              {pendingCount > 0 && (
                <span className="absolute -top-1 -right-1 z-10 pointer-events-none">
                  <Badge variant="warning" size="sm" withPulse>
                    <span className="motion-reduce:animate-none">{pendingCount}</span>
                  </Badge>
                </span>
              )}
            </div>
          );
        })}
      </div>
    </nav>
  );
}
