// Mock/stub pattern follows CredentialsList.test.tsx (identity t, stubbed UI primitives,
// mutable selector-aware store mock).

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

jest.mock('@/lib/i18n', () => ({
  t: (key: string, params?: Record<string, string | number>): string => {
    if (!params) return key;
    return Object.entries(params).reduce(
      (acc, [k, v]) => acc.replace(`{${k}}`, String(v)),
      key,
    );
  },
}));

jest.mock('@/lib/observability/toast', () => ({
  appToast: {
    success: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  },
}));

jest.mock('@/components/ui/ConfirmDialogHost', () => ({
  askConfirm: jest.fn(async () => true),
}));

const discoverModelsForEndpoint = jest.fn(async () => ({ models_count: 0 }));
jest.mock('@/lib/backend/modules/aiGateway', () => ({
  discoverModelsForEndpoint: (...args: unknown[]) => discoverModelsForEndpoint(...args),
}));

jest.mock('@/components/ui', () => ({
  GlassCard: ({ children, className }: any) => <div className={className}>{children}</div>,
  Badge: ({ children, variant, ...rest }: any) => (
    <span data-variant={variant} {...rest}>
      {children}
    </span>
  ),
  Button: ({ children, onClick, disabled, ...rest }: any) => (
    <button onClick={onClick} disabled={disabled} {...rest}>
      {children}
    </button>
  ),
  ButtonBase: ({ children, ...rest }: any) => <button {...rest}>{children}</button>,
  ConfirmActionButton: ({ children, onConfirm, title, disabled }: any) => (
    <button title={title} disabled={disabled} onClick={onConfirm}>
      {children}
    </button>
  ),
  ProviderLogo: ({ provider }: any) => <span data-provider={provider} />,
  StatusBadge: ({ status }: any) => <span data-testid="status-badge" data-status={status} />,
}));

jest.mock('@/components/ai-gateway/ProviderEndpointForm', () => ({
  ProviderEndpointForm: ({ open }: any) => (open ? <div data-testid="endpoint-form" /> : null),
}));

const gatewayState: any = {
  endpoints: [],
  credentials: [],
  upstreamModels: [],
  loading: { endpoints: false },
  errors: { endpoints: null },
  fetchEndpoints: jest.fn(async () => undefined),
  fetchCredentials: jest.fn(async () => undefined),
  fetchUpstreamModels: jest.fn(async () => undefined),
  deleteEndpoint: jest.fn(async () => undefined),
};

jest.mock('@/stores/aiGateway', () => ({
  useAiGatewayStore: (selector?: (s: any) => any) =>
    selector ? selector(gatewayState) : gatewayState,
}));

import { ProviderCardsSection } from '@/components/ai-proxy/ProviderCardsSection';
import type { ProviderEndpoint, UpstreamModel } from '@/lib/backend/modules/aiGateway';
import type { AiProxyAccount } from '@/types/generated';

function makeEndpoint(overrides: Partial<ProviderEndpoint> & { id: string; name: string }): ProviderEndpoint {
  return {
    adapterType: 'openai_compatible',
    baseUrl: 'https://api.example.com/v1',
    enabled: true,
    circuitState: 'closed',
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  } as ProviderEndpoint;
}

const fireworks = makeEndpoint({
  id: 'ep-fw',
  name: 'Fireworks',
  baseUrl: 'https://api.fireworks.ai/v1',
});

const emptyGw = makeEndpoint({
  id: 'ep-empty',
  name: 'EmptyGw',
  adapterType: 'anthropic',
  baseUrl: 'https://gw.invalid/v1',
});

const fwAccount = {
  id: 1,
  provider: 'fireworks',
  name: 'Main Key',
  enabled: true,
  requestsToday: 0,
  requestsTotal: 0,
  tokensUsed: 0,
} as AiProxyAccount;

const fwModel: UpstreamModel = {
  id: 'm1',
  providerEndpointId: 'ep-fw',
  upstreamModelId: 'accounts/fireworks/models/glm-5p2',
  displayName: null,
  enabled: true,
  discoverySource: 'manual',
  createdAt: '2026-01-01T00:00:00Z',
};

function renderSection(searchQuery: string) {
  const handlers = {
    onAccountClick: jest.fn(),
    onEditAccount: jest.fn(),
    onDeleteAccount: jest.fn(),
    onTestConnection: jest.fn(),
    onPastePackage: jest.fn(),
  };
  render(
    <ProviderCardsSection
      accounts={[fwAccount]}
      loading={false}
      providerFilter="all"
      searchQuery={searchQuery}
      connectionState={{}}
      {...handlers}
    />
  );
  return handlers;
}

describe('ProviderCardsSection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    gatewayState.endpoints = [fireworks, emptyGw];
    gatewayState.credentials = [];
    gatewayState.upstreamModels = [fwModel];
  });

  it('does not pass every endpoint with accounts for an arbitrary query', () => {
    renderSection('zzz-no-such-thing');

    expect(screen.queryByTestId('provider-card-ep-fw')).toBeNull();
    expect(screen.queryByTestId('inactive-endpoint-ep-empty')).toBeNull();
  });

  it('matches endpoints by upstream model id', () => {
    renderSection('glm-5p2');

    expect(screen.getByTestId('provider-card-ep-fw')).toBeTruthy();
    expect(screen.queryByTestId('inactive-endpoint-ep-empty')).toBeNull();
  });

  it('matches endpoints by account name', () => {
    renderSection('main key');

    expect(screen.getByTestId('provider-card-ep-fw')).toBeTruthy();
  });

  it('matches endpoints by name', () => {
    renderSection('emptygw');

    expect(screen.queryByTestId('provider-card-ep-fw')).toBeNull();
    expect(screen.getByTestId('inactive-endpoint-ep-empty')).toBeTruthy();
  });

  it('groups endpoints without accounts and models into a collapsible card', () => {
    renderSection('');

    expect(screen.getByTestId('provider-card-ep-fw')).toBeTruthy();
    expect(screen.queryByTestId('provider-card-ep-empty')).toBeNull();

    const group = screen.getByTestId('inactive-endpoints');
    expect(group).toBeTruthy();
    expect(screen.getByText('aiGateway.cards.inactiveEndpoints')).toBeTruthy();
    expect(screen.getByTestId('inactive-endpoint-ep-empty')).toBeTruthy();
    expect(screen.getByText('aiGateway.cards.urlNotConfigured')).toBeTruthy();

    fireEvent.click(screen.getByText('aiGateway.cards.inactiveEndpoints'));
    expect(screen.queryByTestId('inactive-endpoint-ep-empty')).toBeNull();

    fireEvent.click(screen.getByText('aiGateway.cards.inactiveEndpoints'));
    expect(screen.getByTestId('inactive-endpoint-ep-empty')).toBeTruthy();
  });

  it('wires row actions inside the inactive group', async () => {
    renderSection('');

    const group = screen.getByTestId('inactive-endpoints');

    fireEvent.click(within(group).getByTitle('aiGateway.discoverModels'));
    await waitFor(() => {
      expect(discoverModelsForEndpoint).toHaveBeenCalledWith('ep-empty');
    });

    fireEvent.click(within(group).getByTitle('aiGateway.cards.editEndpoint'));
    expect(screen.getByTestId('endpoint-form')).toBeTruthy();

    fireEvent.click(within(group).getByTitle('aiGateway.cards.deleteEndpoint'));
    await waitFor(() => {
      expect(gatewayState.deleteEndpoint).toHaveBeenCalledWith('ep-empty');
    });
  });
});
