import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';

import * as aiGatewayModule from '@/lib/backend/modules/aiGateway';
import * as backgroundManagerModule from '@/lib/backend/modules/backgroundManager';
import * as aiProxyModule from '@/lib/backend/modules/aiProxy';
import type { BackgroundManagerConfig } from '@/lib/backend/modules/backgroundManager';
import type { ProviderEndpoint, PublicModel, RouteTarget } from '@/lib/backend/modules/aiGateway';
import type { ProxySettings } from '@/types/generated';
import { useAiGatewayStore } from '@/stores/aiGateway';
import { ProviderEndpointForm } from '@/components/ai-gateway/ProviderEndpointForm';
import { PublicModelForm } from '@/components/ai-gateway/PublicModelForm';
import { RouteTargetForm } from '@/components/ai-gateway/RouteTargetForm';
import { RotationSettingsPanel } from '@/components/ai-proxy/sections/RotationSettingsPanel';
import { AiProxyControlsSection } from '@/components/ai-proxy/sections/AiProxyControlsSection';
import { useAiProvidersController, maskKey } from '@/pages/hooks/useAiProvidersController';

jest.mock('@/lib/i18n', () => ({
  t: (key: string) => key,
  setLocale: () => undefined,
  getLocale: () => 'en',
}));

jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

jest.mock('@/lib/backend/modules/aiGateway', () => ({
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
}));

jest.mock('@/lib/backend/modules/backgroundManager', () => ({
  getBackgroundManagerConfig: jest.fn(),
  updateBackgroundManagerConfig: jest.fn(async () => undefined),
}));

jest.mock('@/lib/backend/modules/aiProxy', () => ({
  getAiProxyAccounts: jest.fn(async () => []),
  deleteAiProxyAccount: jest.fn(async () => undefined),
  updateAiProxyAccount: jest.fn(async () => undefined),
  debugRunAiProxyMigration: jest.fn(async () => ''),
  getAvailableModelsSafe: jest.fn(async () => []),
  getProviderCapabilities: jest.fn(async () => []),
  getProviderModelMappings: jest.fn(async () => []),
  setProviderModelMappings: jest.fn(async () => undefined),
  testProviderConnection: jest.fn(async () => ({ success: true })),
  getRequestHistory: jest.fn(async () => []),
  startAiProxy: jest.fn(async () => null),
  stopAiProxy: jest.fn(async () => null),
  getProxySettings: jest.fn(),
  updateProxySettings: jest.fn(async () => undefined),
  exportAiProxyAccountsPayload: jest.fn(async () => ''),
  importAiProxyAccountsPayload: jest.fn(async () => 0),
  fetchAllQuotasSafe: jest.fn(async () => []),
  fetchOpenAiAccountQuotasSafe: jest.fn(async () => []),
  fetchKiroAccountQuotasSafe: jest.fn(async () => []),
  scanAuthFiles: jest.fn(async () => []),
}));

jest.mock('@/stores/aiProxy', () => {
  const state = {
    setProviderQuotas: jest.fn(),
    setOpenAiAccountQuotas: jest.fn(),
    setKiroAccountQuotas: jest.fn(),
    openAiAccountQuotas: {} as Record<string, unknown>,
  };
  return {
    useAiProxyStore: (selector?: (s: typeof state) => unknown) =>
      selector ? selector(state) : state,
    refreshProxyStatus: jest.fn(async () => null),
  };
});

jest.mock('@/lib/observability/toast', () => ({
  appToast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

jest.mock('@/lib/observability/logger', () => ({
  createLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

jest.mock('@/components/ui/ConfirmDialogHost', () => ({
  askConfirm: jest.fn(async () => true),
}));

const gw = aiGatewayModule as jest.Mocked<typeof aiGatewayModule>;
const bm = backgroundManagerModule as jest.Mocked<typeof backgroundManagerModule>;
const ap = aiProxyModule as jest.Mocked<typeof aiProxyModule>;

const endpoint: ProviderEndpoint = {
  id: 'ep-1',
  name: 'OpenAI',
  adapterType: 'openai_compatible',
  baseUrl: 'https://api.openai.com/v1',
  enabled: true,
  circuitState: 'closed',
  createdAt: '2024-01-01T00:00:00Z',
};

const publicModel: PublicModel = {
  id: 'gpt-4o-mini',
  displayName: 'GPT-4o Mini',
  enabled: true,
  contract: null,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: null,
};

const routeTarget: RouteTarget = {
  id: 1,
  publicModelId: 'gpt-4o-mini',
  upstreamModelId: 'up-1',
  enabled: true,
  priority: 100,
  weight: 1,
  costModifier: 1,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: null,
};

const baseConfig: BackgroundManagerConfig = {
  autoRegisterEnabled: false,
  registerIntervalMinutes: 30,
  minAccountsThreshold: 5,
  autoSwitchEnabled: false,
  switchOnZeroCredits: false,
  checkCreditsIntervalSeconds: 300,
  autoRefreshQuotaEnabled: false,
  refreshQuotaIntervalSeconds: 300,
  refreshQuotaMaxErrors: 3,
  rotationStrategy: 'round-robin',
  providerPriority: [],
  healthCheckEnabled: false,
  healthCheckIntervalSeconds: 300,
  healthCheckAutoDisable: false,
  healthCheckTestEndpoint: '/v1/models',
  healthCheckCooldownSeconds: 3600,
  healthCheckExponentialBackoff: false,
  rateLimitEnabled: false,
  rateLimitReservePercent: 0,
  rateLimitPolicies: [],
};

const proxySettings: ProxySettings = {
  appMode: 'full',
  proxyPort: 8080,
  autoStart: false,
  routingStrategy: 'round-robin',
  managementKey: 'test-management-key',
};

function ProxyControlsHarness() {
  const controller = useAiProvidersController('routing');
  return (
    <AiProxyControlsSection
      visible
      proxyStatus={controller.proxyStatus}
      proxySettings={controller.proxySettings}
      proxyDraft={controller.proxyDraft}
      proxyBusy={controller.proxyBusy}
      proxySaving={controller.proxySaving}
      proxyError={controller.proxyError}
      baseUrl={controller.baseUrl}
      clientApiKey="test-client-key"
      isProxyDraftDirty={controller.isProxyDraftDirty}
      maskKey={maskKey}
      onCopy={jest.fn()}
      onOpenIdeWizard={jest.fn()}
      onResetDraft={controller.handleResetProxyDraft}
      onSaveSettings={controller.handleSaveProxySettings}
      onStartStopProxy={controller.handleStartStopProxy}
      onRefreshProxyInfo={controller.refreshProxyInfo}
      onSetProxyDraft={controller.setProxyDraft}
      showIdeWizardAction={false}
      showProxyActions
      showConfigActions
      showRuntimeActions
    />
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  useAiGatewayStore.setState({
    endpoints: [],
    credentials: [],
    upstreamModels: [],
    publicModels: [],
    routeTargets: [],
  });
  gw.listProviderEndpoints.mockResolvedValue([]);
  gw.listCredentials.mockResolvedValue([]);
  gw.listUpstreamModels.mockResolvedValue([]);
  gw.listPublicModels.mockResolvedValue([]);
  gw.listRouteTargetsForPublicModel.mockResolvedValue([]);
  gw.listCredentialModelAccess.mockResolvedValue([]);
  bm.getBackgroundManagerConfig.mockResolvedValue({ ...baseConfig });
  ap.getProxySettings.mockResolvedValue({ ...proxySettings });
});

describe('ProviderEndpointForm enabled checkbox persistence', () => {
  it('persists the toggled-off checkbox through updateProviderEndpoint', async () => {
    render(<ProviderEndpointForm endpoint={endpoint} open onClose={jest.fn()} />);

    fireEvent.click(screen.getByLabelText('aiGateway.enabled'));
    fireEvent.click(screen.getByRole('button', { name: 'aiGateway.cred.update' }));

    await waitFor(() =>
      expect(gw.updateProviderEndpoint).toHaveBeenCalledWith({
        id: 'ep-1',
        name: 'OpenAI',
        adapterType: 'openai_compatible',
        baseUrl: 'https://api.openai.com/v1',
        enabled: false,
      }),
    );
  });

  it('persists the toggled-off checkbox through createProviderEndpoint', async () => {
    render(<ProviderEndpointForm open onClose={jest.fn()} />);

    fireEvent.change(screen.getByPlaceholderText('aiGateway.form.phName'), {
      target: { value: 'Anthropic' },
    });
    fireEvent.change(screen.getByPlaceholderText('aiGateway.form.phBaseUrl'), {
      target: { value: 'https://api.anthropic.com' },
    });
    fireEvent.click(screen.getByLabelText('aiGateway.enabled'));
    fireEvent.click(screen.getByRole('button', { name: 'aiGateway.cred.create' }));

    await waitFor(() =>
      expect(gw.createProviderEndpoint).toHaveBeenCalledWith({
        name: 'Anthropic',
        adapterType: 'openai_compatible',
        baseUrl: 'https://api.anthropic.com',
        enabled: false,
      }),
    );
  });
});

describe('PublicModelForm enabled checkbox persistence', () => {
  it('persists the toggled-off checkbox through updatePublicModel', async () => {
    render(<PublicModelForm model={publicModel} open onClose={jest.fn()} />);

    fireEvent.click(screen.getByLabelText('aiGateway.enabled'));
    fireEvent.click(screen.getByRole('button', { name: 'aiGateway.cred.update' }));

    await waitFor(() =>
      expect(gw.updatePublicModel).toHaveBeenCalledWith({
        id: 'gpt-4o-mini',
        displayName: 'GPT-4o Mini',
        contract: null,
        enabled: false,
      }),
    );
  });

  it('persists the toggled-off checkbox through createPublicModel', async () => {
    gw.createPublicModel.mockResolvedValue({ ...publicModel, id: 'my-model', enabled: false });
    render(<PublicModelForm open onClose={jest.fn()} />);

    fireEvent.change(screen.getByPlaceholderText('gpt-4o-mini'), {
      target: { value: 'my-model' },
    });
    fireEvent.click(screen.getByLabelText('aiGateway.enabled'));
    fireEvent.click(screen.getByRole('button', { name: 'aiGateway.cred.create' }));

    await waitFor(() =>
      expect(gw.createPublicModel).toHaveBeenCalledWith({
        id: 'my-model',
        displayName: null,
        contract: null,
        enabled: false,
      }),
    );
  });
});

describe('RouteTargetForm enabled checkbox persistence', () => {
  it('persists the toggled-off checkbox through updateRouteTarget', async () => {
    render(<RouteTargetForm publicModel={publicModel} target={routeTarget} open onClose={jest.fn()} />);

    fireEvent.click(screen.getByLabelText('aiGateway.enabled'));
    fireEvent.click(screen.getByRole('button', { name: 'aiGateway.cred.update' }));

    await waitFor(() =>
      expect(gw.updateRouteTarget).toHaveBeenCalledWith({
        id: 1,
        priority: 100,
        weight: 1,
        costModifier: 1,
        enabled: false,
      }),
    );
  });

  it('persists the toggled-off checkbox through createRouteTarget', async () => {
    render(<RouteTargetForm publicModel={publicModel} open onClose={jest.fn()} />);

    fireEvent.click(screen.getByLabelText('aiGateway.enabled'));
    fireEvent.click(screen.getByRole('button', { name: 'aiGateway.cred.create' }));

    await waitFor(() =>
      expect(gw.createRouteTarget).toHaveBeenCalledWith({
        publicModelId: 'gpt-4o-mini',
        upstreamModelId: '',
        priority: 100,
        weight: 1,
        costModifier: 1,
        enabled: false,
      }),
    );
  });
});

describe('RotationSettingsPanel autoSwitchEnabled toggle persistence', () => {
  it('persists the autoSwitch toggle through updateBackgroundManagerConfig', async () => {
    bm.getBackgroundManagerConfig.mockResolvedValue({ ...baseConfig, autoSwitchEnabled: true });
    render(<RotationSettingsPanel capabilities={[]} visible />);

    const toggle = await waitFor(() => {
      const checked = screen
        .getAllByRole('checkbox')
        .filter(el => (el as HTMLInputElement).checked);
      expect(checked).toHaveLength(1);
      return checked[0];
    });

    fireEvent.click(toggle);

    await waitFor(() =>
      expect(bm.updateBackgroundManagerConfig).toHaveBeenCalledWith(
        expect.objectContaining({ autoSwitchEnabled: false }),
      ),
    );
  });
});

describe('HealthCheckSettings enabled toggle persistence (through RotationSettingsPanel)', () => {
  it('persists the health-check toggle through updateBackgroundManagerConfig', async () => {
    render(<RotationSettingsPanel capabilities={[]} visible />);

    const title = await screen.findByText('aiHub.healthCheck.title');
    const headerRow = title.parentElement?.parentElement?.parentElement;
    expect(headerRow).not.toBeNull();
    const toggle = within(headerRow as HTMLElement).getByRole('checkbox');

    await waitFor(() => expect((toggle as HTMLInputElement).disabled).toBe(false));
    fireEvent.click(toggle);

    await waitFor(() =>
      expect(bm.updateBackgroundManagerConfig).toHaveBeenCalledWith(
        expect.objectContaining({ healthCheckEnabled: true }),
      ),
    );
  });
});

describe('AiProxyControlsSection autoStart toggle persistence', () => {
  it('persists the autoStart toggle through updateProxySettings on save', async () => {
    render(<ProxyControlsHarness />);

    await waitFor(() =>
      expect((screen.getByLabelText('aiHub.proxy.portLabel') as HTMLInputElement).value).toBe(
        '8080',
      ),
    );

    fireEvent.click(screen.getByLabelText('aiHub.proxy.autoStart'));
    fireEvent.click(screen.getByRole('button', { name: 'aiHub.actions.saveSettings' }));

    await waitFor(() =>
      expect(ap.updateProxySettings).toHaveBeenCalledWith(
        expect.objectContaining({ autoStart: true }),
      ),
    );
  });
});
