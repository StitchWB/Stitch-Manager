import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { UpstreamModel } from '@/lib/backend/modules/aiGateway';

jest.mock('@/lib/events', () => ({
  listen: jest.fn(async () => () => {}),
}));

const mockListUpstreamModels = jest.fn();

jest.mock('@/lib/backend/modules/aiGateway', () => ({
  listUpstreamModels: (...args: unknown[]) => mockListUpstreamModels(...args),
}));

import { useAiGatewayStore } from '@/stores/aiGateway';

function model(id: string, endpointId: string): UpstreamModel {
  return {
    id,
    providerEndpointId: endpointId,
    upstreamModelId: id,
    enabled: true,
    discoverySource: 'probe',
    createdAt: '2026-01-01T00:00:00Z',
  };
}

describe('aiGateway fetchUpstreamModels per-endpoint merge', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAiGatewayStore.setState({
      upstreamModels: [model('a-1', 'ep-a'), model('b-1', 'ep-b')],
    });
  });

  it('keeps other endpoints rows when fetching a single endpoint', async () => {
    mockListUpstreamModels.mockResolvedValue([model('a-2', 'ep-a')]);

    await useAiGatewayStore.getState().fetchUpstreamModels('ep-a');

    const rows = useAiGatewayStore.getState().upstreamModels;
    expect(rows.map(m => m.id).sort()).toEqual(['a-2', 'b-1']);
    expect(mockListUpstreamModels).toHaveBeenCalledWith('ep-a');
  });

  it('replaces the whole array when fetching without an endpoint', async () => {
    mockListUpstreamModels.mockResolvedValue([model('c-1', 'ep-c')]);

    await useAiGatewayStore.getState().fetchUpstreamModels();

    const rows = useAiGatewayStore.getState().upstreamModels;
    expect(rows.map(m => m.id)).toEqual(['c-1']);
  });
});