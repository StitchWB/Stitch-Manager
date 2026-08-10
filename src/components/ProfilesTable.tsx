import { t } from "@/lib/i18n";
import { Globe, Trash2, Settings, FolderKanban, MoreHorizontal } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';

import { LayoutGrid } from 'lucide-react';
import { ScenarioReplayModal } from './scenarioRecorder/ScenarioReplayModal';
import { ScenarioRecordModal } from './scenarioRecorder/ScenarioRecordModal';
import { getProfileSettings, saveProfileSettings } from '@/lib/backend/modules/profiles';
import { ProfileScenariosPanel } from './scenarioRecorder/ProfileScenariosPanel';
import { Badge, Button, ConfirmActionButton, ConfirmDialog, EmptyState, IconButton, ProviderLogo, Tooltip } from '@/components/ui';
import { EngineToggle } from './profiles/EngineToggle';
import { normalizeBrowserEngine, type BrowserEngineId } from '@/lib/browser/engines';

export interface ProfileItem {
  alias: string;
  displayName?: string;
  linkedAccountEmail: string | null;
  linkedProvider?: string | null;
  linkedAccountId?: number | null;
  usedForKiro?: boolean;
  usedTargets?: string[];
  healthStatus?: 'ready' | 'needs_link' | 'no_session_path';
  engine?: BrowserEngineId;
}

function getHealthBadgeConfig(healthStatus: NonNullable<ProfileItem['healthStatus']>): {
  variant: 'success' | 'warning' | 'danger';
  label: string;
} {
  switch (healthStatus) {
    case 'ready':
      return { variant: 'success', label: t('accounts.profileHealthReady') };
    case 'needs_link':
      return { variant: 'warning', label: t('accounts.profileHealthNeedsLink') };
    case 'no_session_path':
      return { variant: 'danger', label: t('accounts.profileHealthNoSession') };
  }
}

interface ProfilesTableProps {
  profiles: ProfileItem[];
  onOpen: (alias: string, target: string, customUrl?: string) => Promise<void>;
  onOpenScenarios?: (alias: string) => void;
  onEdit: (alias: string) => void;
  onDelete: (alias: string) => Promise<void>;
  openTarget: string;
  customUrl: string;
  shardAvailable?: boolean;
}

export default function ProfilesTable({
  profiles,
  onOpen,
  onOpenScenarios,
  onEdit,
  onDelete,
  openTarget,
  customUrl,
  shardAvailable = false,
}: ProfilesTableProps) {
  const [activeRecordAlias, setActiveRecordAlias] = useState<string | null>(null);
  const [activeRecordMeta, setActiveRecordMeta] = useState<{
    alias: string;
    scenarioName: string;
    startUrl: string;
  } | null>(null);
  const [activeRecordQuickStart, setActiveRecordQuickStart] = useState(false);
  const [replayAlias, setReplayAlias] = useState<string | null>(null);
  const [replayInitialScenarioPath, setReplayInitialScenarioPath] = useState<string | null>(null);
  const [scenariosAlias, setScenariosAlias] = useState<string | null>(null);
  const [openMenuAlias, setOpenMenuAlias] = useState<string | null>(null);
  const [engineOverrides, setEngineOverrides] = useState<Record<string, BrowserEngineId>>({});
  const [engineConfirm, setEngineConfirm] = useState<{
    alias: string;
    newEngine: BrowserEngineId;
    currentEngine: BrowserEngineId;
    hasPriorUsage: boolean;
  } | null>(null);
  const [engineSaving, setEngineSaving] = useState<string | null>(null);
  const menuContainerRef = useRef<HTMLDivElement | null>(null);
  const menuTriggerRef = useRef<HTMLElement | null>(null);
  const [menuPosition, setMenuPosition] = useState<{top: number;left: number;} | null>(null);
  const portalRoot = typeof document !== 'undefined' ? document.body : null;
  const canEdit = typeof onEdit === 'function';

  const closeMenu = () => {
    setOpenMenuAlias(null);
    setMenuPosition(null);
    menuTriggerRef.current = null;
  };

  const calculateMenuPosition = useCallback((triggerEl: HTMLElement) => {
    menuTriggerRef.current = triggerEl;

    const rect = triggerEl.getBoundingClientRect();
    const margin = 8;
    const menuWidth = 208; // w-52
    const estimatedMenuHeight = menuContainerRef.current?.offsetHeight ?? 180;

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    const left = Math.min(
      Math.max(rect.right - menuWidth, margin),
      viewportWidth - menuWidth - margin
    );

    const availableBelow = Math.max(0, viewportHeight - rect.bottom - margin);
    const availableAbove = Math.max(0, rect.top - margin);
    const openUp = availableBelow < estimatedMenuHeight && availableAbove > availableBelow;

    const top = openUp ?
    Math.max(margin, rect.top - estimatedMenuHeight - margin) :
    Math.min(
      rect.bottom + margin,
      Math.max(margin, viewportHeight - estimatedMenuHeight - margin)
    );

    return { top, left };
  }, []);

  const openMenu = (alias: string, triggerEl: HTMLElement) => {
    const nextPos = calculateMenuPosition(triggerEl);
    setMenuPosition(nextPos);
    setOpenMenuAlias(alias);
  };

  const resolveTargetUrl = (target: string, custom?: string): string | undefined => {
    if (target === 'custom') {
      const trimmed = (custom ?? '').trim();
      return trimmed.length > 0 ? trimmed : undefined;
    }

    switch (target) {
      case 'kiro':
        // For generic profile open/record flows, start from neutral page.
        // Product-specific targets (Kiro registration) are handled by AutoReg flow.
        return 'https://google.com';
      case 'windsurf':
        return 'https://codeium.com/profile';
      case 'github':
        return 'https://github.com/settings/profile';
      case 'trae':
        return 'https://trae.sh/';
      default:
        return undefined;
    }
  };

  useEffect(() => {
    if (!openMenuAlias) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      const insideMenu = menuContainerRef.current?.contains(target) ?? false;
      const insideTrigger = menuTriggerRef.current?.contains(target) ?? false;
      if (!insideMenu && !insideTrigger) closeMenu();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeMenu();
      }
    };

    const handleScrollOrResize = () => {
      const triggerEl = menuTriggerRef.current;
      if (!triggerEl || !triggerEl.isConnected) {
        closeMenu();
        return;
      }
      setMenuPosition(calculateMenuPosition(triggerEl));
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [calculateMenuPosition, openMenuAlias]);

  useEffect(() => {
    if (!openMenuAlias) return;
    const trigger = menuTriggerRef.current;
    if (!trigger) return;

    const raf = window.requestAnimationFrame(() => {
      const currentTrigger = menuTriggerRef.current;
      if (!currentTrigger) return;
      setMenuPosition(calculateMenuPosition(currentTrigger));
    });

    return () => window.cancelAnimationFrame(raf);
  }, [calculateMenuPosition, openMenuAlias]);

  const buildScenarioName = (alias: string) => {
    const now = new Date();
    const pad = (v: number) => String(v).padStart(2, '0');
    const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const safeAlias = alias.replace(/[^a-zA-Z0-9._-]+/g, '_');
    return `rec_${safeAlias}_${ts}`;
  };

  const openRecordModal = (alias: string, options?: {quickStart?: boolean;}) => {
    setReplayAlias(null);
    setReplayInitialScenarioPath(null);
    setActiveRecordQuickStart(Boolean(options?.quickStart));
    setActiveRecordAlias(alias);
    setActiveRecordMeta({
      alias,
      scenarioName: buildScenarioName(alias),
      startUrl: resolveTargetUrl(openTarget, customUrl) || 'https://google.com'
    });
  };

  const openReplayModal = (alias: string, scenarioPath?: string | null) => {
    setActiveRecordAlias(null);
    setActiveRecordMeta(null);
    setActiveRecordQuickStart(false);
    setReplayInitialScenarioPath(scenarioPath?.trim() ? scenarioPath.trim() : null);
    setReplayAlias(alias);
  };

  const openReplayForAlias = async (alias: string) => {
    let initialPath: string | null = null;
    try {
      const record = await getProfileSettings({ alias });
      const fromSettings = record?.settings?.storage?.lastScenarioPath?.trim();
      if (fromSettings) {
        initialPath = fromSettings;
      }
    } catch {

      // best effort
    }
    openReplayModal(alias, initialPath);
  };

  const resolveProfileEngine = (profile: ProfileItem): BrowserEngineId => {
    return engineOverrides[profile.alias] ?? profile.engine ?? 'cloakbrowser';
  };

  const handleEngineChange = async (alias: string, newEngine: BrowserEngineId) => {
    const current = engineOverrides[alias] ?? profiles.find(p => p.alias === alias)?.engine ?? 'cloakbrowser';
    if (current === newEngine) return;

    // Check for prior usage: the profile was launched (storage.lastUrl set)
    // OR an engine was explicitly saved before and differs from the new one
    // (browser state may exist for that engine). Fresh profiles switch silently.
    let hasPriorUsage = false;
    try {
      const record = await getProfileSettings({ alias });
      const lastUrl = record?.settings?.storage?.lastUrl?.trim();
      const explicitEngine = record?.settings?.engine ?? null;
      hasPriorUsage =
        Boolean(lastUrl) ||
        (explicitEngine !== null && normalizeBrowserEngine(explicitEngine) !== newEngine);
    } catch {
      // If we can't load settings, don't block the switch.
    }

    if (hasPriorUsage) {
      setEngineConfirm({ alias, newEngine, currentEngine: current, hasPriorUsage });
      return;
    }

    await applyEngineChange(alias, newEngine);
  };

  const applyEngineChange = async (alias: string, newEngine: BrowserEngineId) => {
    setEngineSaving(alias);
    try {
      const record = await getProfileSettings({ alias });
      const settings = record?.settings ?? {
        version: 1,
        network: {},
        geo: {},
        hardware: {},
        storage: {},
      };
      await saveProfileSettings({ alias, settings: { ...settings, engine: newEngine } });
      setEngineOverrides(prev => ({ ...prev, [alias]: newEngine }));
      toast.success(t('accounts.profileEngineSaved'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('accounts.profileEngineSaveFailed'));
    } finally {
      setEngineSaving(null);
    }
  };

  const confirmEngineChange = async () => {
    if (!engineConfirm) return;
    const { alias, newEngine } = engineConfirm;
    setEngineConfirm(null);
    await applyEngineChange(alias, newEngine);
  };

  if (profiles.length === 0) {
    return (
      <EmptyState
        icon={LayoutGrid}
        title={t('accounts.noProfilesFound')}
        description={t('accounts.noProfilesFoundDesc')} />);


  }

  return (
    <div className="flex flex-col h-full overflow-hidden px-2 sm:px-4">
      <div className="hidden xl:grid grid-cols-[minmax(240px,1fr)_120px_minmax(150px,200px)_104px_minmax(130px,180px)_minmax(280px,auto)] gap-4 py-3 px-4 border-b border-white/10 sticky top-0 bg-void-base/95 backdrop-blur-md z-40">
        <span className="text-xs font-semibold text-slate-400 tracking-wide">
          {t('accounts.profileAlias')}
        </span>
        <span className="text-xs font-semibold text-slate-400 tracking-wide text-center">
          {t('accounts.profileKind')}
        </span>
        <span className="text-xs font-semibold text-slate-400 tracking-wide">
          {t('accounts.profileAccount')}
        </span>
        <span className="text-xs font-semibold text-slate-400 tracking-wide text-center">
          {t('accounts.profileStatus')}
        </span>
        <span className="text-xs font-semibold text-slate-400 tracking-wide">
          {t('accounts.profileUsage')}
        </span>
        <span className="text-xs font-semibold text-slate-400 tracking-wide text-right pr-4">
          {t('common.actions')}
        </span>
      </div>

      <div className="flex-1 overflow-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10 pb-8 pt-2 space-y-1.5">
        {profiles.map((profile) => {
          const isLinked = Boolean(profile.linkedAccountEmail);
          const health = profile.healthStatus ? getHealthBadgeConfig(profile.healthStatus) : null;

          return (
            <div
              key={profile.alias}
              className="relative rounded-lg border bg-vsc-panel/60 border-white/[0.04] hover:border-white/[0.12] hover:bg-vsc-panel transition-all duration-200 overflow-visible">

              <div className="grid grid-cols-1 xl:grid-cols-[minmax(240px,1fr)_120px_minmax(150px,200px)_104px_minmax(130px,180px)_minmax(280px,auto)] gap-4 items-start xl:items-center px-3 py-2">
                <div className="flex flex-col min-w-0 xl:pr-2">
                  <span className="text-sm leading-5 font-bold text-slate-100 truncate">
                    {profile.displayName ?? profile.alias}
                  </span>
                  {profile.displayName && profile.displayName !== profile.alias ?
                  <span className="text-[11px] text-slate-500 truncate font-mono">
                      {profile.alias}
                    </span> :
                  null}
                  {profile.linkedAccountEmail ?
                  <span className="text-[11px] text-slate-500 truncate">
                      {profile.linkedAccountEmail}
                    </span> :
                  null}
                </div>

                <div className="flex xl:justify-center">
                  <div className="flex flex-col items-center gap-1">
                    <span
                      className={`px-2 py-0.5 rounded-md text-[11px] font-semibold tracking-wide border ${
                      isLinked ?
                      'bg-indigo-500/10 text-indigo-300 border-indigo-500/20' :
                      'bg-white/5 text-slate-300 border-white/10'}`
                      }>

                      {isLinked ?
                      t('accounts.profileKindLinked') :
                      t('accounts.profileKindStandalone')}
                    </span>
                    {!isLinked && (
                      <div className="w-28">
                        <EngineToggle
                          value={resolveProfileEngine(profile)}
                          onChange={(engine) => void handleEngineChange(profile.alias, engine)}
                          shardAvailable={shardAvailable}
                          size="sm"
                          disabled={engineSaving === profile.alias}
                        />
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 min-w-0">
                  {profile.linkedAccountEmail ? (
                    <>
                      {profile.linkedProvider ? (
                        <ProviderLogo provider={profile.linkedProvider} size={14} className="shrink-0" />
                      ) : null}
                      <span className="text-[11px] text-slate-300 truncate">
                        {profile.linkedAccountEmail}
                      </span>
                    </>
                  ) : (
                    <span className="text-xs text-slate-600">—</span>
                  )}
                </div>

                <div className="flex xl:justify-center">
                  {health ? (
                    <Badge variant={health.variant} size="sm" withDot className="normal-case tracking-normal border-0">
                      {health.label}
                    </Badge>
                  ) : (
                    <span className="text-xs text-slate-600">—</span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-1 min-w-0">
                  {profile.usedForKiro ? (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-sky-500/10 text-sky-300 border border-sky-500/20">
                      {t('accounts.profileUsageKiro')}
                    </span>
                  ) : null}
                  {profile.usedTargets?.map(target => (
                    <span key={target} className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-white/5 text-slate-400 border border-white/10">
                      {target}
                    </span>
                  ))}
                  {!profile.usedForKiro && (!profile.usedTargets || profile.usedTargets.length === 0) ? (
                    <span className="text-xs text-slate-600">—</span>
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center justify-start xl:justify-end gap-1 border-t xl:border-t-0 border-white/5 pt-2 xl:pt-0 min-w-0 max-w-full">
                  <Tooltip content={`${t('accounts.openProfileAt')}${t('accounts.profiles_table.overlay')}`}>
                    <IconButton
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 text-slate-400 hover:text-sky-300 hover:bg-white/10"
                      onClick={() => {
                        openRecordModal(profile.alias, { quickStart: true });
                      }}
                    >
                      <Globe size={14} />
                    </IconButton>
                  </Tooltip>
                  <Tooltip content={t('accounts.profiles_table.scenarios')}>
                    <IconButton
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 w-7 text-slate-400 hover:text-indigo-300 hover:bg-white/10"
                      onClick={() => {
                        if (onOpenScenarios) {
                          onOpenScenarios(profile.alias);
                          return;
                        }
                        setActiveRecordAlias(null);
                        setActiveRecordMeta(null);
                        setActiveRecordQuickStart(false);
                        setReplayAlias(null);
                        setReplayInitialScenarioPath(null);
                        setScenariosAlias(profile.alias);
                      }}
                    >
                      <FolderKanban size={14} />
                    </IconButton>
                  </Tooltip>
                  {canEdit ? (
                    <Tooltip content={t('common.settings')}>
                      <IconButton
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 text-slate-400 hover:text-slate-100 hover:bg-white/10"
                        onClick={() => onEdit(profile.alias)}
                      >
                        <Settings size={14} />
                      </IconButton>
                    </Tooltip>
                  ) : null}
                  <div className="relative">
                    <Tooltip content={t('common.more') || 'More'}>
                      <IconButton
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 text-slate-400 hover:text-slate-100 hover:bg-white/10"
                        onClick={(event) => {
                          event.stopPropagation();
                          const triggerEl = event.currentTarget as unknown as HTMLElement;
                          if (openMenuAlias === profile.alias) {
                            closeMenu();
                          } else {
                            openMenu(profile.alias, triggerEl);
                          }
                        }}
                      >
                        <MoreHorizontal size={14} />
                      </IconButton>
                    </Tooltip>
                  </div>
                </div>
              </div>
            </div>);

        })}
      </div>

      {openMenuAlias && menuPosition && portalRoot ?
      createPortal(
        <div
          ref={menuContainerRef}
          className="fixed z-[9999] w-52 rounded-lg border border-white/10 bg-vsc-terminal p-1 shadow-xl shadow-black/40"
          style={{ top: menuPosition.top, left: menuPosition.left }}>

              <Button
            size="xs"
            variant="secondary"
            className="w-full justify-start"
            onClick={() => {
              closeMenu();
              void onOpen(openMenuAlias, openTarget, customUrl);
            }}>{t("accounts.profiles_table.open_without_overlay")}


          </Button>
              <Button
            size="xs"
            variant="secondary"
            className="w-full justify-start"
            onClick={() => {
              closeMenu();
              openRecordModal(openMenuAlias, { quickStart: true });
            }}>

                {t('common.record') || 'Record'}{t("accounts.profiles_table.overlay")}
          </Button>
              <Button
            size="xs"
            variant="secondary"
            className="w-full justify-start"
            onClick={() => {
              closeMenu();
              void openReplayForAlias(openMenuAlias);
            }}>

                {t('common.replay') || 'Replay'}
              </Button>
              <div className="my-1 border-t border-white/10" />
              <ConfirmActionButton
            size="xs"
            variant="danger"
            className="w-full justify-start"
            leftIcon={<Trash2 size={12} />}
            onConfirm={() => {
              const aliasToDelete = openMenuAlias;
              closeMenu();
              void onDelete(aliasToDelete);
            }}>

                {t('accounts.deleteProfile')}
              </ConfirmActionButton>
            </div>,
        portalRoot
      ) :
      null}

      <ProfileScenariosPanel
        alias={scenariosAlias}
        isOpen={Boolean(scenariosAlias) && !activeRecordAlias && !replayAlias}
        onClose={() => setScenariosAlias(null)}
        onRecord={() => {
          if (!scenariosAlias) return;
          openRecordModal(scenariosAlias, { quickStart: false });
        }}
        onReplay={(scenarioPath?: string) => {
          if (!scenariosAlias) return;
          openReplayModal(scenariosAlias, scenarioPath ?? null);
        }} />


      <ScenarioRecordModal
        alias={activeRecordAlias}
        isOpen={Boolean(activeRecordAlias)}
        onClose={() => {
          setActiveRecordAlias(null);
          setActiveRecordMeta(null);
          setActiveRecordQuickStart(false);
        }}
        defaultUrl={activeRecordMeta?.startUrl}
        defaultScenarioName={activeRecordMeta?.scenarioName}
        quickStart={activeRecordQuickStart} />


      <ScenarioReplayModal
        alias={replayAlias}
        isOpen={Boolean(replayAlias)}
        onClose={() => {
          setReplayAlias(null);
          setReplayInitialScenarioPath(null);
        }}
        defaultUrl={resolveTargetUrl(openTarget, customUrl)}
        defaultScenarioPath={replayInitialScenarioPath ?? undefined} />

      <ConfirmDialog
        isOpen={Boolean(engineConfirm)}
        onClose={() => setEngineConfirm(null)}
        onConfirm={() => void confirmEngineChange()}
        title={t('accounts.profileEngineConfirmTitle')}
        message={t('accounts.profileEngineConfirmMessage')}
        confirmText={t('accounts.profileEngineConfirmAction')}
        cancelText={t('common.cancel')}
        variant="warning"
      />

    </div>);

}