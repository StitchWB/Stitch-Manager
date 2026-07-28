/**
 * API client for key metrics
 */

import type { KeyMetrics, MetricsSummary, CostData } from '@/types/metrics';

const API_BASE = '/api/metrics';

/**
 * Get metrics for all keys
 */
export async function getAllKeyMetrics(): Promise<KeyMetrics[]> {
  const response = await fetch(`${API_BASE}/keys`);
  if (!response.ok) {
    throw new Error(`Failed to fetch metrics: ${response.statusText}`);
  }
  const data = await response.json();
  return data.metrics;
}

/**
 * Get metrics for a specific provider
 */
export async function getProviderKeyMetrics(provider: string): Promise<KeyMetrics[]> {
  const response = await fetch(`${API_BASE}/keys/${encodeURIComponent(provider)}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch metrics for ${provider}: ${response.statusText}`);
  }
  const data = await response.json();
  return data.metrics;
}

/**
 * Get cost data for all keys
 */
export async function getAllCosts(): Promise<CostData> {
  const response = await fetch(`${API_BASE}/costs`);
  if (!response.ok) {
    throw new Error(`Failed to fetch costs: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Get metrics summary
 */
export async function getMetricsSummary(): Promise<MetricsSummary> {
  const response = await fetch(`${API_BASE}/summary`);
  if (!response.ok) {
    throw new Error(`Failed to fetch summary: ${response.statusText}`);
  }
  return response.json();
}
