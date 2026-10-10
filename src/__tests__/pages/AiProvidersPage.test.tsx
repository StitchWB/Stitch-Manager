import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { useEffect } from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import AiProvidersPage from '../../pages/AiProvidersPage';
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

function TestNav() {
  const navigate = useNavigate();
  return (
    <>
      <button data-testid="nav-away" onClick={() => navigate('/ai/routing')}>away</button>
      <button data-testid="nav-back" onClick={() => navigate(-1)}>back</button>
    </>
  );
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

describe('AiProvidersPage', () => {
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

  it('loads accounts and supports connection test on providers section', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/ai/providers']}>
        <Routes>
          <Route path="/ai/providers" element={<AiProvidersPage />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText('OpenAI Main');

    const testButton = screen.getByTitle('Test connection');
    await user.click(testButton);

    await waitFor(() => {
      expect(proxy.testProviderConnection).toHaveBeenCalledWith('openai');
    });
  });

  it('renders the consolidated toolbar, overflow actions and offline banner on providers section', async () => {
    render(
      <MemoryRouter initialEntries={['/ai/providers']}>
        <Routes>
          <Route path="/ai/providers" element={<AiProvidersPage />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText('OpenAI Main');

    expect(screen.getByPlaceholderText('Provider, account, or model…')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add Endpoint' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add Account' })).toBeTruthy();
    expect(screen.getByLabelText('More')).toBeTruthy();

    // Secondary actions live behind the overflow menu, not in the header.
    expect(screen.queryByRole('button', { name: 'Import from OpenCode' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Paste Package' })).toBeNull();

    // Backend unreachable in jsdom → proxy store status stays null → banner shows.
    expect(await screen.findByText('Server offline — data may be stale')).toBeTruthy();
  });

  it('replaces the provider sidebar with the url-state filter bar', async () => {
    render(
      <MemoryRouter initialEntries={['/ai/providers']}>
        <Routes>
          <Route path="/ai/providers" element={<AiProvidersPage />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText('OpenAI Main');

    expect(screen.queryByTestId('ai-providers-sidebar')).toBeNull();
    const filterBar = screen.getByTestId('provider-filter-bar');
    expect(within(filterBar).getByRole('button', { name: /OpenAI/ })).toBeTruthy();
    expect(within(filterBar).getByRole('button', { name: /All Providers/ })).toBeTruthy();
  });

  it('writes the filter bar search query to ?q= and keeps it across re-renders', async () => {
    const user = userEvent.setup();
    const tree = (
      <MemoryRouter initialEntries={['/ai/providers']}>
        <LocationSpy />
        <Routes>
          <Route path="/ai/providers" element={<AiProvidersPage />} />
        </Routes>
      </MemoryRouter>
    );
    const { rerender } = render(tree);

    const input = await screen.findByPlaceholderText('Provider, account, or model…');
    await user.type(input, 'gpt');

    await waitFor(() => {
      expect(navigatedSearch).toBe('?q=gpt');
    });

    rerender(tree);
    expect(screen.getByPlaceholderText('Provider, account, or model…')).toHaveValue('gpt');
  });

  it('keeps ?provider= when navigating away and back', async () => {
    render(
      <MemoryRouter initialEntries={['/ai/providers']}>
        <LocationSpy />
        <TestNav />
        <Routes>
          <Route path="/ai/providers" element={<AiProvidersPage />} />
          <Route path="/ai/routing" element={<div data-testid="routing-page" />} />
        </Routes>
      </MemoryRouter>
    );

    await screen.findByText('OpenAI Main');

    const filterBar = screen.getByTestId('provider-filter-bar');
    fireEvent.click(within(filterBar).getByRole('button', { name: /OpenAI/ }));
    await waitFor(() => {
      expect(navigatedSearch).toBe('?provider=openai');
    });

    fireEvent.click(screen.getByTestId('nav-away'));
    await waitFor(() => {
      expect(navigatedPath).toBe('/ai/routing');
    });

    fireEvent.click(screen.getByTestId('nav-back'));
    await waitFor(() => {
      expect(navigatedPath).toBe('/ai/providers');
      expect(navigatedSearch).toBe('?provider=openai');
    });
  });
});
