import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

const mockHandlers: Record<string, (event: { payload: unknown }) => void> = {};

jest.mock('@/lib/events', () => ({
  listen: jest.fn(
    async (name: string, handler: (event: { payload: unknown }) => void) => {
      mockHandlers[name] = handler;
      return () => {
        delete mockHandlers[name];
      };
    },
  ),
}));

const mockListProviderEndpoints = jest.fn(async () => []);
const mockListCredentials = jest.fn(async () => []);
const mockListUpstreamModels = jest.fn(async () => []);
const mockListPublicModels = jest.fn(async () => []);

jest.mock('@/lib/backend/modules/aiGateway', () => ({
  listProviderEndpoints: () => mockListProviderEndpoints(),
  listCredentials: () => mockListCredentials(),
  listUpstreamModels: () => mockListUpstreamModels(),
  listPublicModels: () => mockListPublicModels(),
}));

import { startCatalogEvents, stopCatalogEvents } from '@/stores/aiGateway';

describe('aiGateway catalog invalidation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    for (const key of Object.keys(mockHandlers)) delete mockHandlers[key];
  });

  afterEach(() => {
    stopCatalogEvents();
  });

  it('refetches catalog slices when endpoint.models_changed fires', async () => {
    startCatalogEvents();
    expect(mockHandlers['endpoint.models_changed']).toBeDefined();

    mockHandlers['endpoint.models_changed']({ payload: {} });
    await Promise.resolve();

    expect(mockListProviderEndpoints).toHaveBeenCalled();
    expect(mockListCredentials).toHaveBeenCalled();
    expect(mockListUpstreamModels).toHaveBeenCalled();
    expect(mockListPublicModels).toHaveBeenCalled();
  });

  it('refetches catalog slices when credential.state_changed fires', async () => {
    startCatalogEvents();
    expect(mockHandlers['credential.state_changed']).toBeDefined();

    mockHandlers['credential.state_changed']({ payload: {} });
    await Promise.resolve();

    expect(mockListPublicModels).toHaveBeenCalled();
    expect(mockListCredentials).toHaveBeenCalled();
  });

  it('unsubscribes when the last subscriber stops', async () => {
    startCatalogEvents();
    expect(mockHandlers['endpoint.models_changed']).toBeDefined();

    stopCatalogEvents();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockHandlers['endpoint.models_changed']).toBeUndefined();
  });
});
