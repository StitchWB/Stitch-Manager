import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AiProvidersPage from '../../pages/AiProvidersPage';
import * as aiGatewayModule from '../../lib/backend/modules/aiGateway';
import * as customProvidersModule from '../../lib/backend/modules/customProviders';
import { useAiGatewayStore } from '../../stores/aiGateway';

jest.mock('@/hooks/useServicePlugins', () => ({
  useServicePlugins: jest.fn(() => []),
}));

jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
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

describe('AiProvidersPage toggle persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useAiGatewayStore.setState({
      endpoints: [],
      credentials: [],
      upstreamModels: [],
      publicModels: [],
      routeTargets: [],
    });
    gw.listProviderEndpoints.mockResolvedValue([endpointOpenAi] as never);
    gw.listCredentials.mockResolvedValue([credentialActive] as never);
    gw.listUpstreamModels.mockResolvedValue([] as never);
    cp.getCustomProviders.mockResolvedValue([] as never);
  });

  it("persists a key row's enabled toggle to updateCredential", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('OpenAI');
    await user.click(screen.getByText('OpenAI'));

    const fingerprint = await screen.findByText('abcdef123456');
    const row = fingerprint.closest('div');
    expect(row).not.toBeNull();
    const checkedBoxes = within(row as HTMLElement)
      .getAllByRole('checkbox')
      .filter(el => (el as HTMLInputElement).checked);
    expect(checkedBoxes).toHaveLength(1);

    fireEvent.click(checkedBoxes[0]);

    await waitFor(() =>
      expect(gw.updateCredential).toHaveBeenCalledWith({ id: 'cred-1', enabled: false }),
    );
  });

  it("persists the settings panel's enabled toggle to updateEndpoint", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('OpenAI');
    await user.click(screen.getByText('OpenAI'));
    await user.click(await screen.findByRole('button', { name: 'Settings' }));

    fireEvent.click(screen.getByLabelText('Enabled'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(gw.updateProviderEndpoint).toHaveBeenCalledWith({
        id: 'ep-openai',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        enabled: false,
      }),
    );
  });
});
