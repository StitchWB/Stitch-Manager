import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Button, Checkbox, Input, Textarea } from '@/components/ui';
import { t } from '@/lib/i18n';
import { getProfileSettings } from '@/lib/tauri/modules/profiles';
import { useScenarioReplay } from '@/lib/scenarioRecorder/useScenarioReplay';
import { BrowserRuntimeInstallModal } from './BrowserRuntimeInstallModal';
import { checkBrowserRuntimeOnce } from '@/lib/scenarioRecorder/runtimeCheck';
import { getObsTimeline } from '@/lib/tauri/modules/observability';
import { replayPreflight, type ReplayPreflightResult } from '@/lib/tauri/modules/pythonJobs';
import { copyToClipboard, openInFileManager } from '@/lib/tauri/modules/utils';
import { toast } from 'sonner';

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
  const [runtimeModalOpen, setRuntimeModalOpen] = useState(false);
  const [scenarioPath, setScenarioPath] = useState('');
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
  const announcedPauseRef = useRef(false);

  useEffect(() => {
    if (!isOpen) {
      setAutoStarted(false);
      setTimelineEntries([]);
      setPreflight(null);
      return;
    }
    setStartUrl(defaultUrl);
    setScenarioPath(defaultScenarioPath?.trim() ?? '');
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
        setConfigJson(JSON.stringify(cfg, null, 2));
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
  }, [alias, isOpen]);

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

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('common.replay') || 'Replay scenario'}
      size="lg"
      footer={
        <div className="flex justify-between gap-2">
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

          <div className="flex gap-2">
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
      }
    >
      <div className="space-y-3">
        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3 text-xs text-slate-300">
          <div className="font-semibold text-slate-100">How to replay</div>
          <ol className="mt-2 list-decimal list-inside space-y-1 text-slate-300">
            <li>Install runtime if needed.</li>
            <li>Paste scenario.json path.</li>
            <li>Press Start → runner executes steps.</li>
            <li>If CAPTCHA appears → manual pause + beep → solve → press Resume.</li>
          </ol>
        </div>
        <div className="space-y-1">
          <div className="text-xs text-slate-400">Profile</div>
          <div className="text-sm text-slate-200 truncate">{alias ?? '—'}</div>
        </div>

        <div className="space-y-1">
          <div className="text-xs text-slate-400">Scenario path</div>
          <Input
            value={scenarioPath}
            onChange={e => setScenarioPath(e.target.value)}
            placeholder="C:\\Users\\...\\scenario.json"
            className="h-9"
          />
          {!scenarioPath.trim() ? (
            <div className="text-[11px] text-amber-300">{t('recorder.noSavedScenarioPath')}</div>
          ) : null}
        </div>

        <div className="rounded-lg border border-white/10 bg-black/20 p-3">
          <div className="text-xs text-slate-400 mb-1">Preflight & health</div>
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
              {preflight.issues.length > 0 && (
                <div className="text-amber-300">
                  Issues:{' '}
                  {preflight.issues
                    .slice(0, 5)
                    .map(i => `#${i.index} ${i.reason}`)
                    .join(' • ')}
                </div>
              )}
              {preflight.healthNotes.length > 0 && (
                <div className="text-slate-400">Notes: {preflight.healthNotes.join(' • ')}</div>
              )}
            </div>
          ) : (
            <div className="text-xs text-slate-500">No scenario loaded</div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <div className="text-xs text-slate-400">Start URL (optional override)</div>
            <Input value={startUrl} onChange={e => setStartUrl(e.target.value)} className="h-9" />
          </div>
          <div className="space-y-1">
            <div className="text-xs text-slate-400">Options</div>
            <div className="h-9 px-2 rounded-md border border-white/10 bg-black/30 inline-flex items-center">
              <Checkbox
                checked={continueOnError}
                onChange={e => setContinueOnError(e.target.checked)}
                label="Continue on step error"
                className="py-0 px-0 hover:bg-transparent"
              />
            </div>
          </div>
        </div>

        <div
          className={`rounded-lg border p-3 ${
            replay.state.status === 'manual_pause'
              ? 'border-amber-400/40 bg-amber-500/10'
              : 'border-white/10 bg-black/20'
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="text-xs text-slate-400">Status</div>
            <div className="text-xs text-slate-200">{replay.state.status}</div>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-3 text-xs">
            <div>
              <div className="text-slate-400">Job</div>
              <div className="text-slate-200 font-mono break-all">{replay.state.jobId ?? '—'}</div>
            </div>
            <div>
              <div className="text-slate-400">Correlation</div>
              <div className="text-slate-200 font-mono break-all">{replay.state.correlationId}</div>
            </div>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-3 text-xs">
            <div>
              <div className="text-slate-400">Progress</div>
              <div className="text-slate-200 font-semibold tabular-nums">{progressLabel}</div>
            </div>
            <div>
              <div className="text-slate-400">Last event</div>
              <div className="text-slate-200 truncate">{replay.state.lastEvent ?? '—'}</div>
            </div>
            <div>
              <div className="text-slate-400">Manual pause</div>
              <div className="text-slate-200 truncate">{replay.state.manualPauseReason ?? '—'}</div>
            </div>
          </div>
          {replay.state.commandFilePath && (
            <div className="mt-2 text-xs">
              <div className="text-slate-400">Command file</div>
              <div className="text-slate-200 font-mono break-all">
                {replay.state.commandFilePath}
              </div>
            </div>
          )}
          {replay.state.reportPath && (
            <div className="mt-2 text-xs">
              <div className="text-slate-400">Report</div>
              <div className="text-slate-200 font-mono break-all">{replay.state.reportPath}</div>
            </div>
          )}
          {replay.state.error && (
            <div className="mt-2 text-xs text-red-300">{replay.state.error}</div>
          )}

          {hasDiagnosticsPaths && (
            <div className="mt-3 flex flex-wrap gap-2 border-t border-white/10 pt-3">
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

              {replay.state.artifactsDir && (
                <Button
                  size="xs"
                  variant="secondary"
                  onClick={async () => {
                    try {
                      await openInFileManager({ path: replay.state.artifactsDir ?? '' });
                    } catch (e) {
                      toast.error(
                        e instanceof Error ? e.message : 'Failed to open artifacts folder'
                      );
                    }
                  }}
                >
                  Open artifacts
                </Button>
              )}

              {replay.state.tracePath && (
                <Button
                  size="xs"
                  variant="secondary"
                  onClick={async () => {
                    try {
                      await openInFileManager({ path: replay.state.tracePath ?? '' });
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : 'Failed to open trace folder');
                    }
                  }}
                >
                  Open trace
                </Button>
              )}
            </div>
          )}
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
                    Step: {lastFailedStep.index}/{lastFailedStep.total} • {lastFailedStep.kind}
                  </div>
                  {lastFailedStep.selector ? <div>Selector: {lastFailedStep.selector}</div> : null}
                  {lastFailedStep.url ? <div>URL: {lastFailedStep.url}</div> : null}
                  {lastFailedStep.error ? <div>Error: {lastFailedStep.error}</div> : null}
                </>
              ) : null}
              {replay.state.error ? <div>Runner error: {replay.state.error}</div> : null}
              {replay.state.reportPath ? <div>Report: {replay.state.reportPath}</div> : null}
            </div>
          </div>
        )}

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
          {runtimeInstalled === false && (
            <div className="mt-1 text-xs text-amber-200">
              Install runtime first, then press Start.
            </div>
          )}
        </div>

        <div className="rounded-lg border border-white/10 bg-black/20 p-3">
          <div className="flex items-center justify-between">
            <div className="text-xs text-slate-400">Runner config (JSON)</div>
            <div className="text-[11px] text-slate-500">
              {loadingSettings ? 'Loading…' : 'From profile settings'}
            </div>
          </div>
          <Textarea
            containerClassName="mt-2"
            className="h-24 min-h-[96px] rounded-md px-2 py-1 text-xs font-mono resize-none"
            value={configJson}
            onChange={e => setConfigJson(e.target.value)}
            placeholder="{}"
          />
        </div>

        <div className="rounded-lg border border-white/10 bg-black/20 p-3">
          <div className="text-xs text-slate-400 mb-2">Recent steps</div>
          <div className="max-h-44 overflow-auto space-y-1">
            {replay.state.stepEvents.length === 0 ? (
              <div className="text-xs text-slate-500">No steps yet</div>
            ) : (
              replay.state.stepEvents.slice(0, 20).map((entry, idx) => (
                <div key={`${entry.ts}-${entry.index}-${idx}`} className="text-xs text-slate-200">
                  <span className="text-slate-400 mr-2 tabular-nums">
                    {entry.index}/{entry.total}
                  </span>
                  <span
                    className={`mr-2 ${
                      entry.status === 'done'
                        ? 'text-emerald-300'
                        : entry.status === 'fail'
                          ? 'text-red-300'
                          : 'text-sky-300'
                    }`}
                  >
                    {entry.status}
                  </span>
                  <span className="mr-2">{entry.kind}</span>
                  <span className="text-slate-400 truncate">
                    {entry.selector || entry.url || ''}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="rounded-lg border border-white/10 bg-black/20 p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs text-slate-400">Unified run timeline</div>
            {timelineLoading ? <div className="text-[11px] text-slate-500">Refreshing…</div> : null}
          </div>
          <div className="max-h-40 overflow-auto space-y-1">
            {timelineEntries.length === 0 ? (
              <div className="text-xs text-slate-500">No timeline entries yet</div>
            ) : (
              timelineEntries.slice(0, 80).map((entry, idx) => (
                <div key={`${entry.ts}-${idx}`} className="text-[11px] font-mono text-slate-200">
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

        <BrowserRuntimeInstallModal
          isOpen={runtimeModalOpen}
          onClose={() => setRuntimeModalOpen(false)}
        />
      </div>
    </Modal>
  );
}
