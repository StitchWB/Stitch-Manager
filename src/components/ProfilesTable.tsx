import { Globe, PlayCircle, Trash2, Settings, MoreHorizontal } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { t } from '../lib/i18n';
import { Button, EmptyState, Input, Select } from './ui';
import { LayoutGrid } from 'lucide-react';
import { ScenarioReplayModal } from './scenarioRecorder/ScenarioReplayModal';
import { getProfileSettings, saveProfileSettings } from '@/lib/tauri/modules/profiles';
import { useScenarioRecorder } from '@/lib/scenarioRecorder/useScenarioRecorder';
import { checkBrowserRuntimeOnce } from '@/lib/scenarioRecorder/runtimeCheck';
import { toast } from 'sonner';
import { startPythonJob } from '@/lib/tauri/modules/pythonJobs';

export interface ProfileItem {
  alias: string;
  linkedAccountEmail: string | null;
  linkedProvider?: string | null;
  linkedAccountId?: number | null;
  usedForKiro?: boolean;
  usedTargets?: string[];
  healthStatus?: 'ready' | 'needs_link' | 'no_session_path';
}

interface ProfilesTableProps {
  profiles: ProfileItem[];
  onOpen: (alias: string, target: string, customUrl?: string) => Promise<void>;
  onEdit: (alias: string) => void;
  onStartAutoreg: (
    alias: string,
    targetProvider: string,
    preset?: 'kiro_via_aws_session',
    awsBootstrapAccountId?: number
  ) => void;
  onDelete: (alias: string) => Promise<void>;
  profileFilter: 'all' | 'standalone' | 'linked' | 'used_kiro';
  onProfileFilterChange: (value: 'all' | 'standalone' | 'linked' | 'used_kiro') => void;
}

export default function ProfilesTable({
  profiles,
  onOpen,
  onEdit,
  onStartAutoreg,
  onDelete,
  profileFilter,
  onProfileFilterChange,
}: ProfilesTableProps) {
  const [openTarget, setOpenTarget] = useState<string>('kiro');
  const [customUrl, setCustomUrl] = useState('');
  const recorder = useScenarioRecorder();
  const [activeRecordAlias, setActiveRecordAlias] = useState<string | null>(null);
  const [replayAlias, setReplayAlias] = useState<string | null>(null);
  const [replayInitialScenarioPath, setReplayInitialScenarioPath] = useState<string | null>(null);
  const [openMenuAlias, setOpenMenuAlias] = useState<string | null>(null);
  const menuContainerRef = useRef<HTMLDivElement | null>(null);
  const canEdit = typeof onEdit === 'function';

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
      if (!menuContainerRef.current) {
        return;
      }

      if (!menuContainerRef.current.contains(event.target as Node)) {
        setOpenMenuAlias(null);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenMenuAlias(null);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [openMenuAlias]);

  useEffect(() => {
    if (recorder.state.status === 'done') {
      const savedPath = recorder.state.scenarioPath?.trim();
      const savedAlias = activeRecordAlias;

      if (savedAlias && savedPath) {
        void (async () => {
          try {
            const existing = await getProfileSettings({ alias: savedAlias });
            const current = existing?.settings ?? {
              version: 1,
              network: {},
              geo: {},
              hardware: {},
              storage: {},
            };
            await saveProfileSettings({
              alias: savedAlias,
              settings: {
                ...current,
                storage: {
                  ...(current.storage ?? {}),
                  lastScenarioPath: savedPath,
                },
              },
            });
          } catch {
            // best effort only
          }
        })();
      }

      if (recorder.state.scenarioPath) {
        toast.success(`${t('recorder.saved')}: ${recorder.state.scenarioPath}`);
      } else {
        toast.success(t('recorder.saved'));
      }
      queueMicrotask(() => setActiveRecordAlias(null));
      return;
    }

    if (recorder.state.status === 'error') {
      toast.error(recorder.state.error || t('recorder.failed'));
      queueMicrotask(() => setActiveRecordAlias(null));
      return;
    }

    if (recorder.state.status === 'stopping') {
      toast.info(t('recorder.stopping'));
    }
  }, [activeRecordAlias, recorder.state.error, recorder.state.scenarioPath, recorder.state.status]);

  const buildScenarioName = (alias: string) => {
    const now = new Date();
    const pad = (v: number) => String(v).padStart(2, '0');
    const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const safeAlias = alias.replace(/[^a-zA-Z0-9._-]+/g, '_');
    return `rec_${safeAlias}_${ts}`;
  };

  const startQuickRecording = async (alias: string) => {
    if (
      recorder.state.status === 'starting' ||
      recorder.state.status === 'recording' ||
      recorder.state.status === 'stopping'
    ) {
      toast.error('Another recording is already running. Stop it first.');
      return;
    }

    const runtime = await checkBrowserRuntimeOnce();
    if (!runtime.installed) {
      toast.error(t('recorder.runtimeMissing'));
      return;
    }

    let targetUrl = resolveTargetUrl(openTarget, customUrl) || 'https://google.com';
    let configJson = '';

    try {
      const record = await getProfileSettings({ alias });
      const fromSettings = record?.settings?.storage?.lastUrl?.trim();
      if (fromSettings) {
        targetUrl = fromSettings;
      }

      const cfg: Record<string, unknown> = {
        locale: record?.settings?.geo?.locale ?? undefined,
        timezone_id: record?.settings?.geo?.timezone ?? 'Auto',
        geolocation:
          typeof record?.settings?.geo?.latitude === 'number' &&
          typeof record?.settings?.geo?.longitude === 'number'
            ? {
                latitude: record.settings.geo.latitude,
                longitude: record.settings.geo.longitude,
                accuracy: 50,
              }
            : 'Auto',
        proxy: record?.settings?.network?.proxy?.enabled
          ? (record.settings.network.proxy?.url ?? undefined)
          : undefined,
        cookies: record?.settings?.storage?.cookies ?? undefined,
      };
      configJson = JSON.stringify(cfg, null, 2);
    } catch {
      // best effort; keep defaults
    }

    await recorder.start({
      alias,
      url: targetUrl,
      scenarioName: buildScenarioName(alias),
      configJson,
    });

    // Best-effort: simulate a click on the page to validate recorder wiring.
    // This helps detect "0 steps" cases early even if user doesn't interact.
    try {
      await startPythonJob({
        scriptPath: 'python/_recorder_self_test.py',
        args: ['--alias', alias],
        timeoutMs: 8_000,
      });
    } catch {
      // ignore
    }

    setActiveRecordAlias(alias);
    toast.success(t('recorder.started'));
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

    setReplayInitialScenarioPath(initialPath);
    setReplayAlias(alias);
  };

  if (profiles.length === 0) {
    return (
      <EmptyState
        icon={LayoutGrid}
        title={t('accounts.noProfilesFound')}
        description={t('accounts.noProfilesFoundDesc')}
      />
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden px-2 sm:px-4">
      <div className="hidden xl:grid grid-cols-[minmax(260px,1fr)_140px_minmax(460px,auto)] gap-4 py-3 px-4 border-b border-white/5 sticky top-0 bg-[#050508]/95 backdrop-blur-md z-40">
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
          {t('accounts.profileAlias')}
        </span>
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest text-center">
          {t('accounts.profileKind')}
        </span>
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest text-right pr-4">
          {t('common.actions')}
        </span>
      </div>

      <div className="flex flex-wrap items-end gap-2 px-4 py-3 border-b border-white/5 bg-[#0b0d12]/60">
        <div className="flex flex-col gap-1">
          <span className="text-[10px] leading-4 uppercase tracking-widest text-slate-500">
            {t('accounts.profilesFilterLabel')}
          </span>
          <Select
            value={profileFilter}
            onValueChange={value =>
              onProfileFilterChange(value as 'all' | 'standalone' | 'linked' | 'used_kiro')
            }
            className="h-8 py-1 text-xs"
          >
            <option value="all">{t('accounts.profilesFilterAll')}</option>
            <option value="standalone">{t('accounts.profilesFilterStandalone')}</option>
            <option value="linked">{t('accounts.profilesFilterLinked')}</option>
            <option value="used_kiro">{t('accounts.profilesFilterUsedForKiro')}</option>
          </Select>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-[10px] leading-4 uppercase tracking-widest text-slate-500">
            {t('accounts.profileDestinationLabel')}
          </span>
          <Select value={openTarget} onValueChange={setOpenTarget} className="h-8 py-1 text-xs">
            <option value="kiro">Kiro</option>
            <option value="windsurf">Windsurf</option>
            <option value="trae">Trae</option>
            <option value="github">GitHub</option>
            <option value="custom">{t('accounts.profileDestinationCustom')}</option>
          </Select>
        </div>

        {openTarget === 'custom' && (
          <div className="flex flex-col gap-1 min-w-[260px] flex-1">
            <span className="text-[10px] leading-4 uppercase tracking-widest text-slate-500">
              URL
            </span>
            <Input
              type="text"
              value={customUrl}
              onChange={e => setCustomUrl(e.target.value)}
              placeholder={t('accounts.profileOpenUrlPlaceholder')}
              className="h-8 py-1 text-xs"
            />
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto scrollbar-thin scrollbar-track-transparent scrollbar-thumb-white/10 pb-8 pt-2 space-y-1.5">
        {profiles.map(profile => {
          const isLinked = Boolean(profile.linkedAccountEmail);

          return (
            <div
              key={profile.alias}
              className="relative rounded-xl border bg-[#0f1115]/60 border-white/[0.03] hover:border-white/[0.08] hover:bg-[#161920] transition-all duration-200 overflow-visible"
            >
              <div className="grid grid-cols-1 xl:grid-cols-[minmax(260px,1fr)_140px_minmax(460px,auto)] gap-4 items-start xl:items-center px-4 py-3.5">
                <div className="flex flex-col min-w-0 xl:pr-2">
                  <span className="text-sm leading-5 font-bold text-slate-100 truncate">
                    {profile.alias}
                  </span>
                  {profile.linkedAccountEmail && (
                    <span className="text-[11px] text-slate-400 truncate">
                      {profile.linkedAccountEmail}
                    </span>
                  )}
                  {!!profile.usedTargets?.length && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {profile.usedTargets.slice(0, 3).map(target => (
                        <span
                          key={`${profile.alias}-${target}`}
                          className="px-1.5 py-0.5 text-[10px] rounded border bg-cyan-500/10 text-cyan-300 border-cyan-500/20"
                        >
                          {target}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex xl:justify-center">
                  <div className="flex flex-col items-center gap-1">
                    <span
                      className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide border ${
                        isLinked
                          ? 'bg-indigo-500/10 text-indigo-300 border-indigo-500/20'
                          : 'bg-white/5 text-slate-300 border-white/10'
                      }`}
                    >
                      {isLinked
                        ? t('accounts.profileKindLinked')
                        : t('accounts.profileKindStandalone')}
                    </span>

                    {profile.healthStatus && (
                      <span
                        className={`px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wide border ${
                          profile.healthStatus === 'ready'
                            ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
                            : profile.healthStatus === 'needs_link'
                              ? 'bg-amber-500/10 text-amber-300 border-amber-500/20'
                              : 'bg-rose-500/10 text-rose-300 border-rose-500/20'
                        }`}
                      >
                        {profile.healthStatus === 'ready'
                          ? t('accounts.profileHealthReady')
                          : profile.healthStatus === 'needs_link'
                            ? t('accounts.profileHealthNeedsLink')
                            : t('accounts.profileHealthNoSession')}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-start xl:justify-end gap-2 border-t xl:border-t-0 border-white/5 pt-2 xl:pt-0 min-w-0 max-w-full">
                  <Button
                    size="xs"
                    variant="secondary"
                    leftIcon={<Globe size={12} />}
                    onClick={() => {
                      void onOpen(profile.alias, openTarget, customUrl);
                    }}
                  >
                    <span className="hidden sm:inline">{t('accounts.openProfileAt')}</span>
                    <span className="sm:hidden">Open</span>
                  </Button>
                  <Button
                    size="xs"
                    variant="secondary"
                    onClick={() => void startQuickRecording(profile.alias)}
                    disabled={
                      recorder.state.status === 'starting' ||
                      recorder.state.status === 'recording' ||
                      recorder.state.status === 'stopping'
                    }
                  >
                    <span className="hidden sm:inline">
                      {activeRecordAlias === profile.alias && recorder.state.status !== 'done'
                        ? 'REC…'
                        : t('common.record') || 'Record'}
                    </span>
                    <span className="sm:hidden">
                      {activeRecordAlias === profile.alias && recorder.state.status !== 'done'
                        ? 'REC…'
                        : 'Rec'}
                    </span>
                  </Button>
                  <Button
                    size="xs"
                    variant="secondary"
                    onClick={() => {
                      void openReplayForAlias(profile.alias);
                    }}
                  >
                    <span className="hidden sm:inline">{t('common.replay') || 'Replay'}</span>
                    <span className="sm:hidden">Play</span>
                  </Button>
                  <Button
                    size="xs"
                    variant="secondary"
                    onClick={async () => {
                      try {
                        const record = await getProfileSettings({ alias: profile.alias });
                        const fromSettings =
                          record?.settings?.storage?.lastScenarioPath?.trim() ?? null;
                        if (!fromSettings) {
                          toast.error(t('recorder.noSavedScenarioPath'));
                          return;
                        }
                        setReplayInitialScenarioPath(fromSettings);
                        setReplayAlias(profile.alias);
                      } catch {
                        toast.error('Failed to load last scenario');
                      }
                    }}
                  >
                    <span className="hidden sm:inline">Replay last</span>
                    <span className="sm:hidden">Last</span>
                  </Button>
                  <div
                    className="relative"
                    ref={openMenuAlias === profile.alias ? menuContainerRef : null}
                  >
                    <Button
                      size="xs"
                      variant="secondary"
                      leftIcon={<MoreHorizontal size={12} />}
                      onClick={() =>
                        setOpenMenuAlias(current =>
                          current === profile.alias ? null : profile.alias
                        )
                      }
                    >
                      <span className="hidden sm:inline">{t('common.more') || 'More'}</span>
                      <span className="sm:hidden">More</span>
                    </Button>
                    {openMenuAlias === profile.alias ? (
                      <div className="absolute right-0 top-full mt-2 w-56 rounded-lg border border-white/10 bg-[#0b0d12] p-1 shadow-xl shadow-black/40 z-50">
                        {canEdit ? (
                          <Button
                            size="xs"
                            variant="secondary"
                            className="w-full justify-start"
                            leftIcon={<Settings size={12} />}
                            onClick={() => {
                              setOpenMenuAlias(null);
                              onEdit(profile.alias);
                            }}
                          >
                            {t('common.settings')}
                          </Button>
                        ) : null}
                        <Button
                          size="xs"
                          variant="secondary"
                          className="w-full justify-start"
                          leftIcon={<PlayCircle size={12} />}
                          onClick={() => {
                            setOpenMenuAlias(null);
                            const targetProvider = openTarget === 'custom' ? 'kiro' : openTarget;
                            onStartAutoreg(profile.alias, targetProvider);
                          }}
                        >
                          {t('accounts.startAutoregFromProfile')}
                        </Button>
                        <Button
                          size="xs"
                          variant="secondary"
                          className="w-full justify-start"
                          onClick={() => {
                            setOpenMenuAlias(null);
                            onStartAutoreg(
                              profile.alias,
                              'kiro',
                              'kiro_via_aws_session',
                              profile.linkedProvider === 'aws' ||
                                profile.linkedProvider === 'aws_builder_id'
                                ? (profile.linkedAccountId ?? undefined)
                                : undefined
                            );
                          }}
                        >
                          {t('accounts.startAutoregKiroViaAws')}
                        </Button>
                        <div className="my-1 border-t border-white/10" />
                        <Button
                          size="xs"
                          variant="danger"
                          className="w-full justify-start"
                          leftIcon={<Trash2 size={12} />}
                          onClick={() => {
                            setOpenMenuAlias(null);
                            void onDelete(profile.alias);
                          }}
                        >
                          {t('accounts.deleteProfile')}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <ScenarioReplayModal
        alias={replayAlias}
        isOpen={Boolean(replayAlias)}
        onClose={() => {
          setReplayAlias(null);
          setReplayInitialScenarioPath(null);
        }}
        defaultUrl={resolveTargetUrl(openTarget, customUrl)}
        defaultScenarioPath={replayInitialScenarioPath ?? undefined}
      />
    </div>
  );
}
