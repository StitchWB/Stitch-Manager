import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen } from '@testing-library/react';

// Stub the UI primitives so the test focuses on RouteTargetsList logic, not
// on Button/Badge/Tooltip rendering internals.
jest.mock('@/components/ui', () => ({
  Button: ({ children, ...rest }: any) => <button {...rest}>{children}</button>,
  Badge: ({ children, ...rest }: any) => <span {...rest}>{children}</span>,
  Tooltip: ({ children, content }: any) => (
    <span title={content}>{children}</span>
  ),
}));

// Stub the Zustand store with a mutable state object so each test can inject
// its own routeTargets / upstreamModels / loading / errors.
const storeState: any = {
  routeTargets: [],
  upstreamModels: [],
  loading: { routeTargets: false },
  errors: { routeTargets: null },
  fetchRouteTargets: jest.fn(async () => undefined),
  fetchUpstreamModels: jest.fn(async () => undefined),
  deleteRouteTarget: jest.fn(async () => undefined),
};

jest.mock('@/stores/aiGateway', () => ({
  useAiGatewayStore: () => storeState,
}));

import { RouteTargetsList } from '@/components/ai-gateway/RouteTargetsList';
import type { RouteTarget, PublicModel, UpstreamModel } from '@/lib/backend/modules/aiGateway';

const publicModel: PublicModel = {
  id: 'pm-1',
  displayName: 'Test Model',
  enabled: true,
  contract: null,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: null,
};

function makeTarget(overrides: Partial<RouteTarget>): RouteTarget {
  return {
    id: overrides.id ?? 1,
    publicModelId: 'pm-1',
    upstreamModelId: overrides.upstreamModelId ?? 'up-1',
    enabled: overrides.enabled ?? true,
    priority: overrides.priority ?? 1,
    weight: overrides.weight ?? 1,
    costModifier: overrides.costModifier ?? 1,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: null,
  };
}

function makeUpstream(overrides: Partial<UpstreamModel>): UpstreamModel {
  return {
    id: overrides.id ?? 'up-1',
    providerEndpointId: overrides.providerEndpointId ?? 'ep-1234567890',
    upstreamModelId: overrides.upstreamModelId ?? 'gpt-4-turbo',
    displayName: null,
    enabled: true,
    discoverySource: 'manual',
    lastDiscoveredAt: null,
    capabilities: null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: null,
  };
}

describe('RouteTargetsList', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    storeState.routeTargets = [];
    storeState.upstreamModels = [];
    storeState.loading = { routeTargets: false };
    storeState.errors = { routeTargets: null };
  });

  // ── Fix #3: consistent fallback format ──────────────────────────────────

  it('shows "(unknown endpoint)" suffix when upstream model is not found', () => {
    storeState.routeTargets = [
      makeTarget({ id: 1, upstreamModelId: 'orphan-model-id-long' }),
    ];
    // upstreamModels is empty — model lookup misses, fallback path runs.
    render(
      <RouteTargetsList
        publicModel={publicModel}
        onAddTarget={jest.fn()}
        onEditTarget={jest.fn()}
      />,
    );

    // The fallback must include the "(unknown endpoint)" suffix (Fix #3).
    // slice(0, 16) of 'orphan-model-id-long' = 'orphan-model-id-' (16 chars).
    expect(screen.getByText(/orphan-model-id-.*\(unknown endpoint\)/)).toBeTruthy();
  });

  it('shows upstream model id + endpoint prefix when model is found', () => {
    storeState.routeTargets = [
      makeTarget({ id: 1, upstreamModelId: 'up-1' }),
    ];
    storeState.upstreamModels = [
      makeUpstream({
        id: 'up-1',
        upstreamModelId: 'gpt-4-turbo',
        providerEndpointId: 'ep-abcdef1234',
      }),
    ];
    render(
      <RouteTargetsList
        publicModel={publicModel}
        onAddTarget={jest.fn()}
        onEditTarget={jest.fn()}
      />,
    );

    // Success path: "gpt-4-turbo (ep-abcde)" — first 8 chars of endpoint id.
    expect(screen.getByText(/gpt-4-turbo.*\(ep-abcde\)/)).toBeTruthy();
  });

  it('truncates orphan upstream id to 16 chars in fallback', () => {
    const longId = 'a'.repeat(40);
    storeState.routeTargets = [
      makeTarget({ id: 1, upstreamModelId: longId }),
    ];
    render(
      <RouteTargetsList
        publicModel={publicModel}
        onAddTarget={jest.fn()}
        onEditTarget={jest.fn()}
      />,
    );

    // 16 a's + " (unknown endpoint)"
    const expected = 'a'.repeat(16) + ' (unknown endpoint)';
    expect(screen.getByText(expected)).toBeTruthy();
  });

  // ── Fix #4: useMemo-sorted by priority ─────────────────────────────────

  it('renders route targets sorted by priority ascending', () => {
    storeState.routeTargets = [
      makeTarget({ id: 3, upstreamModelId: 'up-3', priority: 30 }),
      makeTarget({ id: 1, upstreamModelId: 'up-1', priority: 10 }),
      makeTarget({ id: 2, upstreamModelId: 'up-2', priority: 20 }),
    ];
    storeState.upstreamModels = [
      makeUpstream({ id: 'up-1', upstreamModelId: 'model-one' }),
      makeUpstream({ id: 'up-2', upstreamModelId: 'model-two' }),
      makeUpstream({ id: 'up-3', upstreamModelId: 'model-three' }),
    ];

    const { container } = render(
      <RouteTargetsList
        publicModel={publicModel}
        onAddTarget={jest.fn()}
        onEditTarget={jest.fn()}
      />,
    );

    // Each target row shows "Priority N" — collect them in DOM order.
    const priorityBadges = Array.from(container.querySelectorAll('span')).filter(
      el => /Priority \d+/.test(el.textContent ?? ''),
    );
    const priorities = priorityBadges.map(el => el.textContent?.match(/\d+/)?.[0]);
    expect(priorities).toEqual(['10', '20', '30']);
  });

  it('does not mutate the store routeTargets array reference', () => {
    // useMemo must not call .sort() on the original array — it spreads first.
    const targets = [
      makeTarget({ id: 3, upstreamModelId: 'up-3', priority: 30 }),
      makeTarget({ id: 1, upstreamModelId: 'up-1', priority: 10 }),
    ];
    storeState.routeTargets = targets;
    storeState.upstreamModels = [
      makeUpstream({ id: 'up-1', upstreamModelId: 'm1' }),
      makeUpstream({ id: 'up-3', upstreamModelId: 'm3' }),
    ];

    render(
      <RouteTargetsList
        publicModel={publicModel}
        onAddTarget={jest.fn()}
        onEditTarget={jest.fn()}
      />,
    );

    // The original array's element order must be unchanged (no in-place sort).
    expect(storeState.routeTargets).toBe(targets);
    expect(storeState.routeTargets[0].id).toBe(3);
    expect(storeState.routeTargets[1].id).toBe(1);
  });
});
