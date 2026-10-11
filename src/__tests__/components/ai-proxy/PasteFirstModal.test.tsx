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

jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn() },
}));

const createAiProxyAccount = jest.fn(async () => 1);
jest.mock('@/lib/backend/modules/aiProxy', () => ({
  createAiProxyAccount: (...args: unknown[]) => createAiProxyAccount(...args),
}));

const testOpenCodeApi = jest.fn();
jest.mock('@/lib/backend/modules/opencodeConfig', () => ({
  testOpenCodeApi: (...args: unknown[]) => testOpenCodeApi(...args),
}));

const addCustomProvider = jest.fn();
const setCustomProviderKeys = jest.fn();
jest.mock('@/lib/backend/modules/customProviders', () => ({
  addCustomProvider: (...args: unknown[]) => addCustomProvider(...args),
  setCustomProviderKeys: (...args: unknown[]) => setCustomProviderKeys(...args),
}));

jest.mock('@/components/ui', () => ({
  Badge: ({ children, variant }: any) => <span data-variant={variant}>{children}</span>,
  Button: ({ children, onClick, disabled, isLoading, leftIcon: _leftIcon, rightIcon: _rightIcon, ...rest }: any) => (
    <button onClick={onClick} disabled={disabled} data-loading={isLoading} {...rest}>
      {children}
    </button>
  ),
  Input: ({ label, containerClassName: _containerClassName, ...rest }: any) => (
    <input aria-label={label} {...rest} />
  ),
  Modal: ({ isOpen, title, children, footer }: any) =>
    isOpen ? (
      <div>
        <div>{title}</div>
        {children}
        {footer}
      </div>
    ) : null,
  Select: ({ label, options, value, onValueChange, containerClassName: _containerClassName, disabled }: any) => (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={e => onValueChange?.(e.target.value)}
    >
      {options.map((o: any) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
  Textarea: ({ label, hint: _hint, containerClassName: _containerClassName, shellClassName: _shellClassName, ...rest }: any) => (
    <textarea aria-label={label} {...rest} />
  ),
  Toggle: ({ label, checked, onChange }: any) => (
    <button role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} />
  ),
}));

import { PasteFirstModal } from '@/components/ai-proxy/PasteFirstModal';
import { toast } from 'sonner';

const ANTHROPIC_KEY = 'sk-ant-api03-abcdefgh1234';
const GEMINI_KEY = 'AIzaSyD-abcdefgh1234';

function renderModal(props: Partial<React.ComponentProps<typeof PasteFirstModal>> = {}) {
  const onClose = jest.fn();
  const onSubmit = jest.fn(async () => undefined);
  render(
    <PasteFirstModal isOpen onClose={onClose} onSubmit={onSubmit} {...props} />
  );
  return { onClose, onSubmit };
}

function pasteKeys(text: string) {
  const textarea = screen.getByLabelText('aiHub.pasteFirst.keysLabel');
  fireEvent.change(textarea, { target: { value: text } });
}

describe('PasteFirstModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    testOpenCodeApi.mockResolvedValue({ success: true, models: [{ id: 'gpt-4o' }] });
    addCustomProvider.mockResolvedValue({
      success: true,
      provider: { id: 'cp-1', name: 'n', base_url: 'u', litellm_model: 'openai/*' },
    });
    setCustomProviderKeys.mockResolvedValue(undefined);
  });

  it('renders nothing when closed', () => {
    render(
      <PasteFirstModal isOpen={false} onClose={jest.fn()} onSubmit={jest.fn()} />
    );
    expect(screen.queryByTestId('paste-first-modal')).toBeNull();
  });

  it('parses pasted lines into preview rows with masked keys and detected badges', () => {
    renderModal();
    pasteKeys(`${ANTHROPIC_KEY}\n${GEMINI_KEY}\n\n`);

    const rows = screen.getAllByTestId('paste-row');
    expect(rows.length).toBe(2);
    expect(screen.getByText('sk-ant-a***234')).toBeTruthy();
    expect(screen.getByText('AIzaSyD-***234')).toBeTruthy();
    expect(screen.getByText('anthropic')).toBeTruthy();
    expect(screen.getByText('gemini')).toBeTruthy();
    expect(screen.getAllByText('aiHub.pasteFirst.statusPending').length).toBe(2);
  });

  it('prefills the provider select from the first detected key', () => {
    renderModal();
    pasteKeys(ANTHROPIC_KEY);

    const select = screen.getByLabelText('aiHub.pasteFirst.providerLabel');
    expect(select).toHaveValue('anthropic');
  });

  it('honors initialProvider as the preselected provider', () => {
    renderModal({ initialProvider: 'zai' });
    pasteKeys('some-unknown-key');

    const select = screen.getByLabelText('aiHub.pasteFirst.providerLabel');
    expect(select).toHaveValue('zai');
  });

  it('tests every key in parallel against the default base url and shows model badges', async () => {
    const models = Array.from({ length: 12 }, (_, i) => ({ id: `model-${i}` }));
    testOpenCodeApi.mockResolvedValue({ success: true, models });
    renderModal();
    pasteKeys('sk-abcdefgh1234');

    fireEvent.click(screen.getByText('aiHub.pasteFirst.test'));

    await waitFor(() => {
      expect(screen.getByText('aiHub.pasteFirst.statusOk')).toBeTruthy();
    });
    expect(testOpenCodeApi).toHaveBeenCalledWith('https://api.openai.com/v1', 'sk-abcdefgh1234');
    expect(screen.getByText('model-0')).toBeTruthy();
    expect(screen.queryByText('model-11')).toBeNull();
    expect(screen.getByText('apiKeys.moreCount')).toBeTruthy();
  });

  it('marks invalid keys and keeps them out of the add batch', async () => {
    testOpenCodeApi.mockResolvedValue({ success: false, error: 'bad key' });
    renderModal();
    pasteKeys('sk-ant-api03-abcdefgh1234');

    fireEvent.click(screen.getByText('aiHub.pasteFirst.test'));
    await waitFor(() => {
      expect(screen.getByText('aiHub.pasteFirst.statusInvalid')).toBeTruthy();
    });
    expect(screen.getByText('bad key')).toBeTruthy();

    fireEvent.click(screen.getByText('aiHub.pasteFirst.add'));
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('aiHub.pasteFirst.nothingToAdd');
    });
    expect(createAiProxyAccount).not.toHaveBeenCalled();
  });

  it('creates one account per accepted key and reports success', async () => {
    const { onSubmit, onClose } = renderModal();
    pasteKeys(`${ANTHROPIC_KEY}\n${GEMINI_KEY}`);

    fireEvent.click(screen.getByText('aiHub.pasteFirst.add'));

    await waitFor(() => {
      expect(createAiProxyAccount).toHaveBeenCalledTimes(2);
    });
    expect(createAiProxyAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'anthropic',
        name: 'anthropic-1234',
        apiKey: ANTHROPIC_KEY,
        enabled: true,
      })
    );
    expect(createAiProxyAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'gemini',
        name: 'gemini-1234',
        apiKey: GEMINI_KEY,
        enabled: true,
      })
    );
    expect(onSubmit).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('aiHub.pasteFirst.addedToast');
  });

  it('creates a custom provider with its keys when the provider is unknown', async () => {
    const { onSubmit } = renderModal();
    pasteKeys('xyz-unknown-token-1234');

    expect(screen.getByLabelText('aiHub.pasteFirst.baseUrlLabel')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('aiHub.pasteFirst.newNameLabel'), {
      target: { value: 'DashScope' },
    });
    fireEvent.change(screen.getByLabelText('aiHub.pasteFirst.baseUrlLabel'), {
      target: { value: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
    });

    fireEvent.click(screen.getByText('aiHub.pasteFirst.add'));

    await waitFor(() => {
      expect(addCustomProvider).toHaveBeenCalledWith(
        'DashScope',
        'https://dashscope.aliyuncs.com/compatible-mode/v1',
        'openai/*'
      );
    });
    expect(setCustomProviderKeys).toHaveBeenCalledWith('cp-1', [
      { apiKey: 'xyz-unknown-token-1234', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', prefix: null },
    ]);
    expect(createAiProxyAccount).not.toHaveBeenCalled();
    expect(onSubmit).toHaveBeenCalled();
  });

  it('rejects the custom flow without name and base url', async () => {
    renderModal();
    pasteKeys('xyz-unknown-token-1234');

    fireEvent.click(screen.getByText('aiHub.pasteFirst.add'));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('aiHub.pasteFirst.newProviderHint');
    });
    expect(addCustomProvider).not.toHaveBeenCalled();
  });

  it('reveals the base url override via toggle for detected providers', () => {
    renderModal();
    pasteKeys('sk-abcdefgh1234');

    expect(screen.queryByLabelText('aiHub.pasteFirst.baseUrlLabel')).toBeNull();
    fireEvent.click(screen.getByRole('switch', { name: 'aiHub.pasteFirst.baseUrlToggle' }));
    expect(screen.getByLabelText('aiHub.pasteFirst.baseUrlLabel')).toBeTruthy();
  });
});
