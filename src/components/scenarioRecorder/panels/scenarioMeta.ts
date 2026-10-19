import { formatDateTime as formatDateTimeBase } from '@/lib/utils';
import type { ScenarioMetadata } from '@/lib/backend/modules/pythonJobs';

export const formatLastPlayed = (value?: string | null) => formatDateTimeBase(value);

export const formatDateTime = (value?: string | null) => formatDateTimeBase(value);

export const healthVariant = (score?: number | null) => {
  if (score == null) return 'outline' as const;
  if (score >= 85) return 'success' as const;
  if (score >= 60) return 'warning' as const;
  return 'danger' as const;
};

export const safeMeta = (m?: ScenarioMetadata | null): ScenarioMetadata => {
  return {
    description: m?.description ?? null,
    tags: Array.isArray(m?.tags) ? m!.tags.filter(Boolean) : [],
    lastStatus: m?.lastStatus ?? null,
    lastDurationMs: m?.lastDurationMs ?? null,
    lastRunAt: m?.lastRunAt ?? null
  };
};
