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
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

import { Badge, Tooltip } from '@/components/ui';
import { ButtonBase } from '@/components/ui/ButtonBase';
import { t } from '@/lib/i18n';
import {
  fetchServicePlugins,
  getServicePlugins,
  subscribeServicePlugins,
} from '@/lib/backend/modules/servicePlugins';
import { useAppStore } from '@/stores/app';
import { useAuthStore } from '@/stores/auth';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/utils';

type AiTabId =
  | 'overview'
  | 'providers'
  | 'routing'
  | 'connections'
  | 'monitor'
  | 'chat'
  | 'tools'
  | 'antigravity'
  | 'notebooklm';

interface AiTabChild {
  id: string;
  label: string;
  to: string;
  /** Query-param value under the parent route that marks this child active. */
  tabParam: string;
}

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
  /** Sub-pages rendered indented under this item; active via ?tab= param. */
  children?: AiTabChild[];
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
    tabs: [{ id: 'overview', label: 'Overview', to: '/ai', icon: LayoutDashboard }],
  },
  {
    id: 'sources',
    header: 'aiHub.groups.sources',
    tabs: [
      { id: 'providers', label: 'aiHub.tabs.providers', to: '/ai/providers', icon: Server },
      { id: 'antigravity', label: 'aiHub.tabs.antigravity', to: '/ai/antigravity', icon: Orbit },
    ],
  },
  {
    id: 'processing',
    header: 'aiHub.groups.processing',
    tabs: [
      { id: 'routing', label: 'aiHub.tabs.routing', to: '/ai/routing', icon: Route },
      { id: 'connections', label: 'Connections', to: '/ai/integrations', icon: Cable },
      { id: 'monitor', label: 'aiHub.tabs.monitor', to: '/ai/monitor', icon: Activity },
    ],
  },
  {
    id: 'usage',
    header: 'aiHub.groups.usage',
    tabs: [
      { id: 'chat', label: 'aiHub.tabs.chat', to: '/ai/chat', icon: MessageSquare },
      {
        id: 'tools',
        label: 'aiHub.tabs.tools',
        to: '/ai/tools',
        icon: Wrench,
        children: [
          { id: 'compression', label: 'aiHub.tabs.compression', to: '/ai/tools?tab=compression', tabParam: 'compression' },
          { id: 'holone', label: 'aiHub.tabs.holone', to: '/ai/tools?tab=holone', tabParam: 'holone' },
        ],
      },
      { id: 'notebooklm', label: 'aiHub.tabs.notebooklm', to: '/ai/notebooklm', icon: BookOpen },
    ],
  },
];

function activeTab(pathname: string): AiTabId {
  if (pathname === '/ai' || pathname === '/ai/overview') return 'overview';
  if (pathname.startsWith('/ai/gateway')) return 'providers';
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

interface RailSubItemProps {
  child: AiTabChild;
  label: string;
  active: boolean;
  onClick: () => void;
}

function RailSubItem({ child, label, active, onClick }: RailSubItemProps) {
  return (
    <ButtonBase
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      title={label}
      data-testid={`ai-hub-rail-subitem-${child.id}`}
      className={cn(
        'flex h-7 w-full items-center rounded-md border border-transparent py-1 pl-2.5 pr-2 text-left text-[11px] font-medium transition-colors duration-150',
        active
          ? 'border-white/[0.08] bg-white/[0.05] text-white'
          : 'text-slate-400 hover:bg-white/[0.035] hover:text-slate-200'
      )}
    >
      <span className="truncate whitespace-nowrap">{label}</span>
    </ButtonBase>
  );
}

export function AiHubLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const language = useAppStore(state => state.language);
  const authEnabled = useAuthStore(state => state.enabled);
  const isMdUp = useMediaQuery('(min-width: 768px)');
  const current = activeTab(location.pathname);
  const tabParam = new URLSearchParams(location.search).get('tab');

  const plugins = useSyncExternalStore(
    subscribeServicePlugins,
    getServicePlugins,
    getServicePlugins,
  );

  // Fetch service plugins on mount. The layout mounts on navigation to any
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
    if (tab.id === 'overview') return language === 'ru' ? 'Обзор' : 'Overview';
    if (tab.id === 'connections') return language === 'ru' ? 'Подключения' : 'Connections';
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
                  const activeChild =
                    current === tab.id
                      ? tab.children?.find(child => child.tabParam === tabParam)
                      : undefined;
                  const isActive = tab.pluginId
                    ? location.pathname.startsWith('/ai/plugin/' + tab.pluginId)
                    : current === tab.id && !activeChild;
                  const label = resolveLabel(tab);
                  const isCommunity = tab.source === 'community';
                  const title = isCommunity
                    ? `${label} — ${t('admin.plugins.servicePluginCommunityTabTooltip')}`
                    : label;
                  return (
                    <div key={tab.id} className="flex flex-col gap-0.5">
                      <RailItem
                        tab={tab}
                        label={label}
                        active={isActive}
                        title={title}
                        community={isCommunity}
                        iconOnly={!isMdUp}
                        onClick={() => navigate(tab.to)}
                      />
                      {tab.children && tab.children.length > 0 && (
                        <div
                          className="hidden ml-4 flex-col gap-0.5 border-l border-white/[0.08] pl-1 md:flex"
                          data-testid={`ai-hub-rail-subitems-${tab.id}`}
                        >
                          {tab.children.map(child => (
                            <RailSubItem
                              key={child.id}
                              child={child}
                              label={getLabel(child.label)}
                              active={activeChild?.id === child.id}
                              onClick={() => navigate(child.to)}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}
