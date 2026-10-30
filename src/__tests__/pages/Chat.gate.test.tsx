import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Chat from '../../pages/Chat';
import * as aiProxyModule from '../../lib/backend/modules/aiProxy';
import * as aiGatewayModule from '../../lib/backend/modules/aiGateway';
import * as apiKeysModule from '../../lib/backend/modules/apiKeys';
import { fetchProxyStatusNow } from '../../stores/aiProxy';
import { useChatStore } from '../../stores/chat';

jest.mock('../../components/layout/Header', () => ({
  __esModule: true,
  default: ({ title, actions }: { title: string; actions?: React.ReactNode }) => (
    <div>
      <div>{title}</div>
      {actions}
    </div>
  ),
}));

jest.mock('../../lib/backend/modules/aiProxy', () => {
  const actual = jest.requireActual('../../lib/backend/modules/aiProxy') as object;
  return {
    ...actual,
    getAvailableModelsSafe: jest.fn(),
    getProxySettings: jest.fn(),
    startAiProxy: jest.fn(),
    getProviderCapabilities: jest.fn(),
    getProviderModelMappings: jest.fn(),
    getRequestHistorySafe: jest.fn(),
    getDailyStatsSafe: jest.fn(),
    getCostEstimateSafe: jest.fn(),
    getLocalChatToken: jest.fn(),
  };
});

jest.mock('../../stores/aiProxy', () => ({
  __esModule: true,
  fetchProxyStatusNow: jest.fn(),
}));

jest.mock('../../lib/backend/modules/aiGateway', () => ({
  __esModule: true,
  listCredentials: jest.fn(),
}));

jest.mock('../../lib/backend/modules/apiKeys', () => {
  const actual = jest.requireActual('../../lib/backend/modules/apiKeys') as object;
  return {
    ...actual,
    getGeminiApiKeys: jest.fn(),
    getOpenAIApiKeys: jest.fn(),
    getAntigravityApiKeys: jest.fn(),
    getZaiApiKeys: jest.fn(),
  };
});

const proxy = aiProxyModule as jest.Mocked<typeof aiProxyModule>;
const gateway = aiGatewayModule as jest.Mocked<typeof aiGatewayModule>;
const apiKeys = apiKeysModule as jest.Mocked<typeof apiKeysModule>;

const NO_PROVIDER_REASON = 'Set up providers or API keys in AI Proxy to enable debug chat.';
const PROXY_DOWN_REASON = 'AI Proxy is not running. Start it in Settings to enable debug chat.';

const gatewayCredential = {
  id: 'cred-1',
  providerEndpointId: 'ep-1',
  authType: 'api_key',
  fingerprint: 'fp-1',
  enabled: true,
  runtimeStatus: 'ok',
  consecutiveFailures: 0,
  createdAt: '2026-01-01T00:00:00Z',
};

function renderChat() {
  render(
    <MemoryRouter initialEntries={['/ai/chat']}>
      <Routes>
        <Route path="/ai/chat" element={<Chat />} />
      </Routes>
    </MemoryRouter>
  );
}

async function openSettings() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
  });
}

describe('Chat provider-setup gate', () => {
  it('shows the inspector for a failed request even when no assistant text was received', async () => {
    gateway.listCredentials.mockResolvedValue([gatewayCredential] as any);
    renderChat();
    let id = '';
    await act(async () => {
      id = useChatStore.getState().addMessage({ role: 'assistant', content: '', isStreaming: false });
      useChatStore.getState().setMessageDebug(id, {
        apiUrl: '/v1/chat/completions', startedAt: Date.now(), requestHeaders: {}, requestBody: {},
        responseStatus: 503, error: 'Fixture route failed',
      });
    });
    expect(await screen.findByRole('button', { name: /Inspector/ })).toBeTruthy();
    await act(async () => useChatStore.getState().removeMessage(id));
  });

  beforeEach(() => {
    jest.clearAllMocks();

    (fetchProxyStatusNow as jest.Mock).mockResolvedValue({
      running: true,
      port: 25583,
      uptimeSeconds: null,
      mode: 'full',
      managedByApp: true,
      networkReachable: true,
    });
    proxy.getProxySettings.mockResolvedValue({
      appMode: 'full',
      proxyPort: 25583,
      autoStart: false,
      routingStrategy: '',
      managementKey: '',
    } as any);
    proxy.getProviderCapabilities.mockResolvedValue([] as any);
    proxy.getProviderModelMappings.mockResolvedValue([] as any);
    proxy.getAvailableModelsSafe.mockResolvedValue([
      { id: 'gpt-4-turbo', provider: 'openai', ownedBy: 'openai', source: 'aiProxy' },
    ] as any);
    proxy.getRequestHistorySafe.mockResolvedValue([] as any);
    proxy.getDailyStatsSafe.mockResolvedValue(null as any);
    proxy.getCostEstimateSafe.mockResolvedValue(null as any);
    proxy.getLocalChatToken.mockResolvedValue('test-token' as any);
    apiKeys.getGeminiApiKeys.mockResolvedValue([] as any);
    apiKeys.getOpenAIApiKeys.mockResolvedValue([] as any);
    apiKeys.getAntigravityApiKeys.mockResolvedValue([] as any);
    apiKeys.getZaiApiKeys.mockResolvedValue([] as any);
  });

  it('reads the gate from gateway credentials, not legacy api_keys', async () => {
    gateway.listCredentials.mockResolvedValue([gatewayCredential] as any);

    renderChat();
    await openSettings();

    await waitFor(() => {
      expect(gateway.listCredentials).toHaveBeenCalledTimes(1);
    });
    expect(apiKeys.getGeminiApiKeys).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(screen.queryByText(PROXY_DOWN_REASON)).toBeNull();
    });
    expect(screen.queryByText(NO_PROVIDER_REASON)).toBeNull();
  });

  it('shows the no-provider block reason with zero credentials and zero accounts', async () => {
    gateway.listCredentials.mockResolvedValue([] as any);

    renderChat();
    await openSettings();

    expect(await screen.findByText(NO_PROVIDER_REASON)).toBeTruthy();
  });

  it('discovers models after the bridge starts without remounting the chat', async () => {
    gateway.listCredentials.mockResolvedValue([gatewayCredential] as any);
    proxy.getAvailableModelsSafe.mockResolvedValueOnce([]).mockResolvedValue([
      { id: 'velly/test/sonnet', name: 'Velly · Sonnet', provider: 'velly', ownedBy: 'velly', source: 'aiProxy' },
    ] as any);
    renderChat();
    await waitFor(() => expect(proxy.getAvailableModelsSafe).toHaveBeenCalledTimes(1));
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    expect(await screen.findByRole('button', { name: 'Velly · Sonnet • AI Proxy' })).toBeTruthy();
  });

  it('does not block Velly on the legacy proxy being stopped', async () => {
    gateway.listCredentials.mockResolvedValue([gatewayCredential] as any);
    (fetchProxyStatusNow as jest.Mock).mockResolvedValue({ running: false });
    proxy.getAvailableModelsSafe.mockResolvedValue([
      { id: 'velly/test/sonnet', name: 'Velly · Sonnet', provider: 'velly', ownedBy: 'velly', source: 'aiProxy', protocol: 'messages' },
    ] as any);
    renderChat();
    await openSettings();
    await screen.findByRole('button', { name: 'Velly · Sonnet • AI Proxy' });
    expect(screen.queryByText(PROXY_DOWN_REASON)).toBeNull();
    expect(screen.getByText('/v1/messages')).toBeTruthy();
    expect(screen.queryByText('AI Proxy not running (debug chat disabled)')).toBeNull();
  });
});
