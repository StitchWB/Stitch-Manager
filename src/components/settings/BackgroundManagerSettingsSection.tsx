import { useState, useEffect, useCallback, useRef } from 'react';
import { RefreshCw, AlertCircle, CheckCircle, Activity, Clock, Hash, ShieldAlert } from 'lucide-react';
import { backgroundManager } from '@/lib/tauri';
import type { BackgroundManagerConfig, BackgroundManagerStatus } from '@/lib/tauri/modules/backgroundManager';

function formatDuration(iso: string | null): string {
  if (!iso) return 'never';
  const date = new Date(iso);
  const now = new Date();
  const diff = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  return `${Math.floor(diff / 3600)} h ago`;
}

function formatNextCheck(lastIso: string | null, intervalSeconds: number): string {
  if (!lastIso) return 'soon';
  const last = new Date(lastIso).getTime();
  const next = last + intervalSeconds * 1000;
  const now = Date.now();
  const diff = Math.floor((next - now) / 1000);
  if (diff <= 0) return 'soon';
  if (diff < 60) return `in ${diff}s`;
  if (diff < 3600) return `in ${Math.floor(diff / 60)}m`;
  return `in ${Math.floor(diff / 3600)}h`;
}

export function BackgroundManagerSettingsSection() {
  const [config, setConfig] = useState<BackgroundManagerConfig | null>(null);
  const [status, setStatus] = useState<BackgroundManagerStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    Promise.all([
      backgroundManager.getBackgroundManagerConfig(),
      backgroundManager.getBackgroundManagerStatus(),
    ])
      .then(([cfg, st]) => {
        setConfig(cfg);
        setStatus(st);
        setLoading(false);
      })
      .catch(err => {
        setError('Failed to load: ' + err);
        setLoading(false);
      });

    // Poll status every 5 seconds
    intervalRef.current = setInterval(() => {
      backgroundManager.getBackgroundManagerStatus()
        .then(st => setStatus(st))
        .catch(() => {});
    }, 5000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const handleToggleQuotaRefresh = useCallback(async () => {
    if (!config) return;
    const newConfig = { ...config, autoRefreshQuotaEnabled: !config.autoRefreshQuotaEnabled };
    setSaving(true);
    try {
      await backgroundManager.updateBackgroundManagerConfig(newConfig);
      setConfig(newConfig);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError('Failed to save: ' + err);
    } finally {
      setSaving(false);
    }
  }, [config]);

  const handleIntervalChange = useCallback(async (value: number) => {
    if (!config) return;
    const newConfig = { ...config, refreshQuotaIntervalSeconds: value };
    setSaving(true);
    try {
      await backgroundManager.updateBackgroundManagerConfig(newConfig);
      setConfig(newConfig);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError('Failed to save: ' + err);
    } finally {
      setSaving(false);
    }
  }, [config]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-slate-400">
        <RefreshCw size={16} className="animate-spin" />
        <span>Loading...</span>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="flex items-center gap-2 text-red-400">
        <AlertCircle size={16} />
        <span>{error || 'Failed to load config'}</span>
      </div>
    );
  }

  const intervals = [
    { value: 60, label: '1 minute' },
    { value: 300, label: '5 minutes' },
    { value: 600, label: '10 minutes' },
    { value: 1800, label: '30 minutes' },
    { value: 3600, label: '1 hour' },
  ];

  const isRunning = status?.isRefreshingQuota ?? false;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-slate-200">Auto Refresh Quota</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            Automatically refresh account quotas in the background
          </p>
        </div>
        <button
          onClick={handleToggleQuotaRefresh}
          disabled={saving}
          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
            config.autoRefreshQuotaEnabled
              ? 'bg-emerald-500'
              : 'bg-slate-600'
          }`}
        >
          <span
            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
              config.autoRefreshQuotaEnabled ? 'translate-x-4.5' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>

      {config.autoRefreshQuotaEnabled && (
        <div className="space-y-2">
          <label className="text-xs text-slate-400">Refresh interval</label>
          <div className="flex gap-2 flex-wrap">
            {intervals.map(interval => (
              <button
                key={interval.value}
                onClick={() => handleIntervalChange(interval.value)}
                disabled={saving}
                className={`px-3 py-1.5 rounded-md text-xs transition-colors ${
                  config.refreshQuotaIntervalSeconds === interval.value
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : 'bg-slate-700 text-slate-300 border border-slate-600 hover:bg-slate-600'
                }`}
              >
                {interval.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {status && config.autoRefreshQuotaEnabled && (
        <div className="rounded-lg border border-slate-700/50 bg-slate-800/30 p-3 space-y-2">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-300">
            <Activity size={12} className={isRunning ? 'text-emerald-400' : 'text-slate-500'} />
            <span>
              {isRunning ? 'Refreshing now...' : 'Idle'}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs text-slate-400">
            <div className="flex items-center gap-1.5">
              <Clock size={10} />
              <span>Last: {formatDuration(status.lastQuotaRefreshCheck)}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Clock size={10} />
              <span>Next: {formatNextCheck(status.lastQuotaRefreshCheck, config.refreshQuotaIntervalSeconds)}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Hash size={10} />
              <span>Tracked: {status.quotaTrackedAccounts}</span>
            </div>
            {status.quotaRefreshErrorCount > 0 && (
              <div className="flex items-center gap-1.5 text-amber-400">
                <ShieldAlert size={10} />
                <span>Errors: {status.quotaRefreshErrorCount}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {saved && (
        <div className="flex items-center gap-1.5 text-emerald-400 text-xs">
          <CheckCircle size={14} />
          <span>Saved</span>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-1.5 text-red-400 text-xs">
          <AlertCircle size={14} />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
