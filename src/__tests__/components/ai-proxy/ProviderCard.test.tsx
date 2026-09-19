// Mock/stub pattern follows CredentialsList.test.tsx (identity t, stubbed UI primitives).

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  ProviderCard,
  accountDisplayName,
  endpointStatusDot,
  modelChipLabel,
} from '@/components/ai-proxy/ProviderCard';
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
  Badge: ({ children, variant, ...rest }: any) => (
    <span data-variant={variant} {...rest}>
      {children}
    </span>
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

  it('renders short model chip labels with the full upstream id as tooltip', () => {
    const models = [makeModel('m1', 'accounts/fireworks/models/glm-5p2')];
    render(<ProviderCard endpoint={endpoint} accounts={[]} models={models} {...props} />);

    const chip = screen.getByText('glm-5p2');
    expect(chip.getAttribute('title')).toBe('accounts/fireworks/models/glm-5p2');
    expect(modelChipLabel(models[0])).toBe('glm-5p2');
    expect(modelChipLabel({ ...models[0], upstreamModelId: 'gpt-4o' })).toBe('gpt-4o');
  });

  it('prefers displayName for model chips', () => {
    const model: UpstreamModel = {
      ...makeModel('m1', 'accounts/x/models/y'),
      displayName: 'GLM 5',
    };
    render(<ProviderCard endpoint={endpoint} accounts={[]} models={[model]} {...props} />);

    expect(screen.getByText('GLM 5')).toBeTruthy();
    expect(screen.queryByText('y')).toBeNull();
  });

  it('maps legacy migration account names with the real name as tooltip', () => {
    const account = makeAccount(9, 'migrated from api_keys: gemini', 'gemini');
    render(<ProviderCard endpoint={endpoint} accounts={[account]} models={[]} {...props} />);

    expect(screen.queryByText('migrated from api_keys: gemini')).toBeNull();
    const rendered = screen.getByText('aiGateway.cards.legacyAccountName');
    expect(rendered.getAttribute('title')).toBe('migrated from api_keys: gemini');

    expect(accountDisplayName(account).title).toBe('migrated from api_keys: gemini');
    expect(accountDisplayName(makeAccount(10, 'Normal Name')).title).toBeUndefined();
    expect(accountDisplayName(makeAccount(10, 'Normal Name')).text).toBe('Normal Name');
  });

  it('shows a warning badge instead of a .invalid placeholder URL', () => {
    const placeholderEndpoint: ProviderEndpoint = {
      ...endpoint,
      baseUrl: 'https://llm.gateway.invalid/v1',
    };
    render(
      <ProviderCard endpoint={placeholderEndpoint} accounts={[]} models={[]} {...props} />
    );

    expect(screen.getByText('aiGateway.cards.urlNotConfigured')).toBeTruthy();
    expect(screen.queryByText('https://llm.gateway.invalid/v1')).toBeNull();
  });

  it('applies the four-state status dot semantics', () => {
    expect(endpointStatusDot({ ...endpoint, circuitState: 'open' }, 2).className).toContain(
      'bg-amber-400'
    );
    expect(endpointStatusDot({ ...endpoint, enabled: false }, 2).className).toContain(
      'bg-red-400'
    );
    expect(endpointStatusDot(endpoint, 2).className).toContain('bg-emerald-400');

    const hollow = endpointStatusDot(endpoint, 0);
    expect(hollow.className).toContain('ring-slate-500');
    expect(hollow.className).not.toContain('bg-emerald-400');
  });

  it('labels the hollow dot for an enabled endpoint without accounts', () => {
    render(<ProviderCard endpoint={endpoint} accounts={[]} models={[]} {...props} />);

    expect(screen.getByLabelText('aiGateway.cards.accountsEmpty')).toBeTruthy();
  });
});
