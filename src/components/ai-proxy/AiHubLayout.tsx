import { useEffect } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  BookOpen,
  Cable,
  CreditCard,
  LayoutDashboard,
  Mail,
  MessageSquare,
  Network,
  Orbit,
  Puzzle,
  Radar,
  Route,
  Server,
  Settings,
  Shield,
  Terminal,
  Users,
  Waypoints,
  Wrench,
} from 'lucide-react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

import { BreadcrumbBar } from '@/components/ai-proxy/BreadcrumbBar';
import { Badge, Tooltip } from '@/components/ui';
import { ButtonBase } from '@/components/ui/ButtonBase';
import { CORE_PAGE_ROUTES } from '@/components/ai-proxy/corePageRoutes';
import { t } from '@/lib/i18n';
import { fetchServicePlugins } from '@/lib/backend/modules/servicePlugins';
import { useAppStore } from '@/stores/app';
import { useAuthStore } from '@/stores/auth';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useServicePlugins } from '@/hooks/useServicePlugins';
import { cn } from '@/lib/utils';

type AiTabId =
  | 'overview'
  | 'providers'
  | 'routing'
  | 'connections'
  | 'opencode'
  | 'monitor'
  | 'chat'
  | 'antigravity'
  | 'devbox';

interface AiTab {
  id: string;
  label: string;
  to: string;
  icon: LucideIcon;
  /** Only render when auth is enabled (web mode). Hidden on desktop. */
  authOnly?: boolean;
  /** Present when this tab is contributed by a service plugin. */
  pluginId?: string;
  /** Origin of the plugin: "community" tabs get a warning badge. */
  source?: string;
}

interface AiTabGroup {
  id: string;
  /** Section header key; undefined renders no header (the Overview item). */
  header?: string;
  tabs: AiTab[];
}

const AI_TAB_GROUPS: AiTabGroup[] = [
  {
    id: 'top',
    tabs: [{ id: 'overview', label: 'aiHub.tabs.overview', to: '/ai', icon: LayoutDashboard }],
  },
  {
    id: 'sources',
    header: 'aiHub.groups.sources',
    tabs: [
      { id: 'providers', label: 'aiHub.tabs.providers', to: '/ai/providers', icon: Server },
    ],
  },
  {
    id: 'processing',
    header: 'aiHub.groups.processing',
    tabs: [
      { id: 'routing', label: 'aiHub.tabs.routing', to: '/ai/routing', icon: Route },
      { id: 'connections', label: 'aiHub.tabs.connections', to: '/ai/integrations', icon: Cable },
      { id: 'opencode', label: 'aiHub.tabs.opencode', to: '/ai/opencode-config', icon: Settings },
      { id: 'monitor', label: 'aiHub.tabs.monitor', to: '/ai/monitor', icon: Activity },
    ],
  },
  {
    id: 'usage',
    header: 'aiHub.groups.usage',
    tabs: [
      { id: 'chat', label: 'aiHub.tabs.chat', to: '/ai/chat', icon: MessageSquare },
    ],
  },
];

function activeTab(pathname: string): AiTabId {
  if (pathname === '/ai' || pathname === '/ai/overview') return 'overview';
  if (pathname.startsWith('/ai/gateway')) return 'providers';
  if (pathname.startsWith('/ai/routing')) return 'routing';
  if (pathname.startsWith('/ai/integrations')) {
    return 'connections';
  }
  if (pathname.startsWith('/ai/opencode-config')) return 'opencode';
  if (pathname.startsWith('/ai/monitor') || pathname.startsWith('/ai/analytics')) return 'monitor';
  if (pathname.startsWith('/ai/chat')) return 'chat';
  // Redirect old api-keys route to providers
  if (pathname.startsWith('/ai/api-keys')) return 'providers';
  if (pathname.startsWith('/ai/antigravity')) return 'antigravity';
  if (pathname.startsWith('/ai/devbox')) return 'devbox';
  return 'providers';
}

function getLabel(label: string): string {
  return label.includes('.') ? t(label) : label;
}

export function currentRailLabel(pathname: string): string {
  const id = activeTab(pathname);
  for (const group of AI_TAB_GROUPS) {
    const tab = group.tabs.find(tab => tab.id === id);
    if (tab) return getLabel(tab.label);
  }
  return id;
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
  CreditCard,
  LayoutDashboard,
  Mail,
  MessageSquare,
  Network,
  Orbit,
  Puzzle,
  Radar,
  Route,
  Server,
  Settings,
  Shield,
  Terminal,
  Users,
  Waypoints,
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

interface RailItemProps {
  tab: AiTab;
  label: string;
  active: boolean;
  title: string;
  community: boolean;
  /** Below md the rail is icon-only: labels stay in the DOM (CSS-hidden) and hover shows a Tooltip. */
  iconOnly: boolean;
  onClick: () => void;
}

function RailItem({ tab, label, active, title, community, iconOnly, onClick }: RailItemProps) {
  const Icon = tab.icon;
  const button = (
    <ButtonBase
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      title={iconOnly ? undefined : title}
      data-testid={`ai-hub-rail-item-${tab.id}`}
      className={cn(
        'relative flex h-9 w-full items-center gap-2 rounded-md border border-transparent py-1.5 text-xs font-medium transition-colors duration-150',
        'justify-center px-0 md:h-8 md:justify-start md:px-2.5',
        active
          ? 'border-white/[0.11] bg-white/[0.07] text-white shadow-sm'
          : 'text-slate-300/80 hover:border-white/[0.06] hover:bg-white/[0.045] hover:text-white'
      )}
    >
      {active && (
        <span
          aria-hidden="true"
          className="absolute inset-y-1.5 -left-px w-0.5 rounded-full bg-vsc-blue"
        />
      )}
      <span
        className={cn(
          'flex h-4 w-4 shrink-0 items-center justify-center',
          active ? 'text-vsc-blue' : 'text-slate-400'
        )}
      >
        <Icon size={14} />
      </span>
      <span className="hidden truncate whitespace-nowrap md:inline">{label}</span>
      {community && (
        <>
          <span className="pointer-events-none absolute -top-1 -right-1 z-10 hidden md:block">
            <Badge variant="warning" size="sm">
              {t('admin.plugins.servicePluginCommunity')}
            </Badge>
          </span>
          <span
            aria-hidden="true"
            className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-amber-400 md:hidden"
          />
        </>
      )}
    </ButtonBase>
  );

  if (!iconOnly) return button;
  return (
    <Tooltip content={title} side="right" wrapperClassName="w-full">
      {button}
    </Tooltip>
  );
}

export function AiHubLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const language = useAppStore(state => state.language);
  const authEnabled = useAuthStore(state => state.enabled);
  const isMdUp = useMediaQuery('(min-width: 768px)');
  const current = activeTab(location.pathname);

  const plugins = useServicePlugins();

  // Window focus is a passive refresh for out-of-band installs.
  useEffect(() => {
    const onFocus = () => { void fetchServicePlugins(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  // Rail tabs by ui.kind: declarative → /ai/plugin/{id}, core_page → its real host route (no route → no tab).
  const pluginTabs: AiTab[] = [];
  for (const plugin of plugins) {
    const tabs = plugin.ui?.tabs;
    if (!Array.isArray(tabs)) continue;
    const kind = plugin.ui?.kind;
    let to: string;
    if (kind === 'declarative') {
      to = `/ai/plugin/${plugin.id}`;
    } else if (kind === 'core_page') {
      const hostRoute = CORE_PAGE_ROUTES[plugin.id];
      if (!hostRoute || !hostRoute.startsWith('/ai')) continue;
      to = hostRoute;
    } else {
      continue;
    }
    for (const tab of tabs) {
      if (!tab.id || !tab.label) continue;
      pluginTabs.push({
        id: `plugin:${plugin.id}:${tab.id}`,
        pluginId: plugin.id,
        label: tab.label,
        to,
        icon: getPluginIcon(tab.icon),
        source: plugin.source,
      });
    }
  }

  const groups = authEnabled
    ? AI_TAB_GROUPS
    : AI_TAB_GROUPS.map(group => ({
        ...group,
        tabs: group.tabs.filter(tab => !tab.authOnly),
      }));
  const visibleGroups: AiTabGroup[] = pluginTabs.length
    ? [...groups, { id: 'plugins', header: 'aiHub.groups.plugins', tabs: pluginTabs }]
    : groups;

  const resolveLabel = (tab: AiTab): string => {
    if (tab.pluginId) return getPluginTabLabel(tab.pluginId, tab.label);
    return getLabel(tab.label);
  };

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
      <nav
        aria-label={language === 'ru' ? 'Рабочее пространство AI Hub' : 'AI Hub workspace'}
        data-testid="ai-hub-rail"
        className="flex w-12 shrink-0 flex-col gap-1 overflow-y-auto border-r border-vsc-border-light bg-vsc-panel/95 px-1.5 py-3 [scrollbar-width:thin] md:w-48 md:gap-2 md:px-2.5"
      >
        {visibleGroups.map(group => {
          if (!group.tabs.length) return null;
          return (
            <div key={group.id} data-testid={`ai-hub-group-${group.id}`}>
              {group.header && (
                <div
                  className="hidden px-2.5 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-vsc-text-muted/70 md:block"
                  data-testid={`ai-hub-group-header-${group.id}`}
                >
                  {t(group.header)}
                </div>
              )}
              <div className="flex flex-col gap-0.5">
                {group.tabs.map(tab => {
                  // plugin tab ids are `plugin:{id}:{tabId}` — the manifest tabId may name the active section
                  const isActive = tab.pluginId
                    ? location.pathname.startsWith(tab.to) ||
                      current === tab.id.split(':').pop()
                    : current === tab.id;
                  const label = resolveLabel(tab);
                  const isCommunity = tab.source === 'community';
                  const title = isCommunity
                    ? `${label} — ${t('admin.plugins.servicePluginCommunityTabTooltip')}`
                    : label;
                  return (
                    <RailItem
                      key={tab.id}
                      tab={tab}
                      label={label}
                      active={isActive}
                      title={title}
                      community={isCommunity}
                      iconOnly={!isMdUp}
                      onClick={() => navigate(tab.to)}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <BreadcrumbBar />
        <Outlet />
      </div>
    </div>
  );
}
