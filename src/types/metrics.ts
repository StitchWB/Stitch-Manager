/**
 * Key metrics types
 */

export interface KeyMetrics {
  keyId: string;
  provider: string;
  usageCount: number;
  successCount: number;
  errorCount: number;
  successRate: number;
  avgLatency: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  lastUsed: number | null;
  lastError: string | null;
  lastErrorTime: number | null;
}

export interface MetricsSummary {
  totalKeys: number;
  totalRequests: number;
  totalSuccess: number;
  totalErrors: number;
  avgSuccessRate: number;
  totalCost: number;
}

export interface CostData {
  costs: Record<string, number>;
  total: number;
}
