import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Button, Input, Textarea } from '@/components/ui';
import { t } from '@/lib/i18n';
import { getProfileSettings, saveProfileSettings } from '@/lib/tauri/modules/profiles';
import { useScenarioRecorder } from '@/lib/scenarioRecorder/useScenarioRecorder';
import { BrowserRuntimeInstallModal } from './BrowserRuntimeInstallModal';
import { checkBrowserRuntimeOnce } from '@/lib/scenarioRecorder/runtimeCheck';
import { toast } from 'sonner';

type ScenarioRecordModalProps = {
  alias: string | null;
  isOpen: boolean;
  onClose: () => void;
  defaultUrl?: string;
  quickStart?: boolean;
};

export function ScenarioRecordModal({
  alias,
  isOpen,
  onClose,
  defaultUrl = 'https://google.com',
  quickStart = true,
}: ScenarioRecordModalProps) {
  const recorder = useScenarioRecorder();
  const [runtimeModalOpen, setRuntimeModalOpen] = useState(false);
  const [url, setUrl] = useState(defaultUrl);
  const [name, setName] = useState('scenario');
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
        // Only pass safe runtime settings into runner.
        // Our ProfileLauncher understands locale/timezone/geolocation/headers/cookies.
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
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    if (recorder.state.status === 'done' && recorder.state.scenarioPath) {
      toast.success(`Scenario saved: ${recorder.state.scenarioPath}`);
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

    // Persist last URL for this browser profile.
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
    if (runtimeInstalled !== true) return;
    if (recorder.state.status !== 'idle') return;

    setAutoStarted(true);
    void startRecording();
  }, [
    quickStart,
    autoStarted,
    isOpen,
    canStart,
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
        <div className="flex justify-end gap-2">
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
      }
    >
      <div className="space-y-3">
        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3 text-xs text-slate-300">
          <div className="font-semibold text-slate-100">How to record</div>
          <ol className="mt-2 list-decimal list-inside space-y-1 text-slate-300">
            <li>Recorder opens on the last URL of this browser profile.</li>
            <li>Do actions in browser.</li>
            <li>Press Stop (overlay or this modal) to save scenario.json.</li>
          </ol>
        </div>
        <div className="space-y-1">
          <div className="text-xs text-slate-400">Profile</div>
          <div className="text-sm text-slate-200 truncate">{alias ?? '—'}</div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <div className="text-xs text-slate-400">Scenario name</div>
            <Input value={name} onChange={e => setName(e.target.value)} className="h-9" />
          </div>
          <div className="space-y-1">
            <div className="text-xs text-slate-400">Start URL</div>
            <Input value={url} onChange={e => setUrl(e.target.value)} className="h-9" />
            <div className="text-[11px] text-slate-500">Use login page for cleaner scenarios.</div>
          </div>
        </div>

        <div className="rounded-lg border border-white/10 bg-black/20 p-3 text-sm text-slate-200">
          <div className="flex items-center justify-between gap-3">
            <div className="font-medium">{statusText}</div>
            <Button size="xs" variant="ghost" onClick={() => setShowAdvanced(v => !v)}>
              {showAdvanced ? 'Hide details' : 'Show details'}
            </Button>
          </div>
          {recorder.state.scenarioPath && (
            <div className="mt-2 text-xs">
              <div className="text-slate-400">Scenario path</div>
              <div className="text-slate-200 font-mono break-all">
                {recorder.state.scenarioPath}
              </div>
              <div className="mt-2">
                <Button
                  size="xs"
                  variant="secondary"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(recorder.state.scenarioPath ?? '');
                      toast.success('Scenario path copied');
                    } catch {
                      toast.error('Failed to copy path');
                    }
                  }}
                >
                  Copy path
                </Button>
              </div>
            </div>
          )}
          {recorder.state.error && (
            <div className="mt-2 text-xs text-red-300">{recorder.state.error}</div>
          )}

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
