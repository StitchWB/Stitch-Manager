import { memo, useEffect, useState } from 'react';
import { Activity, AlertCircle, CheckCircle2, DollarSign, Key } from 'lucide-react';
import { getMetricsSummary } from '@/api/metrics';
import type { MetricsSummary } from '@/types/metrics';

/**
 * Display overall metrics summary
 */
export const MetricsSummaryDisplay = memo(function MetricsSummaryDisplay() {
  const [summary, setSummary] = useState<MetricsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    
    async function fetchSummary() {
      try {
        setLoading(true);
        setError(null);
        const data = await getMetricsSummary();
        if (mounted) {
          setSummary(data);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to load summary');
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }
    
    fetchSummary();
    
    // Refresh every 30 seconds
    const interval = setInterval(fetchSummary, 30000);
    
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  if (loading && !summary) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-sky-400" />
      </div>
    );
  }

  if (error) {
    const isBackendError = error.includes('Failed to fetch') || 
                           error.includes('NetworkError') ||
                           error.includes('Unexpected token');
    
    return (
      <div className="flex flex-col items-center gap-3 py-6 px-4 bg-amber-500/5 border border-amber-500/20 rounded-lg">
        <div className="flex items-center gap-2 text-amber-400">
          <AlertCircle className="w-5 h-5" />
          <span className="text-sm font-medium">
            {isBackendError ? 'Backend не запущен' : error}
          </span>
        </div>
        <p className="text-xs text-slate-500 text-center max-w-md">
          {isBackendError 
            ? 'Метрики будут доступны после запуска backend сервера и первых API запросов'
            : 'Не удалось загрузить метрики'}
        </p>
        <button
          onClick={() => window.location.reload()}
          className="mt-1 px-3 py-1.5 text-xs font-medium text-amber-400 hover:text-amber-300 
                     bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 
                     rounded-lg transition-colors"
        >
          Попробовать снова
        </button>
      </div>
    );
  }

  if (!summary) {
    return null;
  }

  const successRatePercent = (summary.avgSuccessRate * 100).toFixed(1);
  const successRateColor = 
    summary.avgSuccessRate >= 0.95 ? 'text-emerald-400' :
    summary.avgSuccessRate >= 0.8 ? 'text-amber-400' :
    'text-red-400';

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
      {/* Total Keys */}
      <div className="flex flex-col gap-1 p-3 bg-white/5 border border-white/10 rounded-lg">
        <div className="flex items-center gap-1.5 text-slate-400 text-xs">
          <Key className="w-3.5 h-3.5" />
          <span>Total Keys</span>
        </div>
        <div className="text-xl font-bold text-slate-100">
          {summary.totalKeys}
        </div>
      </div>
      
      {/* Total Requests */}
      <div className="flex flex-col gap-1 p-3 bg-white/5 border border-white/10 rounded-lg">
        <div className="flex items-center gap-1.5 text-slate-400 text-xs">
          <Activity className="w-3.5 h-3.5" />
          <span>Requests</span>
        </div>
        <div className="text-xl font-bold text-slate-100">
          {formatNumber(summary.totalRequests)}
        </div>
      </div>
      
      {/* Success Count */}
      <div className="flex flex-col gap-1 p-3 bg-white/5 border border-white/10 rounded-lg">
        <div className="flex items-center gap-1.5 text-slate-400 text-xs">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
          <span>Success</span>
        </div>
        <div className="text-xl font-bold text-emerald-400">
          {formatNumber(summary.totalSuccess)}
        </div>
      </div>
      
      {/* Error Count */}
      <div className="flex flex-col gap-1 p-3 bg-white/5 border border-white/10 rounded-lg">
        <div className="flex items-center gap-1.5 text-slate-400 text-xs">
          <AlertCircle className="w-3.5 h-3.5 text-red-400" />
          <span>Errors</span>
        </div>
        <div className="text-xl font-bold text-red-400">
          {formatNumber(summary.totalErrors)}
        </div>
      </div>
      
      {/* Success Rate */}
      <div className="flex flex-col gap-1 p-3 bg-white/5 border border-white/10 rounded-lg">
        <div className="flex items-center gap-1.5 text-slate-400 text-xs">
          <CheckCircle2 className="w-3.5 h-3.5" />
          <span>Success Rate</span>
        </div>
        <div className={`text-xl font-bold ${successRateColor}`}>
          {successRatePercent}%
        </div>
      </div>
      
      {/* Total Cost */}
      <div className="flex flex-col gap-1 p-3 bg-white/5 border border-white/10 rounded-lg">
        <div className="flex items-center gap-1.5 text-slate-400 text-xs">
          <DollarSign className="w-3.5 h-3.5" />
          <span>Total Cost</span>
        </div>
        <div className="text-xl font-bold text-slate-100">
          ${summary.totalCost.toFixed(2)}
        </div>
      </div>
    </div>
  );
});

/**
 * Format large numbers with K/M suffix
 */
function formatNumber(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toString();
}
