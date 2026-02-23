import { useEffect, useState } from 'react';
import { Activity, TrendingUp, DollarSign, Clock } from 'lucide-react';
import { StatCard, Button, EmptyState } from '../components/ui';
import {
  getDailyStats,
  getModelUsage,
  getCostEstimate,
  getWeeklyStats,
} from '../lib/tauri/modules/aiProxy';
import type { DailyStats, ModelUsage, DailyStatsPoint } from '../types/generated';

export default function AiAnalytics() {
  const [dailyStats, setDailyStats] = useState<DailyStats | null>(null);
  const [modelUsage, setModelUsage] = useState<ModelUsage[]>([]);
  const [costEstimate, setCostEstimate] = useState<number>(0);
  const [weeklyStats, setWeeklyStats] = useState<DailyStatsPoint[]>([]);
  const [loading, setLoading] = useState(true);

  const loadAnalytics = async () => {
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
  };

  useEffect(() => {
    loadAnalytics();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-vsc-text-muted">Loading analytics...</div>
      </div>
    );
  }

  if (!dailyStats) {
    return (
      <EmptyState
        icon={Activity}
        title="No analytics data available"
        description="Start using the AI Proxy to see analytics"
      />
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-vsc-text">AI Proxy Analytics</h1>
          <p className="text-sm text-vsc-text-muted mt-1">
            Monitor your AI API usage and performance
          </p>
        </div>
        <Button variant="secondary" onClick={loadAnalytics}>
          Refresh
        </Button>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<Activity className="w-4 h-4" />}
          label="Total Requests"
          value={dailyStats.totalRequests.toString()}
        />
        <StatCard
          icon={<TrendingUp className="w-4 h-4" />}
          label="Tokens Used"
          value={dailyStats.totalTokens.toLocaleString()}
        />
        <StatCard
          icon={<Clock className="w-4 h-4" />}
          label="Avg Duration"
          value={`${dailyStats.avgDurationMs.toFixed(0)}ms`}
        />
        <StatCard
          icon={<DollarSign className="w-4 h-4" />}
          label="Est. Cost"
          value={`$${costEstimate.toFixed(4)}`}
        />
      </div>

      {/* Weekly Chart */}
      {weeklyStats.length > 0 && (
        <div className="bg-vsc-sidebar border border-vsc-border rounded-lg p-6">
          <h2 className="text-lg font-semibold text-vsc-text mb-4">Weekly Activity</h2>
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
                  <span className="text-sm text-vsc-text">{stat.requests} requests</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Model Usage */}
      {modelUsage.length > 0 && (
        <div className="bg-vsc-sidebar border border-vsc-border rounded-lg p-6">
          <h2 className="text-lg font-semibold text-vsc-text mb-4">Model Usage</h2>
          <div className="space-y-3">
            {modelUsage.map(model => (
              <div key={model.model} className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="text-sm font-medium text-vsc-text">{model.model}</div>
                  <div className="text-xs text-vsc-text-muted">
                    {model.tokens.toLocaleString()} tokens
                  </div>
                </div>
                <div className="text-sm text-vsc-text-muted">{model.requests} requests</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
