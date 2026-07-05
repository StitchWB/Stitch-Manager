import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import AiProviders from '../../pages/AiProviders';
import * as aiProxyModule from '../../lib/tauri/modules/aiProxy';

jest.mock('../../components/layout/Header', () => ({
  __esModule: true,
  default: ({ title }: { title: string }) => <div>{title}</div>,
}));

// fetchKiroAccountQuotasSafe invokes a real Tauri command; stub it so the
// page does not error in Jest where fetch/IPC is unavailable.
jest.mock('../../lib/tauri/modules/aiProxy', () => {
  const actual = jest.requireActual('../../lib/tauri/modules/aiProxy') as object;
  return {
    ...actual,
    fetchKiroAccountQuotasSafe: jest.fn(async () => []),
    getAiProxyAccounts: jest.fn(),
    getAvailableModelsSafe: jest.fn(),
    getProviderCapabilities: jest.fn(),
    getProviderModelMappings: jest.fn(),
    getRequestHistory: jest.fn(),
    testProviderConnection: jest.fn(),
    setProviderModelMappings: jest.fn(),
  };
});

jest.mock('../../components/ai-proxy/AccountModal', () => ({
  __esModule: true,
  default: () => null,
}));

// QuotaDashboard was removed from the codebase; mark virtual so Jest does not
// try to resolve it on disk.
jest.mock(
  '../../components/ai-proxy/QuotaDashboard',
  () => ({ QuotaDashboard: () => null }),
  { virtual: true },
);

describe('AiProviders page', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    jest.spyOn(aiProxyModule, 'getAiProxyAccounts').mockResolvedValue([
      {
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
      },
    ] as any);

    jest
      .spyOn(aiProxyModule, 'getAvailableModelsSafe')
      .mockResolvedValue([{ id: 'gpt-4-turbo', provider: 'openai', ownedBy: 'openai' } as any]);

    jest.spyOn(aiProxyModule, 'getProviderCapabilities').mockResolvedValue([
      {
        provider: 'openai',
        supportsApiKeys: true,
        supportsOauth: true,
        totalAccounts: 1,
        enabledAccounts: 1,
        totalApiKeys: 1,
        configured: true,
      },
    ]);

    jest
      .spyOn(aiProxyModule, 'getProviderModelMappings')
      .mockResolvedValue([{ modelPattern: '^gpt-', provider: 'openai', modelId: 'gpt-4-turbo' }]);

    jest.spyOn(aiProxyModule, 'getRequestHistory').mockResolvedValue([] as any);
    jest.spyOn(aiProxyModule as any, 'fetchAllQuotasSafe').mockResolvedValue([]);
    jest.spyOn(aiProxyModule as any, 'fetchAllQuotas').mockResolvedValue([]);
    jest.spyOn(aiProxyModule as any, 'fetchOpenAiAccountQuotasSafe').mockResolvedValue([]);
    jest.spyOn(aiProxyModule as any, 'fetchOpenAiAccountQuotas').mockResolvedValue([]);
    jest.spyOn(aiProxyModule as any, 'fetchKiroAccountQuotasSafe').mockResolvedValue([]);
    jest.spyOn(aiProxyModule as any, 'fetchKiroAccountQuotas').mockResolvedValue([]);
    jest.spyOn(aiProxyModule, 'testProviderConnection').mockResolvedValue({
      success: true,
      provider: 'openai',
      modelId: null,
      message: 'ok',
    });
  });

  it('loads models and capabilities and supports connection test', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <AiProviders />
      </MemoryRouter>
    );

    // 'AI Providers' is a hardcoded string in the Header mock we render above.
    // The t() stub returns the last key segment, so 'aiHub.models.modelInventoryTitle'
    // → 'modelInventoryTitle'. Use a regex to match either form.
    await screen.findByText('AI Providers');
    await screen.findByText(/modelInventoryTitle|Available Models/i);
    expect(screen.getByText('gpt-4-turbo')).toBeTruthy();

    const testButton = screen.getByTitle('Test connection');
    await user.click(testButton);

    await waitFor(() => {
      expect(aiProxyModule.testProviderConnection).toHaveBeenCalledWith('openai');
    });
  });

  it('opens mappings modal and saves mappings', async () => {
    const user = userEvent.setup();
    const saveSpy = jest
      .spyOn(aiProxyModule, 'setProviderModelMappings')
      .mockResolvedValue(undefined);

    render(
      <MemoryRouter>
        <AiProviders />
      </MemoryRouter>
    );

    await screen.findByText('AI Providers');
    // The t() stub returns last key segment; match either the translated English
    // string or the key segment 'integrations' / 'eyebrow'.
    await user.click(screen.getByRole('button', { name: /integrations|eyebrow/i }));
    await user.click(screen.getByRole('button', { name: /edit mappings|editMappings/i }));

    await screen.findByText('Provider Model Mappings');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(saveSpy).toHaveBeenCalled();
    });
  });
});
