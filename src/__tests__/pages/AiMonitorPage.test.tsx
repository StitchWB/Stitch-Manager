import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { useEffect } from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import AiProviders from '../../pages/AiProviders';
import * as aiProxyModule from '../../lib/backend/modules/aiProxy';

jest.mock('../../components/layout/Header', () => ({
  __esModule: true,
  default: ({ title }: { title: string }) => <div>{title}</div>,
}));

// const-exports (fetchAllQuotasSafe etc.) can't be redefined by jest.spyOn — mock the whole module
jest.mock('../../lib/backend/modules/aiProxy', () => {
  const actual = jest.requireActual('../../lib/backend/modules/aiProxy') as object;
  return {
    ...actual,
    getAiProxyAccounts: jest.fn(),
    getAvailableModelsSafe: jest.fn(),
    getProviderCapabilities: jest.fn(),
    getProviderModelMappings: jest.fn(),
    getRequestHistory: jest.fn(),
    testProviderConnection: jest.fn(),
    setProviderModelMappings: jest.fn(),
    fetchAllQuotas: jest.fn(async () => []),
    fetchAllQuotasSafe: jest.fn(async () => []),
    fetchOpenAiAccountQuotas: jest.fn(async () => []),
    fetchOpenAiAccountQuotasSafe: jest.fn(async () => []),
    fetchKiroAccountQuotas: jest.fn(async () => []),
    fetchKiroAccountQuotasSafe: jest.fn(async () => []),
  };
});

jest.mock('../../components/ai-proxy/AccountModal', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock(
  '../../components/ai-proxy/QuotaDashboard',
  () => ({ QuotaDashboard: () => null }),
  { virtual: true },
);

// HoloneSection subscribes over WS — mock it to keep the page test off the WS architecture
jest.mock('../../components/ai-proxy/sections/HoloneSection', () => ({
  __esModule: true,
  HoloneSection: () => null,
}));

// gateway catalog fetches are stubbed to empty lists so the test stays on the accounts surface
jest.mock('../../lib/backend/modules/aiGateway', () => ({
  listProviderEndpoints: jest.fn(async () => []),
  listCredentials: jest.fn(async () => []),
  listUpstreamModels: jest.fn(async () => []),
  listPublicModels: jest.fn(async () => []),
  listCredentialModelAccess: jest.fn(async () => []),
  listRouteTargetsForPublicModel: jest.fn(async () => []),
  discoverModelsForEndpoint: jest.fn(async () => ({ models_count: 0 })),
  migrateLegacyData: jest.fn(async () => ({ endpoints_created: 0, credentials_created: 0 })),
  importOpencodeProviders: jest.fn(async () => ({
    imported: [],
    skipped: [],
    models: [],
    public_models: [],
    shared_to_group: null,
  })),
  testCredentialConnection: jest.fn(async () => ({ success: true })),
  proxyKeysList: jest.fn(async () => ({
    baseUrl: '',
    keys: [],
    pool: { personal: 0, legacy: 0, groups: [] },
  })),
  proxyKeysCreate: jest.fn(async () => ({ key: 'k', id: 'id' })),
  proxyKeysRevoke: jest.fn(async () => ({ success: true })),
}));

jest.mock('../../components/ai-gateway/PublicModelsSection', () => ({
  PublicModelsSection: () => null,
}));

jest.mock('../../pages/AiAnalytics', () => ({
  __esModule: true,
  default: () => <div data-testid="ai-analytics-page" />,
}));

const proxy = aiProxyModule as jest.Mocked<typeof aiProxyModule>;

let navigatedPath = '';
let navigatedSearch = '';

function LocationSpy() {
  const loc = useLocation();
  useEffect(() => {
    navigatedPath = loc.pathname;
    navigatedSearch = loc.search;
  }, [loc.pathname, loc.search]);
  return null;
}

const testAccount = {
  id: 1,
  provider: 'openai',
  name: 'OpenAI Main',
  oauthToken: null,
  apiKey: 'sk-test',
  sessionToken: null,
  enabled: true,
  accountType: 'free',
  requestsToday: 1,
  requestsTotal: 10,
  tokensUsed: 123,
  lastUsedAt: null,
  createdAt: 0,
  updatedAt: 0,
};

describe('AiMonitorPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    navigatedPath = '';
    navigatedSearch = '';

    proxy.getAiProxyAccounts.mockResolvedValue([testAccount] as any);
    proxy.getAvailableModelsSafe.mockResolvedValue([
      { id: 'gpt-4-turbo', provider: 'openai', ownedBy: 'openai' },
    ] as any);
    proxy.getProviderCapabilities.mockResolvedValue([
      {
        provider: 'openai',
        supportsApiKeys: true,
        supportsOauth: true,
        totalAccounts: 1,
        enabledAccounts: 1,
        totalApiKeys: 1,
        configured: true,
      },
    ] as any);
    proxy.getProviderModelMappings.mockResolvedValue([
      { modelPattern: '^gpt-', provider: 'openai', modelId: 'gpt-4-turbo' },
    ] as any);
    proxy.getRequestHistory.mockResolvedValue([] as any);
    proxy.testProviderConnection.mockResolvedValue({
      success: true,
      provider: 'openai',
      modelId: null,
      message: 'ok',
    } as any);
    proxy.setProviderModelMappings.mockResolvedValue(undefined as any);
  });

  it('lands the monitor analytics action on /ai/monitor?tab=analytics', async () => {
    render(
      <MemoryRouter initialEntries={['/ai/monitor']}>
        <LocationSpy />
        <Routes>
          <Route path="/ai/monitor" element={<AiProviders />} />
          <Route path="/ai/chat" element={<div data-testid="chat-page" />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByRole('button', { name: 'Open Detailed Analytics' });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open Detailed Analytics' }));
    });

    await waitFor(() => {
      expect(navigatedPath + navigatedSearch).toBe('/ai/monitor?tab=analytics');
    });
  });

  it('lands the monitor request-history analytics action on /ai/monitor?tab=analytics', async () => {
    render(
      <MemoryRouter initialEntries={['/ai/monitor']}>
        <LocationSpy />
        <Routes>
          <Route path="/ai/monitor" element={<AiProviders />} />
          <Route path="/ai/chat" element={<div data-testid="chat-page" />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByRole('button', { name: 'Open Request Analytics' });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open Request Analytics' }));
    });

    await waitFor(() => {
      expect(navigatedPath + navigatedSearch).toBe('/ai/monitor?tab=analytics');
    });
  });

  it('lands the monitor debug-chat menu action on /ai/chat', async () => {
    render(
      <MemoryRouter initialEntries={['/ai/monitor']}>
        <LocationSpy />
        <Routes>
          <Route path="/ai/monitor" element={<AiProviders />} />
          <Route path="/ai/chat" element={<div data-testid="chat-page" />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByRole('button', { name: 'Open Detailed Analytics' });

    await act(async () => {
      fireEvent.click(screen.getByLabelText('More'));
    });
    const debugChatItem = screen.getByRole('menuitem', { name: 'Open Debug Chat' });
    await act(async () => {
      fireEvent.click(debugChatItem);
    });

    await waitFor(() => {
      expect(navigatedPath).toBe('/ai/chat');
    });
  });

  it('mounts AiAnalytics on the monitor analytics tab', async () => {
    render(
      <MemoryRouter initialEntries={['/ai/monitor?tab=analytics']}>
        <Routes>
          <Route path="/ai/monitor" element={<AiProviders />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByTestId('ai-analytics-page')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open Request Analytics' })).toBeNull();
  });
});
