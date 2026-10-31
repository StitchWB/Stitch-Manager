import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AiProvidersPage from '../../pages/AiProvidersPage';
import * as aiGatewayModule from '../../lib/backend/modules/aiGateway';
import * as customProvidersModule from '../../lib/backend/modules/customProviders';
import { useAiGatewayStore } from '../../stores/aiGateway';
import { useServicePlugins } from '@/hooks/useServicePlugins';

jest.mock('@/hooks/useServicePlugins', () => ({
  useServicePlugins: jest.fn(() => []),
}));

jest.mock('@/lib/backend/modules/apiKeys', () => ({
  getZaiApiKeys: jest.fn(async () => []),
  setZaiApiKeys: jest.fn(),
}));

jest.mock('@/lib/backend/modules/freeModelBridge', () => ({
  getFreeModelBridgeStatus: jest.fn(async () => ({
    status: 'stopped',
    port: null,
    pid: null,
    uptimeSeconds: null,
  })),
  startFreeModelBridge: jest.fn(),
  stopFreeModelBridge: jest.fn(),
}));

jest.mock('@/lib/backend/modules/accounts', () => {
  const actual = jest.requireActual('@/lib/backend/modules/accounts') as object;
  return {
    ...actual,
    checkFireworksApiKey: jest.fn(),
  };
});

jest.mock('../../components/layout/Header', () => ({
  __esModule: true,
  default: ({ title }: { title: string }) => <div>{title}</div>,
}));

jest.mock('../../lib/backend/modules/aiProxy', () => {
  const actual = jest.requireActual('../../lib/backend/modules/aiProxy') as object;
  return {
    ...actual,
    getAiProxyAccounts: jest.fn(async () => []),
    getAvailableModelsSafe: jest.fn(async () => []),
    getProviderCapabilities: jest.fn(async () => []),
    getProviderModelMappings: jest.fn(async () => []),
    getRequestHistory: jest.fn(async () => []),
    testProviderConnection: jest.fn(async () => ({ success: true })),
    setProviderModelMappings: jest.fn(async () => undefined),
    fetchAllQuotas: jest.fn(async () => []),
    fetchAllQuotasSafe: jest.fn(async () => []),
    fetchOpenAiAccountQuotas: jest.fn(async () => []),
    fetchOpenAiAccountQuotasSafe: jest.fn(async () => []),
    fetchKiroAccountQuotas: jest.fn(async () => []),
    fetchKiroAccountQuotasSafe: jest.fn(async () => []),
  };
});

jest.mock('../../lib/backend/modules/aiGateway', () => ({
  listProviderEndpoints: jest.fn(async () => []),
  listCredentials: jest.fn(async () => []),
  listUpstreamModels: jest.fn(async () => []),
  createProviderEndpoint: jest.fn(),
  updateProviderEndpoint: jest.fn(),
  deleteProviderEndpoint: jest.fn(),
  createCredential: jest.fn(),
  updateCredential: jest.fn(),
  deleteCredential: jest.fn(),
  rotateCredentialSecret: jest.fn(),
  createUpstreamModel: jest.fn(),
  updateUpstreamModel: jest.fn(),
  deleteUpstreamModel: jest.fn(),
  upsertCredentialModelAccess: jest.fn(),
  deleteCredentialModelAccess: jest.fn(),
  createPublicModel: jest.fn(),
  updatePublicModel: jest.fn(),
  deletePublicModel: jest.fn(),
  createRouteTarget: jest.fn(),
  updateRouteTarget: jest.fn(),
  deleteRouteTarget: jest.fn(),
  listPublicModels: jest.fn(async () => []),
  listRouteTargetsForPublicModel: jest.fn(async () => []),
  listCredentialModelAccess: jest.fn(async () => []),
  migrateLegacyData: jest.fn(async () => ({ endpoints_created: 0, credentials_created: 0 })),
  importOpencodeProviders: jest.fn(async () => ({
    imported: [],
    skipped: [],
    models: [],
    public_models: [],
    shared_to_group: null,
  })),
  discoverModelsForEndpoint: jest.fn(async () => ({ models_count: 0 })),
  testCredentialConnection: jest.fn(async () => ({ success: true })),
  proxyKeysList: jest.fn(async () => ({
    baseUrl: '',
    keys: [],
    pool: { personal: 0, legacy: 0, groups: [] },
  })),
  proxyKeysCreate: jest.fn(async () => ({ key: 'k', id: 'id' })),
  proxyKeysRevoke: jest.fn(async () => ({ success: true })),
}));

jest.mock('../../lib/backend/modules/customProviders', () => ({
  getCustomProviders: jest.fn(async () => []),
}));

const gw = aiGatewayModule as jest.Mocked<typeof aiGatewayModule>;
const cp = customProvidersModule as jest.Mocked<typeof customProvidersModule>;

const endpointOpenAi = {
  id: 'ep-openai',
  name: 'OpenAI',
  adapterType: 'openai_compatible',
  baseUrl: 'https://api.openai.com/v1',
  enabled: true,
  circuitState: 'closed',
  createdAt: '2026-01-01T00:00:00Z',
};

const endpointDeepSeek = {
  id: 'ep-deepseek',
  name: 'DeepSeek CN',
  adapterType: 'openai_compatible',
  baseUrl: 'https://api.deepseek.com/v1',
  enabled: true,
  circuitState: 'closed',
  createdAt: '2026-01-02T00:00:00Z',
};

const credentialActive = {
  id: 'cred-1',
  providerEndpointId: 'ep-openai',
  authType: 'api_key',
  fingerprint: 'abcdef1234567890',
  enabled: true,
  runtimeStatus: 'active',
  consecutiveFailures: 0,
  createdAt: '2026-01-01T00:00:00Z',
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/ai/providers']}>
      <Routes>
        <Route path="/ai/providers" element={<AiProvidersPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('AiProvidersPage (unified master-detail)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAiGatewayStore.setState({
      endpoints: [],
      credentials: [],
      upstreamModels: [],
    });
    gw.listProviderEndpoints.mockResolvedValue([endpointOpenAi, endpointDeepSeek] as never);
    gw.listCredentials.mockResolvedValue([credentialActive] as never);
    gw.listUpstreamModels.mockResolvedValue([] as never);
    cp.getCustomProviders.mockResolvedValue([] as never);
  });

  it('renders the provider roster, the add action and the proxy strip', async () => {
    renderPage();

    await screen.findByText('OpenAI');

    expect(screen.getAllByRole('button', { name: 'Paste keys' }).length).toBeGreaterThan(0);
    expect(screen.getByPlaceholderText('Search providers…')).toBeTruthy();
    expect(screen.getByTestId('proxy-status-bar')).toBeTruthy();
    expect(screen.getByText('DeepSeek CN')).toBeTruthy();
  });

  it('lands on the fleet overview when no provider is selected', async () => {
    renderPage();

    await screen.findByText('OpenAI');

    expect(await screen.findByText('Fleet overview')).toBeTruthy();
    expect(screen.queryByText('Select a provider')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Paste keys' }).length).toBeGreaterThan(1);
  });

  it('shows provider and key counts in the roster footer', async () => {
    renderPage();

    await screen.findByText('OpenAI');

    expect(await screen.findByText(/2 providers · 1 keys/)).toBeTruthy();
  });

  it('shows the detail tabs after selecting a provider', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('OpenAI');
    await user.click(screen.getByText('OpenAI'));

    expect(await screen.findByRole('button', { name: 'Keys' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Models' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeTruthy();
    expect(screen.getByText('https://api.openai.com/v1 · openai_compatible')).toBeTruthy();
  });

  it('auto-discovers models when a provider with none is selected', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('OpenAI');
    await user.click(screen.getByText('OpenAI'));

    await waitFor(() => expect(gw.discoverModelsForEndpoint).toHaveBeenCalledWith('ep-openai'));
  });

  it('switches the detail pane when another provider is selected', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('OpenAI');
    await user.click(screen.getByText('DeepSeek CN'));

    await waitFor(() => {
      expect(screen.getByText('https://api.deepseek.com/v1 · openai_compatible')).toBeTruthy();
    });
  });

  it('returns to the fleet overview when the selected roster row is clicked again', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('OpenAI');
    await user.click(screen.getByText('OpenAI'));
    expect(await screen.findByText('https://api.openai.com/v1 · openai_compatible')).toBeTruthy();

    await user.click(screen.getAllByText('OpenAI')[0]);
    expect(await screen.findByText('Fleet overview')).toBeTruthy();
    expect(screen.queryByText('https://api.openai.com/v1 · openai_compatible')).toBeNull();
  });

  it('returns to the fleet overview via the detail back button', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('OpenAI');
    await user.click(screen.getByText('OpenAI'));
    expect(await screen.findByText('https://api.openai.com/v1 · openai_compatible')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Fleet overview' }));
    expect(await screen.findByText('Fleet overview')).toBeTruthy();
    expect(screen.queryByText('https://api.openai.com/v1 · openai_compatible')).toBeNull();
  });

  it('switches between detail tabs', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('OpenAI');
    await user.click(screen.getByText('OpenAI'));
    await user.click(screen.getByRole('button', { name: 'Models' }));

    expect(await screen.findByRole('button', { name: 'Discover models' })).toBeTruthy();
  });

  it('shows the legacy migration banner and empty roster when the gateway is empty', async () => {
    gw.listProviderEndpoints.mockResolvedValue([] as never);
    gw.listCredentials.mockResolvedValue([] as never);
    cp.getCustomProviders.mockResolvedValue([{ id: 'legacy-1' }] as never);

    renderPage();

    expect(await screen.findByText('Legacy data not migrated')).toBeTruthy();
    expect(screen.getAllByText('No providers yet').length).toBeGreaterThan(0);
  });

  it('hides the migration banner on a fresh install with no legacy data', async () => {
    gw.listProviderEndpoints.mockResolvedValue([] as never);
    gw.listCredentials.mockResolvedValue([] as never);
    cp.getCustomProviders.mockResolvedValue([] as never);

    renderPage();

    await screen.findByText('No providers yet');
    expect(screen.queryByText('Legacy data not migrated')).toBeNull();
  });

  it('renders the Fireworks checker and hides FreeModel when the plugin is absent', async () => {
    (useServicePlugins as jest.Mock).mockReturnValue([]);

    renderPage();

    expect(await screen.findByPlaceholderText('fw_...')).toBeTruthy();
    expect(screen.queryByText('FreeModel Bridge')).toBeNull();
  });

  it('renders the FreeModel section when the stitch-freemodel plugin is present', async () => {
    (useServicePlugins as jest.Mock).mockReturnValue([{ id: 'stitch-freemodel' } as any]);

    renderPage();

    expect(await screen.findByText('FreeModel Bridge')).toBeTruthy();
  });
});
