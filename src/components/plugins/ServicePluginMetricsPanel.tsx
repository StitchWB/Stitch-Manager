/**
 * ServicePluginMetricsPanel — on-demand call-metrics detail for a global
 * service plugin.
 *
 * Fetches the namespaced route ``plugin.{id}.metrics`` (host-served, no
 * RPC roundtrip — see bridge.py short-circuit) on mount and renders the
 * full metrics snapshot: avg latency, last error, and a per-command
 * breakdown table. A manual Refresh button re-fetches while mounted. No
 * polling. Fetch failures surface as inline error text — never crash.
 *
 * Mirrors the Deep Space panel + refresh pattern used by the sandbox
 * logs/playground panels (SandboxPluginCard.tsx).
 */
import { useCallback, useEffect, useState } from 'react';
import { Activity, Loader2, RefreshCw, AlertCircle } from 'lucide-react';
import { t } from '@/lib/i18n';
import { Button } from '../ui/Button';
import {
  fetchServicePluginMetrics,
  type ServicePluginMetrics,
} from '@/lib/backend/modules/servicePlugins';

export interface ServicePluginMetricsPanelProps {
  pluginId: string;
}

export function ServicePluginMetricsPanel({ pluginId }: ServicePluginMetricsPanelProps) {
  const [metrics, setMetrics] = useState<ServicePluginMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMetrics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchServicePluginMetrics(pluginId);
      setMetrics(result);
    } catch {
      setError(t('admin.plugins.servicePlugin.metrics.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [pluginId]);

  useEffect(() => {
    void fetchMetrics();
  }, [fetchMetrics]);

  const byCommand = metrics
    ? Object.entries(metrics.by_command).sort(([a], [b]) => a.localeCompare(b))
    : [];

  return (
    <div className="mt-1 rounded-lg border border-white/[0.06] bg-black/60 p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="w-3 h-3 text-indigo-400" />
          <span className="text-[11px] font-medium text-slate-400">
            {t('admin.plugins.servicePlugin.metrics.title')}
          </span>
        </div>
        <Button
          variant="ghost"
          size="xs"
          onClick={() => void fetchMetrics()}
          disabled={loading}
          leftIcon={<RefreshCw size={12} className={loading ? 'animate-spin' : ''} />}
        >
          {t('admin.plugins.servicePlugin.metrics.refresh')}
        </Button>
      </div>

      {loading && metrics === null ? (
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Loader2 className="w-3 h-3 animate-spin" />
          {t('common.loading')}
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 text-xs text-red-400">
          <AlertCircle className="w-3 h-3 shrink-0" />
          <span>{error}</span>
        </div>
      ) : metrics ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-4 text-xs text-slate-500 flex-wrap">
            <span>
              {t('admin.plugins.servicePlugin.metrics.avgLatency')}:{' '}
              {metrics.avg_latency_ms.toFixed(1)} {t('admin.plugins.servicePlugin.metrics.ms')}
            </span>
            {metrics.last_error && (
              <span className="text-red-400 truncate" title={metrics.last_error}>
                {t('admin.plugins.servicePlugin.metrics.lastError')}: {metrics.last_error}
              </span>
            )}
          </div>

          <div>
            <div className="text-[11px] font-medium text-slate-500 mb-1">
              {t('admin.plugins.servicePlugin.metrics.byCommand')}
            </div>
            {byCommand.length === 0 ? (
              <p className="text-xs text-slate-600">
                {t('admin.plugins.servicePlugin.metrics.noCommands')}
              </p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/[0.06] text-left text-slate-500">
                    <th className="py-1.5 pr-3 font-medium">
                      {t('admin.plugins.servicePlugin.metrics.command')}
                    </th>
                    <th className="py-1.5 px-3 font-medium text-right">
                      {t('admin.plugins.servicePlugin.metrics.calls')}
                    </th>
                    <th className="py-1.5 pl-3 font-medium text-right">
                      {t('admin.plugins.servicePlugin.metrics.errors')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {byCommand.map(([cmd, stats]) => (
                    <tr key={cmd} className="border-b border-white/[0.03] last:border-0">
                      <td className="py-1.5 pr-3 font-mono text-slate-300 truncate">{cmd}</td>
                      <td className="py-1.5 px-3 text-right text-slate-400">{stats.calls}</td>
                      <td className="py-1.5 pl-3 text-right text-slate-400">{stats.errors}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
