import type { RequestTrace } from '@/lib/backend/modules/aiProxy';

export function isPublicModelFallback(row: RequestTrace): boolean {
  // Gateway traces count every failed candidate attempt in failover_count.
  // That is upstream failover inside the same public model, not a fallback to
  // another public model. Legacy rows do not carry the additive gateway
  // fields, so retain the historical failover_count interpretation there.
  if (row.requested_model) {
    return Boolean(row.served_public_model && row.served_public_model !== row.requested_model);
  }
  return row.failover_count > 0;
}
