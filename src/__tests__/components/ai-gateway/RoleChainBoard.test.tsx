import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen, within } from '@testing-library/react';

import { RoleChainBoard } from '@/components/ai-gateway/RoleChainBoard';
import { getAiGatewayRoutingStatus } from '@/lib/backend/modules/aiGateway';
import { useAiGatewayStore } from '@/stores/aiGateway';

jest.mock('@/lib/backend/modules/aiGateway', () => ({
  getAiGatewayRoutingStatus: jest.fn(),
}));

const mockedGetStatus = getAiGatewayRoutingStatus as jest.MockedFunction<typeof getAiGatewayRoutingStatus>;

const statusFixture = {
  gateway: { running: true, baseUrl: 'http://127.0.0.1:25584/v1', port: 25584 },
  generatedAt: '2026-01-01T00:00:00Z',
  roles: [
    {
      id: 'rb/lead',
      displayName: 'rb/lead',
      enabled: true,
      contract: null,
      state: 'degraded' as const,
      totalSteps: 2,
      activeSteps: 1,
      probingSteps: 1,
      demotedSteps: 0,
      steps: [
        {
          entryId: 'entry-1',
          ordinal: 0,
          desiredEnabled: true,
          source: 'default',
          endpointSelector: 'reformboss',
          upstreamModelKey: 'gemini-4-carbon',
          family: 'google',
          endpointId: 'endpoint-1',
          endpointName: 'ReformBoss',
          endpointBaseUrl: 'https://api.reformboss.com/v1',
          endpointEnabled: true,
          endpointCircuitState: 'closed',
          upstreamRowId: 'upstream-1',
          upstreamEnabled: true,
          routeTargetId: 1,
          routeEnabled: true,
          priority: 10,
          managedBy: 'role_catalog',
          lifecycleStatus: 'active',
          lifecycleReason: 'positive_exact_model_probe',
          lifecycleUpdatedAt: '2026-01-01T00:00:00Z',
          state: 'active' as const,
          isCurrent: true,
          access: {
            available: 2,
            denied: 0,
            temporarilyUnavailable: 0,
            unknown: 0,
            nextProbeAt: null,
            lastVerifiedAt: '2026-01-01T00:00:00Z',
          },
        },
        {
          entryId: 'entry-2',
          ordinal: 1,
          desiredEnabled: true,
          source: 'default',
          endpointSelector: 'reformboss',
          upstreamModelKey: 'deepseek-v4-pro',
          family: 'deepseek',
          endpointId: 'endpoint-1',
          endpointName: 'ReformBoss',
          endpointBaseUrl: 'https://api.reformboss.com/v1',
          endpointEnabled: true,
          endpointCircuitState: 'closed',
          upstreamRowId: 'upstream-2',
          upstreamEnabled: true,
          routeTargetId: 2,
          routeEnabled: false,
          priority: 20,
          managedBy: 'role_catalog',
          lifecycleStatus: 'quarantined',
          lifecycleReason: 'awaiting_exact_model_probe',
          lifecycleUpdatedAt: null,
          state: 'probing' as const,
          isCurrent: false,
          access: {
            available: 0,
            denied: 1,
            temporarilyUnavailable: 1,
            unknown: 0,
            nextProbeAt: null,
            lastVerifiedAt: null,
          },
        },
      ],
    },
  ],
};

describe('RoleChainBoard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetStatus.mockResolvedValue(statusFixture);
    useAiGatewayStore.setState({
      routingStatus: statusFixture,
      loading: { ...useAiGatewayStore.getState().loading, routingStatus: false },
      errors: { ...useAiGatewayStore.getState().errors, routingStatus: null },
    });
  });

  it('renders rb/* chains in desired order with current state and exact probe counts', async () => {
    render(<RoleChainBoard />);

    expect(await screen.findByTestId('role-chain-board')).toBeTruthy();
    expect(screen.getByText('http://127.0.0.1:25584/v1')).toBeTruthy();
    const role = screen.getByTestId('role-chain-role-rb/lead');
    expect(within(role).getByText('gemini-4-carbon')).toBeTruthy();
    expect(within(role).getByText('deepseek-v4-pro')).toBeTruthy();
    expect(within(role).getByText('current')).toBeTruthy();
    expect(within(role).getByText('1/2 active')).toBeTruthy();
    expect(within(role).getByText('2 available')).toBeTruthy();
    expect(within(role).getByText('1 denied')).toBeTruthy();
    expect(within(role).getByText('1 temporary')).toBeTruthy();
    expect(within(role).getByText('awaiting_exact_model_probe')).toBeTruthy();
  });
});
