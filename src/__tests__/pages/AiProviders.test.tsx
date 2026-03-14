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

jest.mock('../../components/ai-proxy/AccountModal', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('../../components/ai-proxy/QuotaDashboard', () => ({
  QuotaDashboard: () => <div>QuotaDashboard</div>,
}));

describe('AiProviders page', () => {
  beforeEach(() => {
    jest.restoreAllMocks();

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

    await screen.findByText('AI Providers');
    await screen.findByText('Available Models');
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
    await user.click(screen.getByRole('button', { name: 'Integrations' }));
    await user.click(screen.getByRole('button', { name: 'Edit mappings' }));

    await screen.findByText('Provider Model Mappings');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(saveSpy).toHaveBeenCalled();
    });
  });
});
