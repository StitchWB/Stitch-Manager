/**
 * PastePackageDialog compact-UX test: paste the provider blob, summary shows
 * one line per detected piece (masked key, base + adapter chip, models);
 * both-formats blob creates ONLY the OpenAI endpoint by default, the collapsed
 * checkbox adds the Anthropic one; confirm runs discoverModelsForEndpoint.
 * Garbage input shows "nothing recognized" and disables confirm.
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
  Input: ({ containerClassName: _cc, shellClassName: _sc, label: _l, error: _e, hint: _h, ...props }: any) => (
    <input {...props} />
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
  Badge: ({ children }: any) => <span>{children}</span>,
  Checkbox: ({ label, description: _d, className: _c, ...props }: any) => (
    <label>
      <input type="checkbox" {...props} />
      {label}
    </label>
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

const discoverState: any = {
  discoverModelsForEndpoint: jest.fn(async () => ({ models_count: 6 })),
};

jest.mock('@/lib/backend/modules/aiGateway', () => ({
  discoverModelsForEndpoint: (id: string) => discoverState.discoverModelsForEndpoint(id),
}));

import { MemoryRouter } from 'react-router-dom';
import { PastePackageDialog } from '@/components/ai-gateway/PastePackageDialog';
import { appToast } from '@/lib/observability/toast';

const KEY = 'sk-8rYKLLlExIrwKMR166zMCKpIQsp3wBlBaQMJ0LujlvNtIU7S';
const MASKED_KEY = 'sk-8rY…IU7S';


const renderDialog = (props: { open: boolean; onClose: () => void }) =>
  render(
    <MemoryRouter>
      <PastePackageDialog {...props} />
    </MemoryRouter>,
  );

const BOTH_FORMATS_BLOB = [
  `Ключ: ${KEY}`,
  'Base:',
  ' https://api.ikhdev.xyz/v1   (для OpenAI-формата)',
  ' https://api.ikhdev.xyz       (для Claude/Anthropic-формата, без /v1!)',
  'Модели: glm-5.3, glm-5.2, deepseek-v4-pro, deepseek-v4-flash, kimi-k3, qwen3.8-max',
].join('\n');

const NO_MODELS_BLOB = [
  '[27.08.2026 16:00] Даня: Ключ: sk-abcdefgh12345678',
  '[27.08.2026 16:01] Даня: Base: https://api.foo.dev/v1',
].join('\n');

beforeEach(() => {
  jest.clearAllMocks();
  discoverState.discoverModelsForEndpoint.mockResolvedValue({ models_count: 6 });
});

function paste(value: string) {
  const textarea = screen.getByPlaceholderText('aiGateway.paste.textareaPlaceholder');
  fireEvent.change(textarea, { target: { value } });
}

function confirmButton(): HTMLButtonElement {
  return screen.getByText('aiGateway.paste.confirm').closest('button') as HTMLButtonElement;
}

function anthropicCheckbox(): HTMLInputElement {
  const label = screen.getByText('aiGateway.paste.alsoAnthropic').closest('label');
  return label?.querySelector('input[type="checkbox"]') as HTMLInputElement;
}

describe('PastePackageDialog', () => {
  it('renders nothing when closed', () => {
    renderDialog({ open: false, onClose: jest.fn() });
    expect(screen.queryByPlaceholderText('aiGateway.paste.textareaPlaceholder')).toBeNull();
  });

  it('shows a compact summary: masked key, OpenAI base only, models count', async () => {
    renderDialog({ open: true, onClose: jest.fn() });
    paste(BOTH_FORMATS_BLOB);

    await waitFor(() => {
      expect(screen.getByText('aiGateway.paste.summaryTitle')).toBeTruthy();
    });

    // Key masked, raw key never rendered.
    expect(screen.getByTestId('key-masked').textContent).toBe(MASKED_KEY);
    expect(screen.queryByDisplayValue(KEY)).toBeNull();

    // Default: only the OpenAI base row; Anthropic base hidden behind the checkbox.
    expect(screen.getByText('https://api.ikhdev.xyz/v1')).toBeTruthy();
    expect(screen.queryByText('https://api.ikhdev.xyz', { exact: true })).toBeNull();
    expect(screen.getByText('aiGateway.paste.adapterOpenai')).toBeTruthy();
    expect(screen.queryByText('aiGateway.paste.adapterAnthropic')).toBeNull();

    // Collapsed anthropic option is present and unchecked.
    expect(anthropicCheckbox()).toBeTruthy();
    expect(anthropicCheckbox().checked).toBe(false);

    // Models row: count + names, no auto-discovery text.
    expect(screen.getAllByText('aiGateway.paste.modelsFound').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/glm-5\.3/).length).toBeGreaterThan(0);
    expect(screen.queryByText('aiGateway.paste.modelsAuto')).toBeNull();

    // No editable fields for name/label/models — only the textarea.
    expect(screen.queryByDisplayValue('ikhdev.xyz')).toBeNull();
    expect(confirmButton().disabled).toBe(false);
  });

  it('no-models blob shows the auto-discovery line', async () => {
    renderDialog({ open: true, onClose: jest.fn() });
    paste(NO_MODELS_BLOB);

    await waitFor(() => {
      expect(screen.getByText('aiGateway.paste.modelsAuto')).toBeTruthy();
    });
    expect(screen.queryByText('aiGateway.paste.modelsFound')).toBeNull();
  });

  it('missing key shows an inline input; typing it feeds the credential', async () => {
    renderDialog({ open: true, onClose: jest.fn() });
    paste('Base: https://api.example.com/v1\nМодели: gpt-4o');

    const keyInput = await screen.findByPlaceholderText('aiGateway.paste.keyMissing');
    fireEvent.change(keyInput, { target: { value: 'sk-manual123456789' } });

    fireEvent.click(confirmButton());
    await waitFor(() => {
      expect(gatewayState.createCredential).toHaveBeenCalledTimes(1);
    });
    expect(gatewayState.createCredential).toHaveBeenCalledWith({
      providerEndpointId: 'ep-example.com',
      label: 'example.com',
      authType: 'api_key',
      secret: 'sk-manual123456789',
    });
  });

  it('garbage input shows nothing-recognized state and disables confirm', async () => {
    renderDialog({ open: true, onClose: jest.fn() });
    paste('привет %%% ###');

    await waitFor(() => {
      expect(screen.getByText('aiGateway.paste.nothingRecognized')).toBeTruthy();
    });
    expect(screen.queryByText('aiGateway.paste.summaryTitle')).toBeNull();
    expect(confirmButton().disabled).toBe(true);
  });

  it('confirm creates ONE OpenAI endpoint by default and runs discovery', async () => {
    const onClose = jest.fn();
    renderDialog({ open: true, onClose });
    paste(BOTH_FORMATS_BLOB);

    await waitFor(() => {
      expect(screen.getByText('aiGateway.paste.summaryTitle')).toBeTruthy();
    });
    fireEvent.click(confirmButton());

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });

    expect(gatewayState.createEndpoint).toHaveBeenCalledTimes(1);
    expect(gatewayState.createEndpoint).toHaveBeenCalledWith({
      name: 'ikhdev.xyz',
      adapterType: 'openai_compatible',
      baseUrl: 'https://api.ikhdev.xyz/v1',
      enabled: true,
    });

    expect(gatewayState.createCredential).toHaveBeenCalledTimes(1);
    expect(gatewayState.createCredential).toHaveBeenCalledWith({
      providerEndpointId: 'ep-ikhdev.xyz',
      label: 'ikhdev.xyz',
      authType: 'api_key',
      secret: KEY,
    });

    // Blob models merged in manually, then discovery runs for the endpoint.
    expect(gatewayState.createUpstreamModel).toHaveBeenCalledTimes(6);
    expect(gatewayState.createUpstreamModel).toHaveBeenCalledWith({
      providerEndpointId: 'ep-ikhdev.xyz',
      upstreamModelId: 'glm-5.3',
      enabled: true,
      discoverySource: 'manual',
    });
    expect(discoverState.discoverModelsForEndpoint).toHaveBeenCalledWith('ep-ikhdev.xyz');

    expect(appToast.success).toHaveBeenCalledWith('aiGateway.paste.success', 'ai-gateway');
  });

  it('checking the anthropic option adds the second endpoint', async () => {
    const onClose = jest.fn();
    renderDialog({ open: true, onClose });
    paste(BOTH_FORMATS_BLOB);

    await waitFor(() => {
      expect(screen.getByText('aiGateway.paste.summaryTitle')).toBeTruthy();
    });
    fireEvent.click(anthropicCheckbox());
    expect(anthropicCheckbox().checked).toBe(true);
    expect(screen.getByText('https://api.ikhdev.xyz', { exact: true })).toBeTruthy();

    fireEvent.click(confirmButton());
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });

    expect(gatewayState.createEndpoint).toHaveBeenCalledTimes(2);
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
    expect(discoverState.discoverModelsForEndpoint).toHaveBeenCalledTimes(2);
  });

  it('discovery failure still succeeds with the pending-sync toast', async () => {
    const onClose = jest.fn();
    discoverState.discoverModelsForEndpoint.mockRejectedValue(new Error('backend down'));
    renderDialog({ open: true, onClose });
    paste(NO_MODELS_BLOB);

    await waitFor(() => {
      expect(screen.getByText('aiGateway.paste.summaryTitle')).toBeTruthy();
    });
    fireEvent.click(confirmButton());

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    expect(gatewayState.createEndpoint).toHaveBeenCalledTimes(1);
    expect(gatewayState.createUpstreamModel).not.toHaveBeenCalled();
    expect(appToast.success).toHaveBeenCalledWith('aiGateway.paste.successPending', 'ai-gateway');
  });
});
