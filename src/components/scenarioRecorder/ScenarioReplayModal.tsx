import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Button, Input } from '@/components/ui';
import { t } from '@/lib/i18n';
import { getProfileSettings } from '@/lib/tauri/modules/profiles';
import { useScenarioReplay } from '@/lib/scenarioRecorder/useScenarioReplay';

type ScenarioReplayModalProps = {
  alias: string | null;
  isOpen: boolean;
  onClose: () => void;
  defaultUrl?: string;
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
}: ScenarioReplayModalProps) {
  const replay = useScenarioReplay();
  const [scenarioPath, setScenarioPath] = useState('');
  const [startUrl, setStartUrl] = useState(defaultUrl);
  const [configJson, setConfigJson] = useState<string>('');
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [continueOnError, setContinueOnError] = useState(false);
  const announcedPauseRef = useRef(false);

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

  const canStart = useMemo(() => {
    return Boolean(alias) && scenarioPath.trim().length > 0;
  }, [alias, scenarioPath]);

  const progressLabel = useMemo(() => {
    if (!replay.state.totalSteps) return '—';
    return `${replay.state.currentStep}/${replay.state.totalSteps}`;
  }, [replay.state.currentStep, replay.state.totalSteps]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('common.replay') || 'Replay scenario'}
      size="lg"
    >
      <div className="space-y-3">
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
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <div className="text-xs text-slate-400">Start URL (optional override)</div>
            <Input value={startUrl} onChange={e => setStartUrl(e.target.value)} className="h-9" />
          </div>
          <div className="space-y-1">
            <div className="text-xs text-slate-400">Options</div>
            <label className="h-9 px-2 rounded-md border border-white/10 bg-black/30 text-xs text-slate-200 inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={continueOnError}
                onChange={e => setContinueOnError(e.target.checked)}
              />
              Continue on step error
            </label>
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
        </div>

        <div className="rounded-lg border border-white/10 bg-black/20 p-3">
          <div className="flex items-center justify-between">
            <div className="text-xs text-slate-400">Runner config (JSON)</div>
            <div className="text-[11px] text-slate-500">
              {loadingSettings ? 'Loading…' : 'From profile settings'}
            </div>
          </div>
          <textarea
            className="mt-2 w-full h-24 rounded-md bg-black/30 border border-white/10 px-2 py-1 text-xs font-mono text-slate-200"
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
            <Button
              variant="danger"
              onClick={() => void replay.stop()}
              disabled={!replay.state.jobId || replay.state.status === 'stopping'}
            >
              {t('common.stop')}
            </Button>
            <Button
              onClick={() => {
                if (!alias) return;
                void replay.start({
                  alias,
                  scenarioPath,
                  startUrl,
                  configJson,
                  continueOnError,
                });
              }}
              disabled={
                !canStart || replay.state.status === 'starting' || replay.state.status === 'running'
              }
            >
              {t('common.start')}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
