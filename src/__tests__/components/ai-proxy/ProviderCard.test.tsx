// Mock/stub pattern follows CredentialsList.test.tsx (identity t, stubbed UI primitives).

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProviderCard } from '@/components/ai-proxy/ProviderCard';
import type { ProviderEndpoint, UpstreamModel } from '@/lib/backend/modules/aiGateway';
import type { AiProxyAccount } from '@/types/generated';

jest.mock('@/lib/i18n', () => ({
  t: (key: string, params?: Record<string, string | number>): string => {
    if (!params) return key;
    return Object.entries(params).reduce(
      (acc, [k, v]) => acc.replace(`{${k}}`, String(v)),
      key,
    );
  },
}));

jest.mock('@/components/ui', () => ({
  GlassCard: ({ children, className }: any) => (
    <div className={className}>{children}</div>
  ),
  Badge: ({ children, variant }: any) => <span data-variant={variant}>{children}</span>,
  ButtonBase: ({ children, ...rest }: any) => <button {...rest}>{children}</button>,
  ConfirmActionButton: ({ children, onConfirm, title, disabled }: any) => (
    <button title={title} disabled={disabled} onClick={onConfirm}>
      {children}
    </button>
  ),
  ProviderLogo: ({ provider }: any) => <span data-provider={provider} />,
  StatusBadge: ({ status }: any) => <span data-testid="status-badge" data-status={status} />,
}));

const endpoint: ProviderEndpoint = {
  id: 'ep-openai',
  name: 'OpenAI',
  adapterType: 'openai_compatible',
  baseUrl: 'https://api.openai.com/v1',
  enabled: true,
  circuitState: 'closed',
  createdAt: '2026-01-01T00:00:00Z',
};

function makeAccount(id: number, name: string, provider = 'openai'): AiProxyAccount {
  return {
    id,
    provider,
    name,
    oauthToken: null,
    apiKey: 'sk-test',
    sessionToken: null,
    enabled: true,
    accountType: null,
    requestsToday: 7,
    requestsTotal: 42,
    tokensUsed: 1337,
    lastUsedAt: null,
    createdAt: 0,
    updatedAt: 0,
  } as AiProxyAccount;
}

function makeModel(id: string, upstreamModelId: string, enabled = true): UpstreamModel {
  return {
    id,
    providerEndpointId: endpoint.id,
    upstreamModelId,
    displayName: null,
    enabled,
    discoverySource: 'manual',
    createdAt: '2026-01-01T00:00:00Z',
  };
}

describe('ProviderCard', () => {
  let props: any;

  beforeEach(() => {
    jest.clearAllMocks();
    props = {
      connectionState: {},
      onAccountClick: jest.fn(),
      onEditAccount: jest.fn(),
      onDeleteAccount: jest.fn(),
      onTestConnection: jest.fn(),
      onEditEndpoint: jest.fn(),
      onDeleteEndpoint: jest.fn(),
      onDiscoverModels: jest.fn(),
    };
  });

  it('renders endpoint header, account rows and model chips', () => {
    const accounts = [makeAccount(1, 'OpenAI Main'), makeAccount(2, 'OpenAI Backup')];
    const models = [makeModel('m1', 'gpt-4o'), makeModel('m2', 'gpt-4o-mini', false)];

    render(
      <ProviderCard endpoint={endpoint} accounts={accounts} models={models} {...props} />
    );

    expect(screen.getByTestId('provider-card-ep-openai')).toBeTruthy();
    expect(screen.getByText('OpenAI')).toBeTruthy();
    expect(screen.getByText('openai_compatible')).toBeTruthy();
    expect(screen.getByText('https://api.openai.com/v1')).toBeTruthy();

    expect(screen.getByText('OpenAI Main')).toBeTruthy();
    expect(screen.getByText('OpenAI Backup')).toBeTruthy();
    // Usage stats line (requests/tokens) — identity t renders the key.
    expect(screen.getAllByText('aiHub.table.requestsLine').length).toBe(2);
    expect(screen.getAllByTestId('status-badge').length).toBe(2);

    // Only the enabled model renders as a chip; count reflects enabled models.
    expect(screen.getByText('gpt-4o')).toBeTruthy();
    expect(screen.queryByText('gpt-4o-mini')).toBeNull();
    expect(screen.getByText('aiGateway.cards.modelsCount')).toBeTruthy();
  });

  it('expands the model list beyond the chip limit', () => {
    const models = Array.from({ length: 14 }, (_, i) => makeModel(`m${i}`, `model-${i}`));

    render(<ProviderCard endpoint={endpoint} accounts={[]} models={models} {...props} />);

    expect(screen.queryByText('model-13')).toBeNull();
    fireEvent.click(screen.getByText('aiGateway.cards.showAllModels'));
    expect(screen.getByText('model-13')).toBeTruthy();
    fireEvent.click(screen.getByText('aiGateway.cards.hideModels'));
    expect(screen.queryByText('model-13')).toBeNull();
  });

  it('shows the not-linked hint when the credential has no endpoint', () => {
    render(
      <ProviderCard
        endpoint={null}
        accounts={[makeAccount(3, 'Orphan Account', 'anthropic')]}
        models={[]}
        {...props}
      />
    );

    expect(screen.getByTestId('provider-card-unlinked')).toBeTruthy();
    expect(screen.getByText('aiGateway.cards.unlinkedTitle')).toBeTruthy();
    expect(screen.getByText('aiGateway.accountPanel.noLinkDesc')).toBeTruthy();
    expect(screen.getByText('Orphan Account')).toBeTruthy();
  });

  it('fires row actions and opens the drawer on row click', () => {
    const account = makeAccount(4, 'Clickable');

    render(
      <ProviderCard endpoint={endpoint} accounts={[account]} models={[]} {...props} />
    );

    fireEvent.click(screen.getByTitle('aiHub.table.testConnection'));
    expect(props.onTestConnection).toHaveBeenCalledWith(account);

    fireEvent.click(screen.getByTitle('aiHub.table.edit'));
    expect(props.onEditAccount).toHaveBeenCalledWith(account);

    fireEvent.click(screen.getByTitle('aiHub.table.delete'));
    expect(props.onDeleteAccount).toHaveBeenCalledWith(4);

    fireEvent.click(screen.getByLabelText('Clickable'));
    expect(props.onAccountClick).toHaveBeenCalledWith(account);
  });

  it('fires endpoint actions from the card header', () => {
    render(<ProviderCard endpoint={endpoint} accounts={[]} models={[]} {...props} />);

    fireEvent.click(screen.getByTitle('aiGateway.discoverModels'));
    expect(props.onDiscoverModels).toHaveBeenCalledWith(endpoint);

    fireEvent.click(screen.getByTitle('aiGateway.cards.editEndpoint'));
    expect(props.onEditEndpoint).toHaveBeenCalledWith(endpoint);

    fireEvent.click(screen.getByTitle('aiGateway.cards.deleteEndpoint'));
    expect(props.onDeleteEndpoint).toHaveBeenCalledWith(endpoint);
  });
});
