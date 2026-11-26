import { describe, expect, it } from '@jest/globals';
import { isPublicModelFallback } from '../../pages/requestFallbackClassification';
import type { RequestTrace } from '@/lib/backend/modules/aiProxy';

function trace(overrides: Partial<RequestTrace>): RequestTrace {
  return {
    model: 'rb/lead',
    target: 'ReformBoss',
    credential_id: 'cred',
    latency_ms: 10,
    failover_count: 0,
    status: 'success',
    timestamp: 1,
    ...overrides,
  };
}

describe('isPublicModelFallback', () => {
  it('does not classify upstream candidate retries within the same rb/* role as public-model fallback', () => {
    expect(isPublicModelFallback(trace({
      failover_count: 1,
      requested_model: 'rb/lead',
      served_public_model: 'rb/lead',
    }))).toBe(false);
  });

  it('classifies a served public model different from the requested one as fallback', () => {
    expect(isPublicModelFallback(trace({
      failover_count: 1,
      requested_model: 'rb/lead',
      served_public_model: 'rb/small',
    }))).toBe(true);
  });

  it('does not classify failed upstream attempts without a served public model as fallback', () => {
    expect(isPublicModelFallback(trace({
      failover_count: 2,
      requested_model: 'rb/lead',
      served_public_model: null,
    }))).toBe(false);
  });

  it('keeps legacy failover_count semantics when additive gateway fields are absent', () => {
    expect(isPublicModelFallback(trace({ failover_count: 2 }))).toBe(true);
    expect(isPublicModelFallback(trace({ failover_count: 0 }))).toBe(false);
  });
});
