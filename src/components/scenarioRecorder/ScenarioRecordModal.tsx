import { useEffect, useMemo, useState } from 'react';
import { Modal, Button, Input } from '@/components/ui';
import { t } from '@/lib/i18n';
import { getProfileSettings } from '@/lib/tauri/modules/profiles';
import { useScenarioRecorder } from '@/lib/scenarioRecorder/useScenarioRecorder';

type ScenarioRecordModalProps = {
  alias: string | null;
  isOpen: boolean;
  onClose: () => void;
  defaultUrl?: string;
};

export function ScenarioRecordModal({
  alias,
  isOpen,
  onClose,
  defaultUrl = 'https://google.com',
}: ScenarioRecordModalProps) {
  const recorder = useScenarioRecorder();
  const [url, setUrl] = useState(defaultUrl);
  const [name, setName] = useState('scenario');
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [configJson, setConfigJson] = useState<string>('');

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

  const canStart = useMemo(() => {
    return Boolean(alias) && url.trim().length > 0 && name.trim().length > 0;
  }, [alias, url, name]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('common.record') || 'Record scenario'}
      size="lg"
    >
      <div className="space-y-3">
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
          </div>
        </div>

        <div className="rounded-lg border border-white/10 bg-black/20 p-3">
          <div className="flex items-center justify-between">
            <div className="text-xs text-slate-400">Status</div>
            <div className="text-xs text-slate-200">{recorder.state.status}</div>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-3 text-xs">
            <div>
              <div className="text-slate-400">Steps</div>
              <div className="text-slate-200 font-semibold tabular-nums">
                {recorder.state.stepCount}
              </div>
            </div>
            <div>
              <div className="text-slate-400">Last event</div>
              <div className="text-slate-200 truncate">{recorder.state.lastEvent ?? '—'}</div>
            </div>
          </div>
          {recorder.state.scenarioPath && (
            <div className="mt-2 text-xs">
              <div className="text-slate-400">Saved to</div>
              <div className="text-slate-200 font-mono break-all">
                {recorder.state.scenarioPath}
              </div>
            </div>
          )}
          {recorder.state.error && (
            <div className="mt-2 text-xs text-red-300">{recorder.state.error}</div>
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
            className="mt-2 w-full h-28 rounded-md bg-black/30 border border-white/10 px-2 py-1 text-xs font-mono text-slate-200"
            value={configJson}
            onChange={e => setConfigJson(e.target.value)}
            placeholder="{}"
          />
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            {t('common.close')}
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
              if (!alias) return;
              void recorder.start({
                alias,
                url,
                scenarioName: name,
                // proxy is inside configJson
                configJson,
              });
            }}
            disabled={
              !canStart ||
              recorder.state.status === 'recording' ||
              recorder.state.status === 'starting'
            }
          >
            {t('common.start')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
