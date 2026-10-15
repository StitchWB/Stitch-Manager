import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('@/lib/i18n', () => ({ t: (k: string) => k }));
jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
}));
jest.mock('@/lib/backend/modules/apiKeys', () => ({
  getZaiApiKeys: jest.fn(),
  setZaiApiKeys: jest.fn(),
}));

import { toast } from 'sonner';
import { ZaiKeysPanel } from '@/components/ai-hub/providers/ZaiKeysPanel';
import {
  getZaiApiKeys,
  setZaiApiKeys,
} from '@/lib/backend/modules/apiKeys';

const storedKey = {
  apiKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.session-token-tail',
  baseUrl: 'https://chat.z.ai',
  prefix: 'user-42',
};

beforeEach(() => {
  jest.clearAllMocks();
  (getZaiApiKeys as jest.Mock).mockResolvedValue([]);
  (setZaiApiKeys as jest.Mock).mockResolvedValue(undefined);
});

describe('ZaiKeysPanel legacy Z.AI key store editor', () => {
  it('loads keys on mount and renders masked tail, baseUrl and prefix', async () => {
    (getZaiApiKeys as jest.Mock).mockResolvedValue([storedKey]);

    render(<ZaiKeysPanel />);

    await waitFor(() => expect(getZaiApiKeys).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('••••tail')).toBeTruthy();
    expect(screen.getByText('https://chat.z.ai')).toBeTruthy();
    expect(screen.getByText('user-42')).toBeTruthy();
  });

  it('shows the empty state when the store has no keys', async () => {
    render(<ZaiKeysPanel />);

    expect(await screen.findByText('aiHub.providersPage.zaiEmpty')).toBeTruthy();
  });

  it('adds a key and persists the full array including prefix', async () => {
    const user = userEvent.setup();
    (getZaiApiKeys as jest.Mock).mockResolvedValue([storedKey]);
    render(<ZaiKeysPanel />);

    await screen.findByText('user-42');

    await user.type(screen.getByLabelText('aiHub.providersPage.zaiApiKeyLabel'), 'new-session-token');
    await user.type(screen.getByLabelText('aiHub.providersPage.zaiBaseUrlLabel'), 'https://chat.z.ai');
    await user.type(screen.getByLabelText('aiHub.providersPage.zaiPrefixLabel'), 'user-99');
    await user.click(screen.getByRole('button', { name: 'aiHub.providersPage.zaiAdd' }));

    await waitFor(() => expect(setZaiApiKeys).toHaveBeenCalledTimes(1));
    expect(setZaiApiKeys).toHaveBeenCalledWith([
      storedKey,
      {
        apiKey: 'new-session-token',
        baseUrl: 'https://chat.z.ai',
        prefix: 'user-99',
      },
    ]);
    expect(toast.success).toHaveBeenCalledWith('aiHub.providersPage.zaiSaved');
    expect(await screen.findByText('••••oken')).toBeTruthy();
  });

  it('reports failure when persisting throws', async () => {
    const user = userEvent.setup();
    (setZaiApiKeys as jest.Mock).mockRejectedValue(new Error('boom'));
    render(<ZaiKeysPanel />);

    await screen.findByText('aiHub.providersPage.zaiEmpty');

    await user.type(screen.getByLabelText('aiHub.providersPage.zaiApiKeyLabel'), 'new-session-token');
    await user.click(screen.getByRole('button', { name: 'aiHub.providersPage.zaiAdd' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('aiHub.providersPage.zaiSaveFailed'));
  });

  it('deletes a row and persists the remaining array', async () => {
    (getZaiApiKeys as jest.Mock).mockResolvedValue([storedKey, { apiKey: 'second-token', baseUrl: null, prefix: null }]);
    render(<ZaiKeysPanel />);

    await screen.findByText('user-42');

    await act(async () => {
      fireEvent.click(screen.getAllByTestId('zai-key-row-delete')[0]);
    });

    await waitFor(() => expect(setZaiApiKeys).toHaveBeenCalledTimes(1));
    expect(setZaiApiKeys).toHaveBeenCalledWith([{ apiKey: 'second-token', baseUrl: null, prefix: null }]);
    expect(screen.queryByText('user-42')).toBeNull();
  });
});
