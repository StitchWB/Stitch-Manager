import { useEffect, useState } from 'react';
import { Button, Select, Toggle } from '../ui';
import { useAiProxyStore } from '../../stores/aiProxy';
import { safeInvoke } from '../../lib/tauri/core/invoke';
import type { ProxyStatus, ProxySettings } from '../../types/generated';
import { IdeConfigWizard } from '../ai-proxy/IdeConfigWizard';

export function AiProxySettings() {
  const { status, settings, setStatus, setSettings, setLoading, setError } = useAiProxyStore();
  const [localSettings, setLocalSettings] = useState(settings);
  const [showIdeWizard, setShowIdeWizard] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
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
  };

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
        <label className="block text-sm font-medium text-vsc-text">Mode</label>
        <Select
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
        <label className="block text-sm font-medium text-vsc-text">AI Proxy Port</label>
        <input
          type="number"
          value={localSettings.proxyPort}
          onChange={e =>
            setLocalSettings({ ...localSettings, proxyPort: parseInt(e.target.value) })
          }
          className="w-full px-3 py-2 bg-vsc-input text-vsc-text border border-vsc-border rounded-lg"
          min="1024"
          max="65535"
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
        <label className="block text-sm font-medium text-vsc-text">Routing Strategy</label>
        <Select
          value={localSettings.routingStrategy}
          onChange={e => setLocalSettings({ ...localSettings, routingStrategy: e.target.value })}
        >
          <option value="round-robin">Round Robin</option>
          <option value="fill-first">Fill First</option>
        </Select>
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
