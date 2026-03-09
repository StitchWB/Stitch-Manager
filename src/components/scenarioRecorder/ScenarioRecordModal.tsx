import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Modal, Button, Input, Textarea } from '@/components/ui';
import { t } from '@/lib/i18n';
import { getProfileSettings, saveProfileSettings } from '@/lib/tauri/modules/profiles';
import { useScenarioRecorder } from '@/lib/scenarioRecorder/useScenarioRecorder';
import { BrowserRuntimeInstallModal } from './BrowserRuntimeInstallModal';
import { checkBrowserRuntimeOnce } from '@/lib/scenarioRecorder/runtimeCheck';
import { buildRunnerConfigFromProfileSettings } from '@/lib/scenarioRecorder/configBuilder';
import { upsertRecordedScenario } from '@/lib/tauri/modules/pythonJobs';
import { toast } from 'sonner';
import { formatProfileAlias } from '@/lib/profiles/displayName';

type ScenarioRecordModalProps = {
  alias: string | null;
  isOpen: boolean;
  onClose: () => void;
  defaultUrl?: string;
  defaultScenarioName?: string;
  quickStart?: boolean;
};

export function ScenarioRecordModal({
  alias,
  isOpen,
  onClose,
  defaultUrl = 'https://google.com',
  defaultScenarioName,
  quickStart = false,
}: ScenarioRecordModalProps) {
  const recorder = useScenarioRecorder();
  const displayAlias = formatProfileAlias(alias);
  const persistedScenarioPathRef = useRef<string | null>(null);
  const lastSavedToastRef = useRef<string | null>(null);
  const [runtimeModalOpen, setRuntimeModalOpen] = useState(false);
  const [url, setUrl] = useState(defaultUrl);
  const [name, setName] = useState(defaultScenarioName?.trim() || 'scenario');
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [configJson, setConfigJson] = useState<string>('');
  const [runtimeInstalled, setRuntimeInstalled] = useState<boolean | null>(null);
  const [runtimeCheckError, setRuntimeCheckError] = useState<string | null>(null);
  const [runtimeChecking, setRuntimeChecking] = useState(false);
  const [autoStarted, setAutoStarted] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    if (!alias) return;

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
        setUrl(built.startUrl);
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
  }, [alias, defaultUrl, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const proposed = defaultScenarioName?.trim();
    if (!proposed) return;
    setName(proposed);
  }, [defaultScenarioName, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    setUrl(defaultUrl);
  }, [defaultUrl, isOpen]);

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

  useEffect(() => {
    if (!isOpen) {
      setAutoStarted(false);
      setShowAdvanced(false);
      persistedScenarioPathRef.current = null;
      lastSavedToastRef.current = null;
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const savedPath = recorder.state.scenarioPath?.trim();
    if (recorder.state.status !== 'done' || !savedPath || !alias) {
      return;
    }

    // Ensure persistence runs once per saved path.
    if (persistedScenarioPathRef.current === savedPath) {
      return;
    }
    persistedScenarioPathRef.current = savedPath;

    void (async () => {
      try {
        const existing = await getProfileSettings({ alias });
        const current = existing?.settings ?? {
          version: 1,
          network: {},
          geo: {},
          hardware: {},
          storage: {},
        };

        await saveProfileSettings({
          alias,
          settings: {
            ...current,
            storage: {
              ...(current.storage ?? {}),
              lastScenarioPath: savedPath,
            },
          },
        });

        await upsertRecordedScenario({
          alias,
          name: name.trim() || 'scenario',
          scenarioPath: savedPath,
          startedUrl: url,
          stepsCount: recorder.state.stepCount,
        });
      } catch {
        // best effort only
      }
    })();
  }, [
    alias,
    isOpen,
    name,
    recorder.state.scenarioPath,
    recorder.state.status,
    recorder.state.stepCount,
    url,
  ]);

  useEffect(() => {
    if (!isOpen) return;
    if (recorder.state.status === 'done' && recorder.state.scenarioPath) {
      const savedPath = recorder.state.scenarioPath.trim();
      if (!savedPath) return;
      if (lastSavedToastRef.current === savedPath) return;
      lastSavedToastRef.current = savedPath;
      toast.success(`Scenario saved: ${savedPath}`);
    }
  }, [isOpen, recorder.state.scenarioPath, recorder.state.status]);

  const canStart = useMemo(() => {
    return Boolean(alias) && url.trim().length > 0 && name.trim().length > 0;
  }, [alias, url, name]);

  const statusText = useMemo(() => {
    switch (recorder.state.status) {
      case 'starting':
        return 'Starting browser...';
      case 'recording':
        return `Recording • steps: ${recorder.state.stepCount}`;
      case 'stopping':
        return 'Stopping and saving...';
      case 'done':
        return 'Saved';
      case 'error':
        return 'Error';
      default:
        return 'Idle';
    }
  }, [recorder.state.status, recorder.state.stepCount]);

  const startRecording = useCallback(async () => {
    if (!alias) return;

    try {
      const existing = await getProfileSettings({ alias });
      const current = existing?.settings ?? {
        version: 1,
        network: {},
        geo: {},
        hardware: {},
        storage: {},
      };
      await saveProfileSettings({
        alias,
        settings: {
          ...current,
          storage: {
            ...(current.storage ?? {}),
            lastUrl: url,
          },
        },
      });
    } catch {
      // best-effort only
    }

    await recorder.start({
      alias,
      url,
      scenarioName: name,
      configJson,
    });
  }, [alias, configJson, name, recorder, url]);

  useEffect(() => {
    if (!quickStart || autoStarted) return;
    if (!isOpen) return;
    if (!canStart) return;
    if (loadingSettings) return;
    if (runtimeInstalled !== true) return;
    if (recorder.state.status !== 'idle') return;

    setAutoStarted(true);
    void startRecording();
  }, [
    quickStart,
    autoStarted,
    isOpen,
    canStart,
    loadingSettings,
    runtimeInstalled,
    recorder.state.status,
    startRecording,
  ]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('common.record') || 'Record scenario'}
      size="lg"
      footer={
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-slate-400 flex items-center">{statusText}</div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={onClose}>
                {t('common.close')}
              </Button>
              <Button variant="secondary" onClick={() => setRuntimeModalOpen(true)}>
                {t('common.installRuntime') || 'Install runtime'}
              </Button>
              <Button
                variant="danger"
                onClick={() => void recorder.stop()}
                disabled={!recorder.state.jobId || recorder.state.status === 'stopping'}
              >
                {t('common.stop')}
              </Button>
              <Button
                onClick={() => {
                  void startRecording();
                }}
                disabled={
                  !canStart ||
                  recorder.state.status === 'recording' ||
                  recorder.state.status === 'starting' ||
                  runtimeInstalled === false
                }
              >
                {t('common.start')}
              </Button>
            </div>
          </div>
          {runtimeInstalled === false ? (
            <div className="text-xs text-amber-300">
              Recorder runtime missing. Install it to start recording.
            </div>
          ) : null}
        </div>
      }
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          {t('recorder.proxySwitchRestartWarningRecord')}
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

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Input
            label="Scenario name"
            value={name}
            onChange={e => setName(e.target.value)}
            className="h-9"
          />
          <Input
            label="Start URL"
            value={url}
            onChange={e => setUrl(e.target.value)}
            className="h-9"
          />
        </div>

        {recorder.state.scenarioPath && (
          <div className="rounded-lg border border-white/10 bg-black/20 p-3 text-xs">
            <div className="text-slate-400">Scenario path</div>
            <div className="text-slate-200 font-mono break-all mt-1">
              {recorder.state.scenarioPath}
            </div>
          </div>
        )}

        {recorder.state.error && <div className="text-xs text-red-300">{recorder.state.error}</div>}

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
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <div className="text-slate-400">Job</div>
                  <div className="text-slate-200 font-mono break-all">
                    {recorder.state.jobId ?? '—'}
                  </div>
                </div>
                <div>
                  <div className="text-slate-400">Correlation</div>
                  <div className="text-slate-200 font-mono break-all">
                    {recorder.state.correlationId}
                  </div>
                </div>
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

              {recorder.state.stderr.length > 0 && (
                <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3">
                  <div className="text-xs text-red-200 mb-2">Python stderr</div>
                  <div className="max-h-32 overflow-auto space-y-1">
                    {recorder.state.stderr.slice(0, 30).map((e, idx) => (
                      <div key={`${e.ts}-${idx}`} className="text-[11px] font-mono text-red-200/90">
                        {e.line}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs text-slate-400">Runner config (JSON)</div>
                  <div className="text-[11px] text-slate-500">
                    {loadingSettings ? 'Loading…' : 'From profile settings'}
                  </div>
                </div>
                <Textarea
                  containerClassName="mt-2"
                  className="h-28 min-h-[112px] rounded-md px-2 py-1 text-xs font-mono resize-none"
                  value={configJson}
                  onChange={e => setConfigJson(e.target.value)}
                  placeholder="{}"
                />
              </div>
            </div>
          )}
        </div>
      </div>

      <BrowserRuntimeInstallModal
        isOpen={runtimeModalOpen}
        onClose={() => setRuntimeModalOpen(false)}
      />
    </Modal>
  );
}
