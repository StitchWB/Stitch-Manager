import type { Account } from '@/types/generated';

export function formatRelativeTime(dateString?: string | null): string {
  if (!dateString) return 'Never';
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 30) return `${diffDays}d ago`;
  return `${Math.floor(diffDays / 30)}mo ago`;
}

export function parseJsonValue(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function isAutoRefreshEnabled(account: Account): boolean {
  if (!account.metadata) return false;
  try {
    const meta = JSON.parse(account.metadata);
    return meta.autoRefreshQuota === true;
  } catch {
    return false;
  }
}

export function isKiroProvider(account: Account): boolean {
  return ['kiro', 'kiro_v2'].includes(account.provider?.toLowerCase() ?? '');
}

export type InspectorTab = 'overview' | 'session' | 'activity' | 'data' | 'notes';

export const TAB_IDS: InspectorTab[] = ['overview', 'session', 'activity', 'data', 'notes'];
