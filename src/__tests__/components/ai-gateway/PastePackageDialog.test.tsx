/**
 * PastePackageDialog smoke test: open dialog, paste the provider blob,
 * preview shows parsed values; confirm creates endpoints/credential/models
 * through the store bindings. Garbage input shows the "nothing recognized"
 * state and disables confirm.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

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

jest.mock('@/components/ui', () => ({
  Button: ({ children, onClick, disabled }: any) => (
    <button onClick={onClick} disabled={disabled}>{children}</button>
  ),
  Input: (props: any) => <input {...props} />,
  Select: ({ children, value, onChange }: any) => (
    <select value={value} onChange={onChange}>{children}</select>
  ),
  Textarea: ({ label, placeholder, value, onChange, className }: any) => (
    <textarea
      aria-label={label}
      placeholder={placeholder}
      value={value}
      onChange={onChange}
      className={className}
    />
  ),
  Modal: ({ children, isOpen, footer, title }: any) =>
    isOpen ? (
      <div>
        <div>{title}</div>
        {children}
        {footer}
      </div>
    ) : null,
}));

const gatewayState: any = {
  createEndpoint: jest.fn(async (params: any) => ({ id: `ep-${params.name}`, ...params })),
  createCredential: jest.fn(async (params: any) => ({ id: `cred-${params.providerEndpointId}`, ...params })),
  createUpstreamModel: jest.fn(async (params: any) => ({ id: `um-${params.upstreamModelId}`, ...params })),
};

jest.mock('@/stores/aiGateway', () => ({
  useAiGatewayStore: () => gatewayState,
}));

import { PastePackageDialog } from '@/components/ai-gateway/PastePackageDialog';

const BLOB = [
  'Ключ: sk-8rYKLLlExIrwKMR166zMCKpIQsp3wBlBaQMJ0LujlvNtIU7S',
  'Base:',
  ' https://api.ikhdev.xyz/v1   (для OpenAI-формата)',
  ' https://api.ikhdev.xyz       (для Claude/Anthropic-формата, без /v1!)',
  'Модели: glm-5.3, glm-5.2, deepseek-v4-pro, deepseek-v4-flash, kimi-k3, qwen3.8-max',
].join('\n');

const KEY = 'sk-8rYKLLlExIrwKMR166zMCKpIQsp3wBlBaQMJ0LujlvNtIU7S';

beforeEach(() => {
  jest.clearAllMocks();
});

function pasteBlob() {
  const textarea = screen.getByPlaceholderText('aiGateway.paste.textareaPlaceholder');
  fireEvent.change(textarea, { target: { value: BLOB } });
}

describe('PastePackageDialog', () => {
  it('renders nothing when closed', () => {
    render(<PastePackageDialog open={false} onClose={jest.fn()} />);
    expect(screen.queryByPlaceholderText('aiGateway.paste.textareaPlaceholder')).toBeNull();
  });

  it('shows parsed preview after pasting the blob', async () => {
    render(<PastePackageDialog open onClose={jest.fn()} />);
    pasteBlob();

    await waitFor(() => {
      expect(screen.getByText('aiGateway.paste.previewTitle')).toBeTruthy();
    });

    // Two endpoint cards with suggested names and bases.
    expect(screen.getByDisplayValue('ikhdev.xyz (OpenAI)')).toBeTruthy();
    expect(screen.getByDisplayValue('ikhdev.xyz (Anthropic)')).toBeTruthy();
    expect(screen.getByDisplayValue('https://api.ikhdev.xyz/v1')).toBeTruthy();
    expect(screen.getByDisplayValue('https://api.ikhdev.xyz')).toBeTruthy();

    // Adapters detected: one openai_compatible select, one anthropic select.
    const selects = screen.getAllByDisplayValue(/^(aiGateway\.form\.optOpenai|aiGateway\.form\.optAnthropic)$/);
    expect(selects.length).toBe(2);

    // Key lands in the (masked) password input; label from host.
    expect(screen.getByDisplayValue(KEY)).toBeTruthy();
    expect((screen.getByDisplayValue(KEY) as HTMLInputElement).type).toBe('password');
    expect(screen.getByDisplayValue('ikhdev.xyz')).toBeTruthy();

    // Models rendered as chips.
    for (const model of ['glm-5.3', 'glm-5.2', 'deepseek-v4-pro', 'deepseek-v4-flash', 'kimi-k3', 'qwen3.8-max']) {
      expect(screen.getByText(model)).toBeTruthy();
    }
  });

  it('garbage input shows nothing-recognized state and disables confirm', async () => {
    render(<PastePackageDialog open onClose={jest.fn()} />);
    const textarea = screen.getByPlaceholderText('aiGateway.paste.textareaPlaceholder');
    fireEvent.change(textarea, { target: { value: 'привет %%% ###' } });

    await waitFor(() => {
      expect(screen.getByText('aiGateway.paste.nothingRecognized')).toBeTruthy();
    });
    expect(screen.queryByText('aiGateway.paste.previewTitle')).toBeNull();
    expect((screen.getByText('aiGateway.paste.confirm').closest('button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('confirm creates two endpoints sharing one credential label plus all models', async () => {
    const onClose = jest.fn();
    render(<PastePackageDialog open onClose={onClose} />);
    pasteBlob();

    await waitFor(() => {
      expect(screen.getByDisplayValue('ikhdev.xyz (OpenAI)')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('aiGateway.paste.confirm'));

    await waitFor(() => {
      expect(gatewayState.createEndpoint).toHaveBeenCalledTimes(2);
    });
    expect(gatewayState.createEndpoint).toHaveBeenCalledWith({
      name: 'ikhdev.xyz (OpenAI)',
      adapterType: 'openai_compatible',
      baseUrl: 'https://api.ikhdev.xyz/v1',
      enabled: true,
    });
    expect(gatewayState.createEndpoint).toHaveBeenCalledWith({
      name: 'ikhdev.xyz (Anthropic)',
      adapterType: 'anthropic',
      baseUrl: 'https://api.ikhdev.xyz',
      enabled: true,
    });

    await waitFor(() => {
      expect(gatewayState.createUpstreamModel).toHaveBeenCalledTimes(12);
    });
    expect(gatewayState.createCredential).toHaveBeenCalledTimes(2);
    const labels = gatewayState.createCredential.mock.calls.map((c: any[]) => c[0].label);
    expect(labels).toEqual(['ikhdev.xyz', 'ikhdev.xyz']);
    const secrets = gatewayState.createCredential.mock.calls.map((c: any[]) => c[0].secret);
    expect(secrets).toEqual([KEY, KEY]);
    expect(gatewayState.createUpstreamModel).toHaveBeenCalledWith({
      providerEndpointId: 'ep-ikhdev.xyz (OpenAI)',
      upstreamModelId: 'glm-5.3',
      enabled: true,
      discoverySource: 'manual',
    });
    expect(onClose).toHaveBeenCalled();
  });
});
