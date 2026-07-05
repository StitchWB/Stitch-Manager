import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AiProviders from '../../pages/AiProviders';
import * as aiProxyModule from '../../lib/tauri/modules/aiProxy';

jest.mock('../../components/layout/Header', () => ({
  __esModule: true,
  default: ({ title }: { title: string }) => <div>{title}</div>,
}));

// Mock the entire aiProxy module so const-exports (fetchAllQuotasSafe etc.)
// can be replaced — jest.spyOn cannot redefine non-configurable properties.
jest.mock('../../lib/tauri/modules/aiProxy', () => {
  const actual = jest.requireActual('../../lib/tauri/modules/aiProxy') as object;
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

const proxy = aiProxyModule as jest.Mocked<typeof aiProxyModule>;

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

describe('AiProviders page', () => {
  beforeEach(() => {
    jest.clearAllMocks();

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

    // Default section is 'providers' — shows the accounts table.
    render(
      <MemoryRouter initialEntries={['/ai/providers']}>
        <Routes>
          <Route path="/ai/:section?" element={<AiProviders />} />
        </Routes>
      </MemoryRouter>
    );

    // Wait for the account name to appear (async load).
    await screen.findByText('OpenAI Main');

    // Click the Test connection button in the row.
    const testButton = screen.getByTitle('Test connection');
    await user.click(testButton);

    await waitFor(() => {
      expect(proxy.testProviderConnection).toHaveBeenCalledWith('openai');
    });
  });

  it('saves model mappings on routing section', async () => {
    const user = userEvent.setup();

    // Navigate straight to the routing section where MappingsEditor lives.
    render(
      <MemoryRouter initialEntries={['/ai/routing']}>
        <Routes>
          <Route path="/ai/:section?" element={<AiProviders />} />
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
});
