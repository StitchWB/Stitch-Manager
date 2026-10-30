import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

if (!('scrollIntoView' in HTMLElement.prototype)) {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    writable: true,
    value: jest.fn(),
  });
}

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
  toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

jest.mock('@/lib/backend/modules/opencodeConfig', () => ({
  bulkTestOpenCodeApi: jest.fn(),
}));

const mockCreateEndpoint = jest.fn();
const mockCreateCredential = jest.fn();
const mockFetchEndpoints = jest.fn();
const mockEndpoints: ProviderEndpoint[] = [];

jest.mock('@/stores/aiGateway', () => ({
  useAiGatewayStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      endpoints: mockEndpoints,
      createEndpoint: mockCreateEndpoint,
      createCredential: mockCreateCredential,
      fetchEndpoints: mockFetchEndpoints,
    }),
}));

import { PasteKeysDialog } from '@/components/ai-hub/providers/PasteKeysDialog';
import type { ProviderEndpoint } from '@/lib/backend/modules/aiGateway';

const createdEndpoint = {
  id: 'ep-new',
  name: 'OpenAI',
  adapterType: 'openai_compatible',
  baseUrl: 'https://api.openai.com/v1',
  enabled: true,
  circuitState: 'closed',
  createdAt: '2026-01-01T00:00:00Z',
} satisfies ProviderEndpoint;

function renderDialog(props?: {
  endpoint?: ProviderEndpoint | null;
  onClose?: () => void;
  onAdded?: (endpointId: string) => void;
}) {
  return render(
    <PasteKeysDialog
      open
      endpoint={props?.endpoint ?? null}
      onClose={props?.onClose ?? jest.fn()}
      onAdded={props?.onAdded}
    />
  );
}

async function selectPreset(user: ReturnType<typeof userEvent.setup>, label: string) {
  const combos = screen.getAllByRole('combobox');
  await user.click(combos[0]);
  await user.click(await screen.findByRole('option', { name: label }));
}

describe('PasteKeysDialog provider preset picker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateEndpoint.mockResolvedValue(createdEndpoint);
    mockCreateCredential.mockResolvedValue({ id: 'cred-new' });
    mockFetchEndpoints.mockResolvedValue(undefined);
  });

  it('prefills name, base URL and protocol when a preset is selected', async () => {
    const user = userEvent.setup();
    renderDialog();

    await selectPreset(user, 'OpenAI');

    const baseUrlInput = screen.getByLabelText('aiHub.providersPage.baseUrlLabel') as HTMLInputElement;
    const nameInput = screen.getByLabelText('aiHub.providersPage.nameLabel') as HTMLInputElement;
    expect(baseUrlInput.value).toBe('https://api.openai.com/v1');
    expect(nameInput.value).toBe('OpenAI');
    expect(screen.getAllByRole('combobox')[1].textContent).toContain('aiGateway.form.optOpenai');
  });

  it('clears prefilled fields when the custom preset is selected', async () => {
    const user = userEvent.setup();
    renderDialog();

    await selectPreset(user, 'OpenAI');
    await selectPreset(user, 'aiHub.pasteFirst.providerPresetOther');

    const baseUrlInput = screen.getByLabelText('aiHub.providersPage.baseUrlLabel') as HTMLInputElement;
    expect(baseUrlInput.value).toBe('');
  });

  it('calls onAdded with the created endpoint id after a successful add', async () => {
    const user = userEvent.setup();
    const onAdded = jest.fn();
    const onClose = jest.fn();
    renderDialog({ onClose, onAdded });

    await selectPreset(user, 'OpenAI');
    await user.type(screen.getByPlaceholderText('aiHub.pasteFirst.emptyHint'), 'sk-test-key-123');
    await user.click(screen.getByRole('button', { name: 'aiHub.pasteFirst.add' }));

    await waitFor(() => expect(onAdded).toHaveBeenCalledWith('ep-new'));
    expect(mockCreateEndpoint).toHaveBeenCalledWith({
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      adapterType: 'openai_compatible',
      enabled: true,
    });
    expect(mockCreateCredential).toHaveBeenCalledWith({
      providerEndpointId: 'ep-new',
      authType: 'api_key',
      secret: 'sk-test-key-123',
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onAdded with the existing endpoint id when adding keys to a provider', async () => {
    const user = userEvent.setup();
    const onAdded = jest.fn();
    renderDialog({ endpoint: createdEndpoint, onAdded });

    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    await user.type(screen.getByPlaceholderText('aiHub.pasteFirst.emptyHint'), 'sk-existing-456');
    await user.click(screen.getByRole('button', { name: 'aiHub.pasteFirst.add' }));

    await waitFor(() => expect(onAdded).toHaveBeenCalledWith('ep-new'));
    expect(mockCreateEndpoint).not.toHaveBeenCalled();
  });

  it('shows the model discovery hint', () => {
    renderDialog();
    expect(screen.getByText('aiHub.pasteFirst.modelsHint')).toBeTruthy();
  });
});

const MULTI_PROVIDER_PASTE = `🌐 Base URL: https://api.groq.com/openai/v1

🔑 Ключ: gsk_111111111111111111111111
🌐 Base URL: https://apihub.agnes-ai.com/v1

🔑 Ключ: sk-222222222222222222222222
🌐 Base URL: https://api.groq.com/openai/v1

🔑 Ключ: gsk_333333333333333333333333`;

describe('PasteKeysDialog multi-provider batch paste', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEndpoints.length = 0;
    mockCreateCredential.mockResolvedValue({ id: 'cred-new' });
    mockFetchEndpoints.mockResolvedValue(undefined);
    mockCreateEndpoint.mockImplementation(async (params: { name: string; baseUrl: string; adapterType: string }) => ({
      id: `ep-batch-${mockCreateEndpoint.mock.calls.length}`,
      name: params.name,
      adapterType: params.adapterType,
      baseUrl: params.baseUrl,
      enabled: true,
      circuitState: 'closed',
      createdAt: '2026-01-01T00:00:00Z',
    }));
  });

  it('groups a multi-provider paste by base URL and creates endpoints with all keys', async () => {
    const user = userEvent.setup();
    await navigator.clipboard.writeText(MULTI_PROVIDER_PASTE);
    const onAdded = jest.fn();
    const onClose = jest.fn();
    renderDialog({ onClose, onAdded });

    await user.click(screen.getByRole('button', { name: 'aiHub.pasteFirst.fromClipboard' }));

    expect(await screen.findByText('aiHub.pasteFirst.batchTitle')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'aiHub.pasteFirst.batchAddAll' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mockCreateEndpoint).toHaveBeenCalledTimes(2);
    expect(mockCreateEndpoint).toHaveBeenNthCalledWith(1, {
      name: 'Groq',
      baseUrl: 'https://api.groq.com/openai/v1',
      adapterType: 'openai_compatible',
      enabled: true,
    });
    expect(mockCreateEndpoint).toHaveBeenNthCalledWith(2, {
      name: 'apihub.agnes-ai.com',
      baseUrl: 'https://apihub.agnes-ai.com/v1',
      adapterType: 'openai_compatible',
      enabled: true,
    });
    expect(mockCreateCredential.mock.calls).toEqual([
      [{ providerEndpointId: 'ep-batch-1', authType: 'api_key', secret: 'gsk_111111111111111111111111' }],
      [{ providerEndpointId: 'ep-batch-1', authType: 'api_key', secret: 'gsk_333333333333333333333333' }],
      [{ providerEndpointId: 'ep-batch-2', authType: 'api_key', secret: 'sk-222222222222222222222222' }],
    ]);
    expect(mockFetchEndpoints).toHaveBeenCalledTimes(1);
    expect(onAdded).not.toHaveBeenCalled();
  });

  it('reuses an existing endpoint with the same base URL instead of creating a duplicate', async () => {
    const user = userEvent.setup();
    await navigator.clipboard.writeText(MULTI_PROVIDER_PASTE);
    mockEndpoints.push({ ...createdEndpoint, id: 'ep-existing', name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1' });
    const onClose = jest.fn();
    renderDialog({ onClose });

    await user.click(screen.getByRole('button', { name: 'aiHub.pasteFirst.fromClipboard' }));
    await user.click(await screen.findByRole('button', { name: 'aiHub.pasteFirst.batchAddAll' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mockCreateEndpoint).toHaveBeenCalledTimes(1);
    expect(mockCreateCredential.mock.calls.map(call => call[0].providerEndpointId)).toEqual([
      'ep-existing',
      'ep-existing',
      'ep-batch-1',
    ]);
  });

  it('returns to the manual single-provider form from batch mode', async () => {
    const user = userEvent.setup();
    await navigator.clipboard.writeText(MULTI_PROVIDER_PASTE);
    renderDialog();

    await user.click(screen.getByRole('button', { name: 'aiHub.pasteFirst.fromClipboard' }));
    expect(await screen.findByText('aiHub.pasteFirst.batchTitle')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'aiHub.pasteFirst.batchBack' }));

    expect(screen.getByText('aiHub.pasteFirst.providerPresetLabel')).toBeTruthy();
    expect(screen.queryByText('aiHub.pasteFirst.batchTitle')).toBeNull();
  });

  it('prefills the single form from a one-provider paste', async () => {
    const user = userEvent.setup();
    await navigator.clipboard.writeText(
      '🌐 Base URL: https://api.groq.com/openai/v1\n\n🔑 Ключ: gsk_444444444444444444444444',
    );
    renderDialog();

    await user.click(screen.getByRole('button', { name: 'aiHub.pasteFirst.fromClipboard' }));

    await waitFor(() => {
      expect(
        (screen.getByLabelText('aiHub.providersPage.baseUrlLabel') as HTMLInputElement).value,
      ).toBe('https://api.groq.com/openai/v1');
      expect(
        (screen.getByLabelText('aiHub.providersPage.nameLabel') as HTMLInputElement).value,
      ).toBe('Groq');
      expect(
        (screen.getByPlaceholderText('aiHub.pasteFirst.emptyHint') as HTMLTextAreaElement).value,
      ).toBe('gsk_444444444444444444444444');
    });
  });
});

const CHECK_REPORT_PASTE = `[29.10.2026 8:13] X: 📊 Отчёт: 10
DASHSCOPE (отвечают): 8 · балансовых: 2 · Σ $98.35
ANTICAPTCHA $91.80 WORKING
0f1e2d3c4b5a697886756454342415141
DASHSCOPE WORKING
sk-11111111111111111111111111111111
sk-ws-AAAA.BBBB.CCCC.DDDD.EEEE.FFFF
TWOCAPTCHA $6.55 WORKING
1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7
🔑 Чек API — deepseek
sk-22222222222222222222222222222222
· Провайдер: deepseek
Основной эндпоинт:
✅ ·
https://api.deepseek.com
✅ чат работает · 3 проб · api.deepseek.com
✅ deepseek-v4-pro — 200 · 1.8с`;

const DEEPSEEK_REPORT_PASTE = `🔑 Чек API — deepseek
sk-33333333333333333333333333333333
· Провайдер: deepseek
Основной эндпоинт:
✅ ·
https://api.deepseek.com
✅ чат работает · 3 проб · api.deepseek.com`;

const KEYLESS_REPORT_PASTE = `[29.10.2026 8:13] X: 📊 Отчёт: 10
DASHSCOPE (отвечают): 8 · балансовых: 2 · Σ $98.35
ANTICAPTCHA $91.80 WORKING
DASHSCOPE WORKING
TWOCAPTCHA $6.55 WORKING
🔑 Чек API — deepseek
· Провайдер: deepseek
Основной эндпоинт:
✅ ·
https://api.deepseek.com
✅ чат работает · 3 проб · api.deepseek.com
✅ deepseek-v4-pro — 200 · 1.8с`;

describe('PasteKeysDialog check-report paste', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEndpoints.length = 0;
    mockCreateCredential.mockResolvedValue({ id: 'cred-new' });
    mockFetchEndpoints.mockResolvedValue(undefined);
    mockCreateEndpoint.mockImplementation(async (params: { name: string; baseUrl: string; adapterType: string }) => ({
      id: `ep-report-${mockCreateEndpoint.mock.calls.length}`,
      name: params.name,
      adapterType: params.adapterType,
      baseUrl: params.baseUrl,
      enabled: true,
      circuitState: 'closed',
      createdAt: '2026-01-01T00:00:00Z',
    }));
  });

  it('imports a check-report blob as provider groups without captcha services', async () => {
    const user = userEvent.setup();
    await navigator.clipboard.writeText(CHECK_REPORT_PASTE);
    const onClose = jest.fn();
    renderDialog({ onClose });

    await user.click(screen.getByRole('button', { name: 'aiHub.pasteFirst.fromClipboard' }));

    expect(await screen.findByText('aiHub.pasteFirst.batchTitle')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'aiHub.pasteFirst.batchAddAll' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mockCreateEndpoint).toHaveBeenCalledTimes(2);
    expect(mockCreateEndpoint).toHaveBeenNthCalledWith(1, {
      name: 'dashscope.aliyuncs.com',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      adapterType: 'openai_compatible',
      enabled: true,
    });
    expect(mockCreateEndpoint).toHaveBeenNthCalledWith(2, {
      name: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com/v1',
      adapterType: 'openai_compatible',
      enabled: true,
    });
    expect(mockCreateCredential).toHaveBeenCalledTimes(3);
    expect(mockCreateCredential.mock.calls.map(call => call[0].secret)).toEqual([
      'sk-11111111111111111111111111111111',
      'sk-ws-AAAA.BBBB.CCCC.DDDD.EEEE.FFFF',
      'sk-22222222222222222222222222222222',
    ]);
  });

  it('prefills the DeepSeek preset when a single-provider report is pasted into the textarea', async () => {
    const user = userEvent.setup();
    renderDialog();

    const textarea = screen.getByPlaceholderText('aiHub.pasteFirst.emptyHint');
    await user.click(textarea);
    await user.paste(DEEPSEEK_REPORT_PASTE);

    expect(
      (screen.getByLabelText('aiHub.providersPage.nameLabel') as HTMLInputElement).value,
    ).toBe('DeepSeek');
    expect(
      (screen.getByLabelText('aiHub.providersPage.baseUrlLabel') as HTMLInputElement).value,
    ).toBe('https://api.deepseek.com/v1');
    expect((textarea as HTMLTextAreaElement).value).toBe('sk-33333333333333333333333333333333');
  });

  it('keeps a keyless report paste as raw text without key rows', async () => {
    const user = userEvent.setup();
    renderDialog();

    const textarea = screen.getByPlaceholderText('aiHub.pasteFirst.emptyHint');
    await user.click(textarea);
    await user.paste(KEYLESS_REPORT_PASTE);

    expect((textarea as HTMLTextAreaElement).value).toBe(KEYLESS_REPORT_PASTE);
    expect(screen.queryByText(/aiHub\.providersPage\.keysShort/)).toBeNull();
    expect(screen.getByRole('button', { name: 'aiHub.pasteFirst.add' })).toBeDisabled();
  });
});
