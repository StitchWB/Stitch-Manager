import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { useEffect } from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

describe('AiRoutingPage', () => {
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

  it('saves model mappings on the routing mappings tab', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/ai/routing?tab=mappings']}>
        <Routes>
          <Route path="/ai/routing" element={<AiProviders />} />
        </Routes>
      </MemoryRouter>
    );

    // MappingsEditor renders when there are mappings; wait for save button.
    const saveButton = await screen.findByRole('button', { name: 'Save' });
    await user.click(saveButton);

    await waitFor(() => {
      expect(proxy.setProviderModelMappings).toHaveBeenCalled();
    });
  });

  it('shows the routing board by default on the routing page', async () => {
    render(
      <MemoryRouter initialEntries={['/ai/routing']}>
        <Routes>
          <Route path="/ai/routing" element={<AiProviders />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText('Request path')).toBeTruthy();
  });

  it('shows proxy controls instead of the board on the routing proxy tab', async () => {
    render(
      <MemoryRouter initialEntries={['/ai/routing?tab=proxy']}>
        <Routes>
          <Route path="/ai/routing" element={<AiProviders />} />
        </Routes>
      </MemoryRouter>
    );

    expect(await screen.findByText('IDE Proxy')).toBeTruthy();
    expect(screen.queryByText('Request path')).toBeNull();
  });

  it('replaces an unknown routing tab with the default board tab', async () => {
    render(
      <MemoryRouter initialEntries={['/ai/routing?tab=zzz']}>
        <LocationSpy />
        <Routes>
          <Route path="/ai/routing" element={<AiProviders />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(navigatedSearch).toBe('?tab=board');
    });
  });

  it('navigates to the proxy tab when the board proxy node config action fires', async () => {
    render(
      <MemoryRouter initialEntries={['/ai/routing']}>
        <LocationSpy />
        <Routes>
          <Route path="/ai/routing" element={<AiProviders />} />
        </Routes>
      </MemoryRouter>
    );

    const proxyNode = await screen.findByTestId('routing-node-4');
    fireEvent.click(within(proxyNode).getByRole('button', { name: 'Config' }));

    await waitFor(() => {
      expect(navigatedSearch).toBe('?tab=proxy');
    });
  });
});
