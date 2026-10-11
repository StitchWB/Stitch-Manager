import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { useEffect } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

jest.mock('@/lib/i18n', () => ({
  t: (key: string, params?: Record<string, string | number>): string => {
    if (!params) return key;
    return Object.entries(params).reduce(
      (acc, [k, v]) => acc.replace(`{${k}}`, String(v)),
      key,
    );
  },
}));

jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));

jest.mock('@/components/api-keys/KeyList', () => ({ KeyList: () => null }));
jest.mock('@/components/api-keys/BulkAddDrawer', () => ({ BulkAddDrawer: () => null }));
jest.mock('@/components/api-keys/FilterBar', () => ({ FilterBar: () => null }));
jest.mock('@/components/ai-proxy/sections/FireworksCheckerSection', () => ({
  FireworksCheckerSection: () => null,
}));
jest.mock('@/components/ai-proxy/sections/FreeModelBridgeSection', () => ({
  FreeModelBridgeSection: () => null,
}));
jest.mock('@/components/ai-proxy/sections/CustomProvidersSection', () => ({
  CustomProvidersSection: () => null,
}));
jest.mock('@/hooks/useServicePlugins', () => ({
  useServicePlugins: () => [],
}));

const getAiProxyAccounts = jest.fn();
jest.mock('@/lib/backend/modules/aiProxy', () => ({
  getAiProxyAccounts: () => getAiProxyAccounts(),
}));

const getGeminiApiKeys = jest.fn();
const getOpenAIApiKeys = jest.fn();
const getAnthropicApiKeys = jest.fn();
const getAntigravityApiKeys = jest.fn();
const getZaiApiKeys = jest.fn();
jest.mock('@/lib/backend/modules/apiKeys', () => ({
  getGeminiApiKeys: () => getGeminiApiKeys(),
  getOpenAIApiKeys: () => getOpenAIApiKeys(),
  getAnthropicApiKeys: () => getAnthropicApiKeys(),
  getAntigravityApiKeys: () => getAntigravityApiKeys(),
  getZaiApiKeys: () => getZaiApiKeys(),
}));

jest.mock('@/lib/backend/modules/opencodeConfig', () => ({
  testOpenCodeApi: jest.fn(),
}));

jest.mock('@/components/ui', () => ({
  Button: ({ children, onClick, disabled }: any) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  ButtonBase: ({ children, ...rest }: any) => <button {...rest}>{children}</button>,
  GlassCard: ({ children, className }: any) => <div className={className}>{children}</div>,
  Input: ({ label, ...rest }: any) => <input aria-label={label} {...rest} />,
  MetricStrip: () => null,
  Modal: () => null,
  ProviderLogo: ({ provider }: any) => <span data-provider={provider} />,
}));

import { AiProvidersKeysSection } from '@/components/ai-proxy/sections/AiProvidersKeysSection';

let navigatedSearch = '';

function LocationSpy() {
  const loc = useLocation();
  useEffect(() => {
    navigatedSearch = loc.search;
  }, [loc.search]);
  return null;
}

function renderSection(providerFilter = 'all') {
  render(
    <MemoryRouter initialEntries={['/ai/providers']}>
      <LocationSpy />
      <AiProvidersKeysSection providerFilter={providerFilter} />
    </MemoryRouter>
  );
}

function makeAccount(id: number, provider: string) {
  return {
    id,
    provider,
    name: `${provider}-${id}`,
    oauthToken: null,
    apiKey: 'sk-test',
    sessionToken: null,
    enabled: true,
    accountType: null,
    requestsToday: 0,
    requestsTotal: 0,
    tokensUsed: 0,
    lastUsedAt: null,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('AiProvidersKeysSection overview (providerFilter=all)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    navigatedSearch = '';
    getAiProxyAccounts.mockResolvedValue([
      makeAccount(1, 'openai'),
      makeAccount(2, 'openai'),
      makeAccount(3, 'anthropic'),
    ]);
    getGeminiApiKeys.mockResolvedValue([{ apiKey: 'AIza-1' }]);
    getOpenAIApiKeys.mockResolvedValue([]);
    getAnthropicApiKeys.mockResolvedValue([]);
    getAntigravityApiKeys.mockResolvedValue([]);
    getZaiApiKeys.mockResolvedValue([]);
  });

  it('renders one row per provider with accounts or shared keys', async () => {
    renderSection();

    await waitFor(() => {
      expect(screen.getByTestId('keys-overview-row-openai')).toBeTruthy();
    });
    expect(screen.getByTestId('keys-overview-row-anthropic')).toBeTruthy();
    expect(screen.getByTestId('keys-overview-row-gemini')).toBeTruthy();
    expect(screen.queryByTestId('keys-overview-row-zai')).toBeNull();

    const openaiRow = screen.getByTestId('keys-overview-row-openai');
    expect(openaiRow.textContent).toContain('aiHub.keysOverview.accounts: 2');
    expect(openaiRow.textContent).toContain('aiHub.keysOverview.keys: 0');
    const geminiRow = screen.getByTestId('keys-overview-row-gemini');
    expect(geminiRow.textContent).toContain('aiHub.keysOverview.keys: 1');
  });

  it('shows the empty state when nothing is configured', async () => {
    getAiProxyAccounts.mockResolvedValue([]);
    getGeminiApiKeys.mockResolvedValue([]);
    renderSection();

    await waitFor(() => {
      expect(screen.getByText('aiHub.keysOverview.empty')).toBeTruthy();
    });
  });

  it('sets ?provider= when a row is clicked', async () => {
    renderSection();

    const row = await screen.findByTestId('keys-overview-row-gemini');
    fireEvent.click(row);
    await waitFor(() => {
      expect(navigatedSearch).toBe('?provider=gemini');
    });
  });
});
