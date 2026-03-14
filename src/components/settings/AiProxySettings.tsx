import { useCallback, useEffect, useMemo, useState } from 'react';

import { useAiProxyStore } from '../../stores/aiProxy';
import { safeInvoke } from '../../lib/tauri/core/invoke';
import { getEnabledModels, setEnabledModels } from '../../lib/tauri/modules/aiProxy';
import type { ProxyStatus, ProxySettings } from '../../types/generated';
import { IdeConfigWizard } from '../ai-proxy/IdeConfigWizard';
import { Button, Input, LoadingSpinner, Select, Toggle } from '@/components/ui';

const OPENCODE_DEFAULT_MODEL_IDS = [
  'gpt-5',
  'gpt-5-codex',
  'gpt-5-codex-mini',
  'gpt-5.1',
  'gpt-5.1-codex',
  'gpt-5.1-codex-mini',
  'gpt-5.1-codex-max',
  'gpt-5.2',
  'gpt-5.2-codex',
  'gpt-5.3-codex',
  'gpt-5.3-codex-spark',
];

const opencodeModelLabel = (id: string) => {
  switch (id) {
    case 'gpt-5':
      return 'GPT-5';
    case 'gpt-5-codex':
      return 'GPT-5 Codex';
    case 'gpt-5-codex-mini':
      return 'GPT-5 Codex Mini';
    case 'gpt-5.1':
      return 'GPT-5.1';
    case 'gpt-5.1-codex':
      return 'GPT-5.1 Codex';
    case 'gpt-5.1-codex-mini':
      return 'GPT-5.1 Codex Mini';
    case 'gpt-5.1-codex-max':
      return 'GPT-5.1 Codex Max';
    case 'gpt-5.2':
      return 'GPT-5.2';
    case 'gpt-5.2-codex':
      return 'GPT-5.2 Codex';
    case 'gpt-5.3-codex':
      return 'GPT-5.3 Codex';
    case 'gpt-5.3-codex-spark':
      return 'GPT-5.3 Codex Spark';
    default:
      return id;
  }
};

const normalizeModelIds = (models: string[]) => models.map(model => model.trim()).filter(Boolean);

export function AiProxySettings() {
  const { status, settings, setStatus, setSettings, setLoading, setError } = useAiProxyStore();
  const [localSettings, setLocalSettings] = useState(settings);
  const [showIdeWizard, setShowIdeWizard] = useState(false);
  const [enabledModels, setEnabledModelsState] = useState<string[]>([]);
  const [modelToggles, setModelToggles] = useState<Record<string, boolean>>({});
  const [modelCatalog, setModelCatalog] = useState<string[]>(OPENCODE_DEFAULT_MODEL_IDS);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelsSaving, setModelsSaving] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [modelsSaveStatus, setModelsSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');

  useEffect(() => {
    if (modelsSaveStatus !== 'success') return;
    const timer = setTimeout(() => setModelsSaveStatus('idle'), 2400);
    return () => clearTimeout(timer);
  }, [modelsSaveStatus]);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [statusData, settingsData] = await Promise.all([
        safeInvoke<ProxyStatus>('get_proxy_status'),
        safeInvoke<ProxySettings>('get_proxy_settings'),
      ]);
      setStatus(statusData);
      setSettings(settingsData);
      setLocalSettings(settingsData);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to load AI Proxy data');
    } finally {
      setLoading(false);
    }
  }, [setError, setLoading, setSettings, setStatus]);

  const loadModels = useCallback(async () => {
    try {
      setModelsLoading(true);
      setModelsError(null);
      const data = await getEnabledModels();
      const normalized = normalizeModelIds(data);
      const seed = normalized.length > 0 ? normalized : OPENCODE_DEFAULT_MODEL_IDS;
      const catalog = Array.from(new Set([...OPENCODE_DEFAULT_MODEL_IDS, ...seed]));
      setEnabledModelsState(seed);
      setModelCatalog(catalog);
      setModelToggles(
        catalog.reduce<Record<string, boolean>>((acc, id) => {
          acc[id] = seed.includes(id);
          return acc;
        }, {})
      );
    } catch (error) {
      setModelsError(error instanceof Error ? error.message : 'Failed to load enabled models');
    } finally {
      setModelsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
    void loadModels();
  }, [loadData, loadModels]);

  const handleStart = async () => {
    try {
      setLoading(true);
      setError(null);
      const newStatus = await safeInvoke<ProxyStatus>('start_ai_proxy');
      setStatus(newStatus);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to start proxy');
    } finally {
      setLoading(false);
    }
  };

  const handleStop = async () => {
    try {
      setLoading(true);
      setError(null);
      const newStatus = await safeInvoke<ProxyStatus>('stop_ai_proxy');
      setStatus(newStatus);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to stop proxy');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSettings = async () => {
    if (!localSettings) return;

    try {
      setLoading(true);
      setError(null);
      await safeInvoke<void>('update_proxy_settings', { settings: localSettings });
      setSettings(localSettings);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to save settings');
    } finally {
      setLoading(false);
    }
  };

  const modelsDirty = useMemo(() => {
    const selected = Object.keys(modelToggles).filter(id => modelToggles[id]);
    const base = enabledModels;
    if (selected.length !== base.length) return true;
    const baseSet = new Set(base);
    return selected.some(id => !baseSet.has(id));
  }, [enabledModels, modelToggles]);

  const selectedModelIds = useMemo(
    () => Object.keys(modelToggles).filter(id => modelToggles[id]),
    [modelToggles]
  );

  const handleToggleModel = (id: string) => {
    setModelsSaveStatus('idle');
    setModelToggles(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleSelectAllModels = () => {
    setModelsSaveStatus('idle');
    setModelToggles(
      modelCatalog.reduce<Record<string, boolean>>((acc, id) => {
        acc[id] = true;
        return acc;
      }, {})
    );
  };

  const handleClearModels = () => {
    setModelsSaveStatus('idle');
    setModelToggles(
      modelCatalog.reduce<Record<string, boolean>>((acc, id) => {
        acc[id] = false;
        return acc;
      }, {})
    );
  };

  const handleSaveModels = async () => {
    if (modelsSaving) return;
    const selected = selectedModelIds;
    if (selected.length === 0) {
      setModelsSaveStatus('error');
      setModelsError('Select at least one model to keep OpenCode available.');
      return;
    }

    try {
      setModelsSaving(true);
      setModelsError(null);
      const saved = await setEnabledModels(selected);
      const normalized = normalizeModelIds(saved);
      setEnabledModelsState(normalized);
      const catalog = Array.from(new Set([...OPENCODE_DEFAULT_MODEL_IDS, ...normalized]));
      setModelCatalog(catalog);
      setModelToggles(
        catalog.reduce<Record<string, boolean>>((acc, id) => {
          acc[id] = normalized.includes(id);
          return acc;
        }, {})
      );
      setModelsSaveStatus('success');
    } catch (error) {
      setModelsSaveStatus('error');
      setModelsError(error instanceof Error ? error.message : 'Failed to save enabled models');
    } finally {
      setModelsSaving(false);
    }
  };

  if (!localSettings) {
    return <div className="text-vsc-text-muted">Loading...</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-vsc-text mb-4">AI Proxy</h3>
        <p className="text-sm text-vsc-text-muted mb-6">
          Configure AI Proxy to distribute models to IDE/CLI clients. Providers and API keys live in
          their respective settings pages.
        </p>
      </div>

      {/* Status */}
      <div className="flex items-center justify-between p-4 bg-vsc-sidebar rounded-lg border border-vsc-border">
        <div>
          <div className="text-sm font-medium text-vsc-text">AI Proxy Status</div>
          <div className="text-xs text-vsc-text-muted mt-1">
            {status?.running ? (
              <span className="text-vsc-green">
                Running on port {status.port}
                {status.uptimeSeconds && ` (${Math.floor(status.uptimeSeconds / 60)}m uptime)`}
              </span>
            ) : (
              <span className="text-vsc-text-muted">Stopped</span>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          {status?.running ? (
            <Button variant="danger" onClick={handleStop}>
              Stop
            </Button>
          ) : (
            <Button variant="primary" onClick={handleStart}>
              Start
            </Button>
          )}
        </div>
      </div>

      {/* Mode Selection */}
      <div className="space-y-3">
        <label htmlFor="ai-proxy-mode" className="block text-sm font-medium text-vsc-text">
          Mode
        </label>
        <Select
          id="ai-proxy-mode"
          value={localSettings.appMode}
          onChange={async e => {
            const newMode = e.target.value;
            setLocalSettings({ ...localSettings, appMode: newMode });

            // If switching to quota-only mode and proxy is running, stop it
            if (newMode === 'quota-only' && status?.running) {
              try {
                const newStatus = await safeInvoke<ProxyStatus>('stop_ai_proxy');
                setStatus(newStatus);
              } catch (error) {
                console.error('Failed to stop proxy:', error);
              }
            }
          }}
        >
          <option value="full">Full Mode (AI Proxy + Quota)</option>
          <option value="quota-only">Quota-Only Mode</option>
        </Select>
        <p className="text-xs text-vsc-text-muted">
          {localSettings.appMode === 'full'
            ? 'Run AI Proxy to distribute models to IDE/CLI clients and track quota usage'
            : 'Track quota without exposing the AI Proxy endpoint to IDE/CLI clients'}
        </p>
        {localSettings.appMode === 'quota-only' && status?.running && (
          <p className="text-xs text-vsc-yellow">⚠️ AI Proxy will be stopped in Quota-Only mode</p>
        )}
      </div>

      {/* Port */}
      <div className="space-y-3">
        <label htmlFor="ai-proxy-port" className="block text-sm font-medium text-vsc-text">
          AI Proxy Port
        </label>
        <Input
          id="ai-proxy-port"
          type="number"
          value={localSettings.proxyPort.toString()}
          onChange={e =>
            setLocalSettings({ ...localSettings, proxyPort: parseInt(e.target.value) })
          }
          min={1024}
          max={65535}
          className="bg-vsc-input text-vsc-text border-vsc-border"
          shellClassName="bg-vsc-input border-vsc-border"
        />
        <p className="text-xs text-vsc-text-muted">
          IDE/CLI clients connect to this port through the AI Proxy endpoint.
        </p>
      </div>

      {/* Auto Start */}
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium text-vsc-text">Auto Start</div>
          <div className="text-xs text-vsc-text-muted mt-1">
            Start AI Proxy automatically to keep IDE/CLI clients connected
          </div>
        </div>
        <Toggle
          label=""
          checked={localSettings.autoStart}
          onChange={checked => setLocalSettings({ ...localSettings, autoStart: checked })}
        />
      </div>

      {/* Routing Strategy */}
      <div className="space-y-3">
        <label htmlFor="ai-proxy-routing" className="block text-sm font-medium text-vsc-text">
          Routing Strategy
        </label>
        <Select
          id="ai-proxy-routing"
          value={localSettings.routingStrategy}
          onChange={e => setLocalSettings({ ...localSettings, routingStrategy: e.target.value })}
        >
          <option value="round-robin">Round Robin</option>
          <option value="fill-first">Fill First</option>
        </Select>
      </div>

      {/* OpenCode Models */}
      <div className="space-y-3 rounded-lg border border-vsc-border bg-vsc-sidebar/60 p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-medium text-vsc-text">OpenCode Model Access</div>
            <div className="text-xs text-vsc-text-muted mt-1">
              Toggle which model IDs are exposed in the OpenCode provider config.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClearModels}
              disabled={modelsLoading || modelsSaving}
            >
              Clear
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleSelectAllModels}
              disabled={modelsLoading || modelsSaving}
            >
              Select all
            </Button>
          </div>
        </div>

        {modelsLoading ? (
          <div className="flex items-center gap-2 text-xs text-vsc-text-muted">
            <LoadingSpinner size="sm" color="muted" />
            Loading model toggles...
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {modelCatalog.map(id => (
              <div
                key={id}
                className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-white/10 bg-black/20"
              >
                <div>
                  <div className="text-xs font-semibold text-vsc-text">
                    {opencodeModelLabel(id)}
                  </div>
                  <div className="text-[11px] text-vsc-text-muted font-mono">{id}</div>
                </div>
                <Toggle
                  label=""
                  checked={Boolean(modelToggles[id])}
                  onChange={() => handleToggleModel(id)}
                />
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <div className="text-xs text-vsc-text-muted">
            {selectedModelIds.length} enabled • Changes apply to OpenCode config previews
          </div>
          <div className="flex items-center gap-2">
            {modelsSaveStatus === 'success' && !modelsSaving && (
              <span className="text-xs text-emerald-400">Saved</span>
            )}
            {modelsError && <span className="text-xs text-red-400">{modelsError}</span>}
            <Button
              variant="primary"
              size="sm"
              onClick={handleSaveModels}
              disabled={modelsLoading || modelsSaving || !modelsDirty}
            >
              {modelsSaving ? 'Saving...' : 'Save models'}
            </Button>
          </div>
        </div>
      </div>

      {/* Save Button */}
      <div className="flex justify-end gap-2 pt-4 border-t border-vsc-border">
        <Button variant="ghost" onClick={() => setShowIdeWizard(true)}>
          Configure IDE/CLI
        </Button>
        <Button variant="primary" onClick={handleSaveSettings}>
          Save Settings
        </Button>
      </div>

      {/* IDE Configuration Wizard */}
      <IdeConfigWizard isOpen={showIdeWizard} onClose={() => setShowIdeWizard(false)} />
    </div>
  );
}
