import { useCallback, useEffect, useState } from 'react';
import { Activity, TrendingUp, DollarSign, Clock, BarChart3 } from 'lucide-react';
import Header from '../components/layout/Header';
import { StatCard, Button, EmptyState } from '../components/ui';
import { AiTopTabs } from '../components/ai-proxy/AiTopTabs';
import {
  getDailyStats,
  getModelUsage,
  getCostEstimate,
  getWeeklyStats,
} from '../lib/tauri/modules/aiProxy';
import type { DailyStats, ModelUsage, DailyStatsPoint } from '../types/generated';
import { t } from '../lib/i18n';

export default function AiAnalytics() {
  const [dailyStats, setDailyStats] = useState<DailyStats | null>(null);
  const [modelUsage, setModelUsage] = useState<ModelUsage[]>([]);
  const [costEstimate, setCostEstimate] = useState<number>(0);
  const [weeklyStats, setWeeklyStats] = useState<DailyStatsPoint[]>([]);
  const [loading, setLoading] = useState(true);

  const loadAnalytics = useCallback(async () => {
    try {
      setLoading(true);
      const [stats, models, cost, weekly] = await Promise.all([
        getDailyStats(),
        getModelUsage(),
        getCostEstimate(),
        getWeeklyStats(),
      ]);
      setDailyStats(stats);
      setModelUsage(models);
      setCostEstimate(cost);
      setWeeklyStats(weekly);
    } catch (error) {
      console.error('Failed to load analytics:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAnalytics();
  }, [loadAnalytics]);

  if (loading) {
    return (
      <div className="flex flex-col h-full overflow-hidden bg-[#050508]">
        <Header title={t('aiHub.analytics.title')} icon={<BarChart3 size={18} />} />
        <AiTopTabs />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-vsc-text-muted">{t('aiHub.analytics.loading')}</div>
        </div>
      </div>
    );
  }

  if (!dailyStats) {
    return (
      <div className="flex flex-col h-full overflow-hidden bg-[#050508]">
        <Header title={t('aiHub.analytics.title')} icon={<BarChart3 size={18} />} />
        <AiTopTabs />
        <div className="flex-1 overflow-auto p-6">
          <EmptyState
            icon={Activity}
            title={t('aiHub.analytics.emptyTitle')}
            description={t('aiHub.analytics.emptyDescription')}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#050508]">
      <Header
        title={t('aiHub.analytics.title')}
        subtitle={t('aiHub.analytics.subtitle')}
        icon={<BarChart3 size={18} />}
        actions={
          <Button variant="secondary" size="sm" onClick={loadAnalytics}>
            {t('aiHub.actions.refresh')}
          </Button>
        }
      />
      <AiTopTabs />
      <div className="flex-1 overflow-auto p-6 space-y-6">
        {/* Overview Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            icon={<Activity className="w-4 h-4" />}
            label={t('aiHub.analytics.totalRequests')}
            value={dailyStats.totalRequests.toString()}
          />
          <StatCard
            icon={<TrendingUp className="w-4 h-4" />}
            label={t('aiHub.analytics.tokensUsed')}
            value={dailyStats.totalTokens.toLocaleString()}
          />
          <StatCard
            icon={<Clock className="w-4 h-4" />}
            label={t('aiHub.analytics.avgDuration')}
            value={t('aiHub.analytics.durationMs', { count: dailyStats.avgDurationMs.toFixed(0) })}
          />
          <StatCard
            icon={<DollarSign className="w-4 h-4" />}
            label={t('aiHub.analytics.estCost')}
            value={t('aiHub.analytics.costValue', { value: costEstimate.toFixed(4) })}
          />
        </div>

        {/* Weekly Chart */}
        {weeklyStats.length > 0 && (
          <div className="bg-vsc-sidebar border border-vsc-border rounded-lg p-6">
            <h2 className="text-lg font-semibold text-vsc-text mb-4">
              {t('aiHub.analytics.weeklyActivity')}
            </h2>
            <div className="space-y-2">
              {weeklyStats.map(stat => (
                <div key={stat.date} className="flex items-center gap-4">
                  <div className="w-24 text-sm text-vsc-text-muted">{stat.date}</div>
                  <div className="flex-1 flex items-center gap-2">
                    <div
                      className="h-8 bg-vsc-blue rounded"
                      style={{
                        width: `${(stat.successful / Math.max(...weeklyStats.map(s => s.requests))) * 100}%`,
                      }}
                    />
                    <span className="text-sm text-vsc-text">
                      {t('aiHub.analytics.requestsCount', { count: stat.requests })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Model Usage */}
        {modelUsage.length > 0 && (
          <div className="bg-vsc-sidebar border border-vsc-border rounded-lg p-6">
            <h2 className="text-lg font-semibold text-vsc-text mb-4">
              {t('aiHub.analytics.modelUsage')}
            </h2>
            <div className="space-y-3">
              {modelUsage.map(model => (
                <div key={model.model} className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="text-sm font-medium text-vsc-text">{model.model}</div>
                    <div className="text-xs text-vsc-text-muted">
                      {t('aiHub.analytics.tokensCount', {
                        count: model.tokens.toLocaleString(),
                      })}
                    </div>
                  </div>
                  <div className="text-sm text-vsc-text-muted">
                    {t('aiHub.analytics.requestsCount', { count: model.requests })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
