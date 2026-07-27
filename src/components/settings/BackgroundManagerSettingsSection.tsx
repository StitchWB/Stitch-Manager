import { t } from "@/lib/i18n";
import { useState, useEffect, useCallback, useRef } from 'react';
import { RefreshCw, AlertCircle, CheckCircle, Activity, Clock, Hash, ShieldAlert } from 'lucide-react';
import { Button, Toggle, SectionHeader } from '@/components/ui';
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
    backgroundManager.getBackgroundManagerStatus()]
    ).
    then(([cfg, st]) => {
      setConfig(cfg);
      setStatus(st);
      setLoading(false);
    }).
    catch((err) => {
      setError('Failed to load: ' + err);
      setLoading(false);
    });

    // Poll status every 5 seconds
    intervalRef.current = setInterval(() => {
      backgroundManager.getBackgroundManagerStatus().
      then((st) => setStatus(st)).
      catch(() => {});
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
        <span>{t("settings.background_manager_settings_section.loading")}</span>
      </div>);

  }

  if (!config) {
    return (
      <div className="flex items-center gap-2 text-red-400">
        <AlertCircle size={16} />
        <span>{error || t('settings.background_manager_settings_section.failed_to_load')}</span>
      </div>);

  }

  const intervals = [
  { value: 60, label: t('settings.background_manager_settings_section.interval_1m') },
  { value: 300, label: t('settings.background_manager_settings_section.interval_5m') },
  { value: 600, label: t('settings.background_manager_settings_section.interval_10m') },
  { value: 1800, label: t('settings.background_manager_settings_section.interval_30m') },
  { value: 3600, label: t('settings.background_manager_settings_section.interval_1h') }];


  const isRunning = status?.isRefreshingQuota ?? false;

  return (
    <SectionHeader
      title={t("settings.background_manager_settings_section.auto_refresh_quota")}
      description={t("settings.background_manager_settings_section.automatically_refresh_account_quotas_in_the_backgr")}
      icon={<Activity className="w-4 h-4 text-primary" />}
      className="pt-6 border-t border-white/10"
    >
    <div className="glass-card rounded-lg p-4 border border-white/10 space-y-4">
      <div className="flex items-center justify-between">
        <Toggle
          label={t("settings.background_manager_settings_section.auto_refresh_quota")}
          checked={config.autoRefreshQuotaEnabled}
          onChange={handleToggleQuotaRefresh}
          disabled={saving}
        />
      </div>

      {config.autoRefreshQuotaEnabled &&
      <div className="space-y-2">
          <label className="text-xs text-slate-400">{t("settings.background_manager_settings_section.refresh_interval")}</label>
          <div className="flex gap-2 flex-wrap">
            {intervals.map((interval) =>
          <Button
            key={interval.value}
            size="xs"
            variant={config.refreshQuotaIntervalSeconds === interval.value ? 'primary' : 'secondary'}
            onClick={() => handleIntervalChange(interval.value)}
            disabled={saving}
            className={`px-3 py-1.5 rounded-md text-xs transition-colors ${
            config.refreshQuotaIntervalSeconds === interval.value ?
            'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' :
            'bg-slate-700 text-slate-300 border border-slate-600 hover:bg-slate-600'}`
            }>

                {interval.label}
              </Button>
          )}
          </div>
        </div>
      }

      {status && config.autoRefreshQuotaEnabled &&
      <div className="rounded-lg border border-slate-700/50 bg-slate-800/30 p-3 space-y-2">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-300">
            <Activity size={12} className={isRunning ? 'text-emerald-400' : 'text-slate-500'} />
            <span>
              {isRunning ? t('settings.background_manager_settings_section.refreshing_now') : t('settings.background_manager_settings_section.idle')}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs text-slate-400">
            <div className="flex items-center gap-1.5">
              <Clock size={10} />
              <span>{t("settings.background_manager_settings_section.last")}{formatDuration(status.lastQuotaRefreshCheck)}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Clock size={10} />
              <span>{t("settings.background_manager_settings_section.next")}{formatNextCheck(status.lastQuotaRefreshCheck, config.refreshQuotaIntervalSeconds)}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Hash size={10} />
              <span>{t("settings.background_manager_settings_section.tracked")}{status.quotaTrackedAccounts}</span>
            </div>
            {status.quotaRefreshErrorCount > 0 &&
          <div className="flex items-center gap-1.5 text-amber-400">
                <ShieldAlert size={10} />
                <span>{t("settings.background_manager_settings_section.errors")}{status.quotaRefreshErrorCount}</span>
              </div>
          }
          </div>
        </div>
      }

      {saved &&
      <div className="flex items-center gap-1.5 text-emerald-400 text-xs">
          <CheckCircle size={14} />
          <span>{t("settings.background_manager_settings_section.saved")}</span>
        </div>
      }

      {error &&
      <div className="flex items-center gap-1.5 text-red-400 text-xs">
          <AlertCircle size={14} />
          <span>{error}</span>
        </div>
      }
    </div>
    </SectionHeader>);

}