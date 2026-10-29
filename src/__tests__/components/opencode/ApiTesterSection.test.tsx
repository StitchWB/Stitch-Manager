/**
 * ApiTesterSection bulk-import contract: working keys must land in the
 * ai_gateway catalog (endpoint + credentials), never in the legacy
 * setOpenAIApiKeys store that the one-shot boot migration no longer reads.
 */

import type { ReactNode } from 'react';
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';

jest.mock('@/lib/i18n', () => ({ t: (k: string) => k }));
jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn(), info: jest.fn(), warning: jest.fn() },
}));
jest.mock('@/lib/backend/modules/opencodeConfig', () => ({
  testOpenCodeApi: jest.fn(async () => ({ success: true, models: [] })),
  bulkTestOpenCodeApi: jest.fn(),
}));
jest.mock('@/lib/backend/modules/apiKeys', () => ({
  setOpenAIApiKeys: jest.fn(async () => undefined),
}));
jest.mock('@/lib/backend/modules/aiGateway', () => ({
  createCredential: jest.fn(async () => ({ id: 'cred-1' })),
  createProviderEndpoint: jest.fn(async () => ({ id: 'ep-new' })),
  listProviderEndpoints: jest.fn(async () => []),
}));
jest.mock('@/components/ui', () => ({
  GlassCard: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children?: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  Input: ({
    label,
    value,
    onChange,
    type,
    placeholder,
  }: {
    label?: string;
    value?: string;
    onChange?: (e: { target: { value: string } }) => void;
    type?: string;
    placeholder?: string;
  }) => (
    <input
      aria-label={label}
      value={value}
      onChange={onChange}
      type={type}
      placeholder={placeholder}
    />
  ),
  Textarea: ({
    label,
    value,
    onChange,
    placeholder,
  }: {
    label?: string;
    value?: string;
    onChange?: (e: { target: { value: string } }) => void;
    placeholder?: string;
  }) => (
    <textarea aria-label={label} value={value} onChange={onChange} placeholder={placeholder} />
  ),
  Checkbox: () => <input type="checkbox" />,
  Badge: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  StatusBadge: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

import { ApiTesterSection } from '@/components/opencode/ApiTesterSection';
import { bulkTestOpenCodeApi } from '@/lib/backend/modules/opencodeConfig';
import { setOpenAIApiKeys } from '@/lib/backend/modules/apiKeys';
import {
  createCredential,
  createProviderEndpoint,
  listProviderEndpoints,
} from '@/lib/backend/modules/aiGateway';
import { toast } from 'sonner';

async function renderWithBulkResults() {
  (bulkTestOpenCodeApi as jest.Mock).mockResolvedValue({
    success: true,
    results: [
      { key: 'sk-working', status: 'ok' },
      { key: 'sk-dead', status: 'invalid' },
    ],
  });
  render(<ApiTesterSection onAddProvider={jest.fn()} />);
  fireEvent.change(screen.getByLabelText('Base URL *'), {
    target: { value: 'https://api.example.com/v1' },
  });
  fireEvent.change(screen.getByLabelText('opencode.ui.apiKeys'), {
    target: { value: 'sk-working\nsk-dead' },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'opencode.ui.bulkTest' }));
  });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'opencode.ui.importWorking' })).toBeTruthy(),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ApiTesterSection bulk import', () => {
  it('creates a gateway endpoint and credentials for working keys, not a legacy store write', async () => {
    await renderWithBulkResults();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'opencode.ui.importWorking' }));
    });

    await waitFor(() => expect(createCredential).toHaveBeenCalledTimes(1));
    expect(listProviderEndpoints).toHaveBeenCalledTimes(1);
    expect(createProviderEndpoint).toHaveBeenCalledWith({
      name: 'api.example.com',
      adapterType: 'openai_compatible',
      baseUrl: 'https://api.example.com/v1',
      enabled: true,
    });
    expect(createCredential).toHaveBeenCalledWith({
      providerEndpointId: 'ep-new',
      authType: 'api_key',
      secret: 'sk-working',
    });
    expect(setOpenAIApiKeys).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('Imported 1 keys');
  });

  it('reuses an existing endpoint matching the base URL ignoring trailing slashes', async () => {
    (listProviderEndpoints as jest.Mock).mockResolvedValue([
      { id: 'ep-existing', baseUrl: 'https://api.example.com/v1/' },
    ]);
    await renderWithBulkResults();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'opencode.ui.importWorking' }));
    });

    await waitFor(() => expect(createCredential).toHaveBeenCalledTimes(1));
    expect(createProviderEndpoint).not.toHaveBeenCalled();
    expect(createCredential).toHaveBeenCalledWith({
      providerEndpointId: 'ep-existing',
      authType: 'api_key',
      secret: 'sk-working',
    });
    expect(setOpenAIApiKeys).not.toHaveBeenCalled();
  });
});
