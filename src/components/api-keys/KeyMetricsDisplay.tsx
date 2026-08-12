import { memo } from 'react';
import { t } from '@/lib/i18n';
import { Activity, AlertCircle, CheckCircle2, Clock, Zap } from 'lucide-react';
import type { KeyMetrics } from '@/types/metrics';

interface KeyMetricsDisplayProps {
  metrics: KeyMetrics;
}

/**
 * Display metrics for a single API key
 */
export const KeyMetricsDisplay = memo(function KeyMetricsDisplay({ metrics }: KeyMetricsDisplayProps) {
  const successRatePercent = (metrics.successRate * 100).toFixed(1);
  const avgLatencyMs = (metrics.avgLatency * 1000).toFixed(0);
  
  // Color coding for success rate
  const successRateColor = 
    metrics.successRate >= 0.95 ? 'text-emerald-400' :
    metrics.successRate >= 0.8 ? 'text-amber-400' :
    'text-red-400';
  
  // Format last used time
  const lastUsedText = metrics.lastUsed 
    ? formatTimeAgo(metrics.lastUsed)
    : 'Never';
  
  return (
    <div className="grid grid-cols-2 gap-3 text-xs">
      {/* Success Rate */}
      <div className="flex items-center gap-1.5">
        <CheckCircle2 className={`w-3.5 h-3.5 ${successRateColor}`} />
        <span className="text-slate-400">{t('apiKeys.success')}</span>
        <span className={`font-semibold ${successRateColor}`}>
          {successRatePercent}%
        </span>
      </div>
      
      {/* Average Latency */}
      <div className="flex items-center gap-1.5">
        <Clock className="w-3.5 h-3.5 text-sky-400" />
        <span className="text-slate-400">{t('apiKeys.latency')}</span>
        <span className="font-semibold text-slate-200">
          {t('apiKeys.latencyValue', { count: avgLatencyMs })}
        </span>
      </div>
      
      {/* Usage Count */}
      <div className="flex items-center gap-1.5">
        <Activity className="w-3.5 h-3.5 text-violet-400" />
        <span className="text-slate-400">{t('apiKeys.requests')}</span>
        <span className="font-semibold text-slate-200">
          {metrics.usageCount}
        </span>
      </div>
      
      {/* Tokens */}
      <div className="flex items-center gap-1.5">
        <Zap className="w-3.5 h-3.5 text-amber-400" />
        <span className="text-slate-400">{t('apiKeys.tokens')}</span>
        <span className="font-semibold text-slate-200">
          {formatNumber(metrics.totalTokens)}
        </span>
      </div>
      
      {/* Last Used */}
      <div className="flex items-center gap-1.5 col-span-2">
        <Clock className="w-3.5 h-3.5 text-slate-500" />
        <span className="text-slate-400">{t('apiKeys.lastUsed')}</span>
        <span className="text-slate-300">{lastUsedText}</span>
      </div>
      
      {/* Last Error */}
      {metrics.lastError && (
        <div className="flex items-start gap-1.5 col-span-2 mt-1 p-2 bg-red-500/10 border border-red-500/20 rounded">
          <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="text-red-400 font-medium text-xs">{t('apiKeys.lastError')}</div>
            <div className="text-red-300/80 text-xs truncate" title={metrics.lastError}>
              {metrics.lastError}
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

/**
 * Format timestamp as "X ago"
 */
function formatTimeAgo(timestamp: number): string {
  const now = Date.now() / 1000;
  const diff = now - timestamp;
  
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

/**
 * Format large numbers with K/M suffix
 */
function formatNumber(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toString();
}
