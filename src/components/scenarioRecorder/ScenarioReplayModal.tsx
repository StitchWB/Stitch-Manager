import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Modal, Button, Checkbox, Input, Textarea, Select } from '@/components/ui';
import { t } from '@/lib/i18n';
import { getProfileSettings } from '@/lib/tauri/modules/profiles';
import { useScenarioReplay } from '@/lib/scenarioRecorder/useScenarioReplay';
import { BrowserRuntimeInstallModal } from './BrowserRuntimeInstallModal';
import { checkBrowserRuntimeOnce } from '@/lib/scenarioRecorder/runtimeCheck';
import { getObsTimeline } from '@/lib/tauri/modules/observability';
import {
  listRecordedScenarios,
  markRecordedScenarioPlayed,
  replayPreflight,
  upsertRecordedScenario,
  reindexRecordedScenarios,
  type ReplayPreflightResult,
  type ScenarioRecordItem,
} from '@/lib/tauri/modules/pythonJobs';
import { copyToClipboard, openInFileManager } from '@/lib/tauri/modules/utils';
import { buildRunnerConfigFromProfileSettings } from '@/lib/scenarioRecorder/configBuilder';
import { toast } from 'sonner';
import { formatProfileAlias } from '@/lib/profiles/displayName';

type ScenarioReplayModalProps = {
  alias: string | null;
  isOpen: boolean;
  onClose: () => void;
  defaultUrl?: string;
  defaultScenarioPath?: string;
  quickStart?: boolean;
};

function beep() {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.value = 0.07;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.2);
    setTimeout(() => {
      void ctx.close();
    }, 280);
  } catch {
    // noop
  }
}

export function ScenarioReplayModal({
  alias,
  isOpen,
  onClose,
  defaultUrl = 'https://google.com',
  defaultScenarioPath = '',
  quickStart = false,
}: ScenarioReplayModalProps) {
  const replay = useScenarioReplay();
  const displayAlias = formatProfileAlias(alias);
  const [runtimeModalOpen, setRuntimeModalOpen] = useState(false);
  const [scenarioPath, setScenarioPath] = useState('');
  const scenarioPathTouchedRef = useRef(false);
  const [startUrl, setStartUrl] = useState(defaultUrl);
  const [configJson, setConfigJson] = useState<string>('');
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [continueOnError, setContinueOnError] = useState(false);
  const [runtimeInstalled, setRuntimeInstalled] = useState<boolean | null>(null);
  const [runtimeCheckError, setRuntimeCheckError] = useState<string | null>(null);
  const [runtimeChecking, setRuntimeChecking] = useState(false);
  const [autoStarted, setAutoStarted] = useState(false);
  const [timelineLoading, setTimelineLoading] = useState(false);
  const [timelineEntries, setTimelineEntries] = useState<
    Array<{ ts: string; level: string; message: string }>
  >([]);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [preflight, setPreflight] = useState<ReplayPreflightResult | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [recentScenarioPaths, setRecentScenarioPaths] = useState<string[]>([]);
  const [indexedScenarios, setIndexedScenarios] = useState<ScenarioRecordItem[]>([]);
  const [indexedLoading, setIndexedLoading] = useState(false);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [scenarioQuery, setScenarioQuery] = useState('');
  const [reindexing, setReindexing] = useState(false);
  const announcedPauseRef = useRef(false);

  const deriveScenarioNameFromPath = useCallback((value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return 'scenario';
    const normalized = trimmed.replace(/\\/g, '/');
    const file = normalized.split('/').pop() || 'scenario.json';
    return file.replace(/\.json$/i, '') || 'scenario';
  }, []);

  const refreshIndexedScenarios = useCallback(async () => {
    if (!alias) {
      setIndexedScenarios([]);
      return;
    }

    setIndexedLoading(true);
    setIndexError(null);
    try {
      const indexed = await listRecordedScenarios({ alias, limit: 50 });
      setIndexedScenarios(indexed);
    } catch (e) {
      setIndexedScenarios([]);
      setIndexError(e instanceof Error ? e.message : 'Failed to load saved scenarios');
    } finally {
      setIndexedLoading(false);
    }
  }, [alias]);

  const seedCurrentScenarioIntoIndex = useCallback(async () => {
    if (!alias) return;
    const path = scenarioPath.trim();
    if (!path) return;

    try {
      await upsertRecordedScenario({
        alias,
        name: deriveScenarioNameFromPath(path),
        scenarioPath: path,
        startedUrl: startUrl,
      });
      await refreshIndexedScenarios();
      toast.success('Current scenario added to saved list');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to add scenario to index');
    }
  }, [alias, deriveScenarioNameFromPath, refreshIndexedScenarios, scenarioPath, startUrl]);

  const runReindex = useCallback(async () => {
    if (!alias) return;
    setReindexing(true);
    try {
      const result = await reindexRecordedScenarios({ alias });
      await refreshIndexedScenarios();
      toast.success(`Reindexed: ${result.indexed} (scanned ${result.scannedFiles})`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to reindex scenarios');
    } finally {
      setReindexing(false);
    }
  }, [alias, refreshIndexedScenarios]);

  useEffect(() => {
    if (!isOpen) {
      setAutoStarted(false);
      setTimelineEntries([]);
      setPreflight(null);
      setShowAdvanced(false);
      setRecentScenarioPaths([]);
      scenarioPathTouchedRef.current = false;
      return;
    }
    setStartUrl(defaultUrl);
    setScenarioPath(defaultScenarioPath?.trim() ?? '');
    scenarioPathTouchedRef.current = Boolean(defaultScenarioPath?.trim());
    setAutoStarted(false);
  }, [defaultScenarioPath, defaultUrl, isOpen]);

  useEffect(() => {
    if (!isOpen || !scenarioPath.trim()) {
      setPreflight(null);
      return;
    }

    let cancelled = false;
    const run = async () => {
      setPreflightLoading(true);
      try {
        const result = await replayPreflight(scenarioPath.trim());
        if (!cancelled) setPreflight(result);
      } catch {
        if (!cancelled) {
          setPreflight({
            valid: false,
            totalSteps: 0,
            droppedSteps: 0,
            issues: [{ index: 0, reason: 'invalid scenario file' }],
            healthScore: 0,
            healthNotes: ['cannot parse scenario'],
          });
        }
      } finally {
        if (!cancelled) setPreflightLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [isOpen, scenarioPath]);

  useEffect(() => {
    if (!isOpen || !alias) return;

    let cancelled = false;
    const load = async () => {
      setLoadingSettings(true);
      try {
        const record = await getProfileSettings({ alias });
        if (cancelled) return;

        const built = await buildRunnerConfigFromProfileSettings(record, {
          defaultUrl,
          fallbackUrl: 'https://google.com',
        });

        setConfigJson(built.configJson);
        setStartUrl(built.startUrl);

        if (!scenarioPathTouchedRef.current) {
          const explicit = defaultScenarioPath?.trim() || '';
          const currentScenario = explicit || built.lastScenarioPath || '';
          setScenarioPath(currentScenario);
          scenarioPathTouchedRef.current = Boolean(currentScenario.trim());
        }

        const recent = [
          built.lastScenarioPath,
          defaultScenarioPath?.trim() || null,
          record?.settings?.storage?.lastScenarioPath?.trim() || null,
        ].filter((value): value is string => Boolean(value && value.trim()));
        setRecentScenarioPaths(Array.from(new Set(recent)));

        await refreshIndexedScenarios();
      } catch {
        if (cancelled) return;
        setConfigJson('');
      } finally {
        if (!cancelled) setLoadingSettings(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [alias, defaultScenarioPath, defaultUrl, isOpen, refreshIndexedScenarios]);

  useEffect(() => {
    if (replay.state.status === 'manual_pause') {
      if (!announcedPauseRef.current) {
        beep();
        announcedPauseRef.current = true;
      }
      const timer = window.setInterval(() => beep(), 8000);
      return () => window.clearInterval(timer);
    }
    announcedPauseRef.current = false;
    return;
  }, [replay.state.status]);

  const refreshRuntime = useCallback(async () => {
    setRuntimeChecking(true);
    setRuntimeCheckError(null);
    try {
      const r = await checkBrowserRuntimeOnce();
      setRuntimeInstalled(r.installed);
      setRuntimeCheckError(r.error);
    } finally {
      setRuntimeChecking(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    void refreshRuntime();
  }, [isOpen, refreshRuntime]);

  const canStart = useMemo(() => {
    return Boolean(alias) && scenarioPath.trim().length > 0;
  }, [alias, scenarioPath]);

  const startReplay = useCallback(async () => {
    if (!alias) return;
    await replay.start({
      alias,
      scenarioPath,
      startUrl,
      configJson,
      continueOnError,
    });

    void markRecordedScenarioPlayed({ scenarioPath }).catch(() => {
      // best effort
    });
  }, [alias, configJson, continueOnError, replay, scenarioPath, startUrl]);

  useEffect(() => {
    if (!quickStart || autoStarted) return;
    if (!isOpen || !alias) return;
    if (!canStart) return;
    if (runtimeInstalled !== true) return;
    if (replay.state.status !== 'idle') return;

    setAutoStarted(true);
    void startReplay();
  }, [
    alias,
    autoStarted,
    canStart,
    isOpen,
    quickStart,
    replay.state.status,
    runtimeInstalled,
    startReplay,
  ]);

  useEffect(() => {
    if (!isOpen) return;
    if (!replay.state.jobId && !replay.state.correlationId) return;

    let cancelled = false;
    const refreshTimeline = async () => {
      setTimelineLoading(true);
      try {
        const entries = await getObsTimeline({
          correlationId: replay.state.correlationId,
          jobId: replay.state.jobId ?? undefined,
          limit: 160,
        });
        if (cancelled) return;
        setTimelineEntries(
          entries.map(e => ({ ts: e.timestamp, level: e.level, message: e.message }))
        );
      } catch {
        if (!cancelled) setTimelineEntries([]);
      } finally {
        if (!cancelled) setTimelineLoading(false);
      }
    };

    void refreshTimeline();
    const timer = window.setInterval(() => void refreshTimeline(), 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [isOpen, replay.state.correlationId, replay.state.jobId]);

  const progressLabel = useMemo(() => {
    if (!replay.state.totalSteps) return '—';
    return `${replay.state.currentStep}/${replay.state.totalSteps}`;
  }, [replay.state.currentStep, replay.state.totalSteps]);

  const lastFailedStep = useMemo(() => {
    return replay.state.stepEvents.find(entry => entry.status === 'fail') ?? null;
  }, [replay.state.stepEvents]);

  const hasDiagnosticsPaths = Boolean(replay.state.reportPath || replay.state.artifactsDir);

  const filteredIndexedScenarios = useMemo(() => {
    const q = scenarioQuery.trim().toLowerCase();
    if (!q) return indexedScenarios;
    return indexedScenarios.filter(item => {
      return (
        item.name.toLowerCase().includes(q) ||
        item.scenarioPath.toLowerCase().includes(q) ||
        (item.startedUrl ?? '').toLowerCase().includes(q)
      );
    });
  }, [indexedScenarios, scenarioQuery]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('common.replay') || 'Replay scenario'}
      size="lg"
      footer={
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={() => void replay.sendControl('resume')}
                disabled={replay.state.status !== 'manual_pause'}
              >
                Resume
              </Button>
              <Button
                variant="danger"
                onClick={() => void replay.sendControl('abort')}
                disabled={replay.state.status !== 'manual_pause'}
              >
                Abort
              </Button>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={onClose}>
                {t('common.close')}
              </Button>
              <Button variant="secondary" onClick={() => setRuntimeModalOpen(true)}>
                {t('common.installRuntime') || 'Install runtime'}
              </Button>
              <Button
                variant="danger"
                onClick={() => void replay.stop()}
                disabled={!replay.state.jobId || replay.state.status === 'stopping'}
              >
                {t('common.stop')}
              </Button>
              <Button
                onClick={() => {
                  void startReplay();
                }}
                disabled={
                  !canStart ||
                  preflight?.valid === false ||
                  replay.state.status === 'starting' ||
                  replay.state.status === 'running' ||
                  runtimeInstalled === false
                }
              >
                {t('common.start')}
              </Button>
            </div>
          </div>
          {runtimeInstalled === false ? (
            <div className="text-xs text-amber-300">
              Replay runtime missing. Install it to start playback.
            </div>
          ) : null}
        </div>
      }
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          {t('recorder.proxySwitchRestartWarningReplay')}
        </div>

        <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-3">
          <div>
            <div className="text-xs text-slate-400">Profile</div>
            <div className="text-sm text-slate-200 truncate">{displayAlias}</div>
            {alias && displayAlias !== alias ? (
              <div className="text-[11px] text-slate-500 truncate font-mono">{alias}</div>
            ) : null}
          </div>
          <div
            className={`text-[11px] px-2 py-1 rounded-md border ${
              runtimeInstalled === true
                ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
                : runtimeInstalled === false
                  ? 'border-amber-500/20 bg-amber-500/10 text-amber-200'
                  : 'border-white/10 bg-black/30 text-slate-400'
            }`}
          >
            Runtime{' '}
            {runtimeInstalled === true
              ? 'ready'
              : runtimeInstalled === false
                ? 'missing'
                : 'checking'}
          </div>
        </div>

        <div className="rounded-lg border border-white/10 bg-black/20 p-3">
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="text-xs text-slate-400">Saved scenarios</div>
              <div className="text-sm text-slate-200">Pick a scenario to replay</div>
            </div>
            <Button
              size="xs"
              variant="secondary"
              onClick={() => void refreshIndexedScenarios()}
              disabled={!alias || indexedLoading}
            >
              {indexedLoading ? t('common.loading') : t('common.refresh')}
            </Button>
          </div>

          {indexedScenarios.length > 0 ? (
            <>
              <Input
                value={scenarioQuery}
                onChange={e => setScenarioQuery(e.target.value)}
                placeholder="Search scenarios by name/path/url"
                className="h-9"
              />

              <div className="mt-2 max-h-44 overflow-auto space-y-1 pr-1">
                {filteredIndexedScenarios.length > 0 ? (
                  filteredIndexedScenarios.map(item => {
                    const selected = scenarioPath.trim() === item.scenarioPath;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={`w-full text-left rounded-md border px-2.5 py-2 transition-colors ${
                          selected
                            ? 'border-indigo-500/50 bg-indigo-500/10'
                            : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.05]'
                        }`}
                        onClick={() => {
                          scenarioPathTouchedRef.current = true;
                          setScenarioPath(item.scenarioPath);
                        }}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-sm text-slate-200 truncate">{item.name}</div>
                          <div className="text-[11px] text-slate-400 whitespace-nowrap">
                            {item.stepsCount} steps
                          </div>
                        </div>
                        <div className="mt-1 text-[11px] text-slate-500 truncate">
                          {new Date(item.createdAt).toLocaleString()} • {item.scenarioPath}
                        </div>
                        {item.missing ? (
                          <div className="mt-1 text-[11px] text-amber-300">missing file</div>
                        ) : null}
                      </button>
                    );
                  })
                ) : (
                  <div className="text-xs text-slate-500 py-2">No matches for current query.</div>
                )}
              </div>
            </>
          ) : (
            <div className="space-y-2">
              <div className="text-xs text-slate-500">
                No saved scenarios in index yet. Record a scenario first, then reopen replay.
              </div>
              {indexError ? (
                <div className="text-xs text-amber-300">
                  Failed to load index: {indexError}. If you just updated the app, restart it to
                  load new backend commands.
                </div>
              ) : null}
              {scenarioPath.trim() ? (
                <Button
                  size="xs"
                  variant="secondary"
                  onClick={() => void seedCurrentScenarioIntoIndex()}
                >
                  Add current scenario to saved list
                </Button>
              ) : null}
              <Button
                size="xs"
                variant="secondary"
                onClick={() => void runReindex()}
                disabled={!alias || reindexing}
              >
                {reindexing ? 'Reindexing…' : 'Reindex from folder'}
              </Button>
            </div>
          )}
        </div>

        <Input
          label="Scenario path"
          value={scenarioPath}
          onChange={e => {
            scenarioPathTouchedRef.current = true;
            setScenarioPath(e.target.value);
          }}
          placeholder="C:\\Users\\...\\scenario.json"
          className="h-9"
        />

        {indexedScenarios.length === 0 && recentScenarioPaths.length > 0 && (
          <Select
            label="Recent scenarios"
            value=""
            onValueChange={value => {
              if (!value) return;
              scenarioPathTouchedRef.current = true;
              setScenarioPath(value);
            }}
          >
            <option value="">Select recent scenario...</option>
            {recentScenarioPaths.map(path => (
              <option key={path} value={path}>
                {path}
              </option>
            ))}
          </Select>
        )}

        <div className="rounded-lg border border-white/10 bg-black/20 p-3">
          <div className="text-xs text-slate-400 mb-1">Run health</div>
          {preflightLoading ? (
            <div className="text-xs text-slate-500">Validating scenario…</div>
          ) : preflight ? (
            <div className="space-y-1 text-xs">
              <div className="text-slate-200">
                Valid: {preflight.valid ? 'yes' : 'no'} • Steps: {preflight.totalSteps} • Dropped:{' '}
                {preflight.droppedSteps}
              </div>
              <div className="text-slate-200 font-semibold">
                Health score: {preflight.healthScore}/100
              </div>
              {preflight.healthNotes.some(note => note.includes('proxy.switch')) ? (
                <div className="text-amber-300">{t('proxyLibrary.stepRestartBoundary')}</div>
              ) : null}
              {preflight.issues.length > 0 && (
                <div className="text-amber-300">
                  Issues:{' '}
                  {preflight.issues
                    .slice(0, 5)
                    .map(i => `#${i.index} ${i.reason}`)
                    .join(' • ')}
                </div>
              )}
            </div>
          ) : (
            <div className="text-xs text-slate-500">No scenario loaded</div>
          )}
        </div>

        <div className="rounded-lg border border-white/10 bg-black/20 p-3">
          <button
            type="button"
            onClick={() => setShowAdvanced(v => !v)}
            className="w-full flex items-center justify-between text-xs text-slate-400"
          >
            <span>Advanced diagnostics</span>
            {showAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>

          {showAdvanced && (
            <div className="mt-3 space-y-3 border-t border-white/10 pt-3">
              <Input
                label="Start URL (optional override)"
                value={startUrl}
                onChange={e => setStartUrl(e.target.value)}
                className="h-9"
              />

              <div className="h-9 px-2 rounded-md border border-white/10 bg-black/30 inline-flex items-center">
                <Checkbox
                  checked={continueOnError}
                  onChange={e => setContinueOnError(e.target.checked)}
                  label="Continue on step error"
                  className="py-0 px-0 hover:bg-transparent"
                />
              </div>

              <div
                className={`rounded-lg border p-3 ${
                  runtimeInstalled === true
                    ? 'border-emerald-500/20 bg-emerald-500/5'
                    : runtimeInstalled === false
                      ? 'border-amber-500/20 bg-amber-500/5'
                      : 'border-white/10 bg-black/20'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="text-xs text-slate-400">Browser runtime</div>
                  <Button
                    size="xs"
                    variant="secondary"
                    onClick={() => void refreshRuntime()}
                    disabled={runtimeChecking}
                  >
                    {runtimeChecking ? t('common.loading') : t('common.refresh')}
                  </Button>
                </div>
                <div className="mt-2 text-sm text-slate-200">
                  {runtimeInstalled === true
                    ? 'Installed'
                    : runtimeInstalled === false
                      ? 'Not installed'
                      : 'Unknown'}
                </div>
                {runtimeCheckError && (
                  <div className="mt-1 text-xs text-red-300">{runtimeCheckError}</div>
                )}
              </div>

              <div className="rounded-lg border border-white/10 bg-black/20 p-3 text-xs text-slate-300">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <div className="text-slate-400">Status</div>
                    <div className="text-slate-200">{replay.state.status}</div>
                  </div>
                  <div>
                    <div className="text-slate-400">Progress</div>
                    <div className="text-slate-200">{progressLabel}</div>
                  </div>
                  <div>
                    <div className="text-slate-400">Manual pause</div>
                    <div className="text-slate-200 truncate">
                      {replay.state.manualPauseReason ?? '—'}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                <div className="text-xs text-slate-400">Runner config (JSON)</div>
                <div className="text-[11px] text-slate-500">
                  {loadingSettings ? 'Loading…' : 'From profile settings'}
                </div>
                <Textarea
                  containerClassName="mt-2"
                  className="h-24 min-h-[96px] rounded-md px-2 py-1 text-xs font-mono resize-none"
                  value={configJson}
                  onChange={e => setConfigJson(e.target.value)}
                  placeholder="{}"
                />
              </div>

              {replay.state.stderr.length > 0 && (
                <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3">
                  <div className="text-xs text-red-200 mb-2">Python stderr</div>
                  <div className="max-h-32 overflow-auto space-y-1">
                    {replay.state.stderr.slice(0, 30).map((e, idx) => (
                      <div key={`${e.ts}-${idx}`} className="text-[11px] font-mono text-red-200/90">
                        {e.line}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(lastFailedStep || replay.state.error) && (
                <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3">
                  <div className="text-xs text-red-200 mb-2">Failure details</div>
                  <div className="space-y-1 text-xs text-red-100">
                    {lastFailedStep ? (
                      <>
                        <div>
                          Step: {lastFailedStep.index}/{lastFailedStep.total} •{' '}
                          {lastFailedStep.kind}
                        </div>
                        {lastFailedStep.selector ? (
                          <div>Selector: {lastFailedStep.selector}</div>
                        ) : null}
                        {lastFailedStep.url ? <div>URL: {lastFailedStep.url}</div> : null}
                        {lastFailedStep.error ? <div>Error: {lastFailedStep.error}</div> : null}
                      </>
                    ) : null}
                    {replay.state.error ? <div>Runner error: {replay.state.error}</div> : null}
                    {replay.state.reportPath ? <div>Report: {replay.state.reportPath}</div> : null}
                  </div>
                </div>
              )}

              {hasDiagnosticsPaths && (
                <div className="flex flex-wrap gap-2">
                  {replay.state.reportPath && (
                    <>
                      <Button
                        size="xs"
                        variant="secondary"
                        onClick={async () => {
                          try {
                            await copyToClipboard({ text: replay.state.reportPath ?? '' });
                            toast.success('Report path copied');
                          } catch {
                            toast.error('Failed to copy report path');
                          }
                        }}
                      >
                        Copy report path
                      </Button>
                      <Button
                        size="xs"
                        variant="secondary"
                        onClick={async () => {
                          try {
                            await openInFileManager({ path: replay.state.reportPath ?? '' });
                          } catch (e) {
                            toast.error(
                              e instanceof Error ? e.message : 'Failed to open report folder'
                            );
                          }
                        }}
                      >
                        Open report folder
                      </Button>
                    </>
                  )}
                </div>
              )}

              <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs text-slate-400">Unified run timeline</div>
                  {timelineLoading ? (
                    <div className="text-[11px] text-slate-500">Refreshing…</div>
                  ) : null}
                </div>
                <div className="max-h-36 overflow-auto space-y-1">
                  {timelineEntries.length === 0 ? (
                    <div className="text-xs text-slate-500">No timeline entries yet</div>
                  ) : (
                    timelineEntries.slice(0, 80).map((entry, idx) => (
                      <div
                        key={`${entry.ts}-${idx}`}
                        className="text-[11px] font-mono text-slate-200"
                      >
                        <span className="text-slate-500 mr-2">
                          {new Date(entry.ts).toLocaleTimeString('en-US', {
                            hour12: false,
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                          })}
                        </span>
                        <span
                          className={`mr-2 ${
                            entry.level === 'error'
                              ? 'text-red-300'
                              : entry.level === 'warn'
                                ? 'text-amber-300'
                                : 'text-slate-300'
                          }`}
                        >
                          {entry.level.toUpperCase()}
                        </span>
                        <span>{entry.message}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <BrowserRuntimeInstallModal
          isOpen={runtimeModalOpen}
          onClose={() => setRuntimeModalOpen(false)}
        />
      </div>
    </Modal>
  );
}
