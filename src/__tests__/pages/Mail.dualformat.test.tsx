/**
 * Mail page dual-format binding tests.
 *
 * Verifies:
 *   (a) source badge shows 'mail.sourceBuiltin' when no service plugins.
 *   (b) source badge shows 'mail.sourcePlugin' when stitch-mail is present.
 *   (c) invalidate (plugin install/uninstall) triggers a loadProfiles refetch.
 *
 * Mocks: invoke (safeInvoke), i18n (t = identity), Header (renders actions),
 * mail components (stubs), ui, useUIState, registration store, mail runtime
 * helpers, sonner. The real servicePlugins module runs — only safeInvoke is
 * mocked, so the cache + useSyncExternalStore + invalidate path is exercised
 * end-to-end. The real useMailStore + useMailRuntime also run; safeInvoke
 * stubs handle email_inbox_* commands so the store does not crash.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Mail from '../../pages/Mail';
import { safeInvoke } from '@/lib/backend/core/invoke';
import {
  invalidate,
  _resetForTests,
  type ServicePluginInfo,
} from '@/lib/backend/modules/servicePlugins';

// ── Module mocks ────────────────────────────────────────────────────────────

jest.mock('@/lib/backend/core/invoke', () => ({
  setAuthExpiredHandler: jest.fn(),
  safeInvoke: jest.fn(),
  BackendError: class extends Error {},
}));

jest.mock('@/lib/i18n', () => ({
  t: (key: string) => key,
}));

jest.mock('@/components/layout/Header', () => ({
  __esModule: true,
  default: ({ title, actions }: { title: string; actions?: React.ReactNode }) => (
    <div data-testid="header">
      <span data-testid="header-title">{title}</span>
      <div data-testid="header-actions">{actions}</div>
    </div>
  ),
}));

jest.mock('@/components/mail', () => ({
  MailSidebar: () => <div data-testid="mail-sidebar" />,
  MailToolbar: () => <div data-testid="mail-toolbar" />,
  MailMessageList: () => <div data-testid="mail-message-list" />,
  MailMessageViewer: () => <div data-testid="mail-message-viewer" />,
  MailManualConnectModal: () => null,
  GoogleSheetsRawMailboxImport: () => null,
}));

jest.mock('@/components/ui', () => ({
  Button: () => <button>btn</button>,
  Modal: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

jest.mock('@/hooks/useUIState', () => ({
  useUIState: () => [false, jest.fn()],
}));

jest.mock('@/stores/registration', () => ({
  useRegistrationStore: (selector: (s: { config: { imap: { host: string; port: number; username: string; password: string; useTls: boolean } } }) => unknown) =>
    selector({
      config: {
        imap: { host: '', port: 993, username: '', password: '', useTls: true },
      },
    }),
}));

jest.mock('@/lib/mail/runtime', () => ({
  ACCOUNT_QUERY_PARAM: 'account',
  AUTO_REG_MAILBOX_PROFILE_ID: 'auto-reg',
  buildAccountScopeContext: jest.fn(async () => null),
  buildImapConnectInput: jest.fn((args: { accountId: string; mailbox: string; readOnly: boolean; credentials: unknown }) => ({
    provider: 'imap',
    accountId: args.accountId,
    credentials: { type: 'imap', value: args.credentials },
    options: { mailbox: args.mailbox, readOnly: args.readOnly },
  })),
  buildMailTmConnectInput: jest.fn((args: { accountId: string; readOnly: boolean; credentials: unknown }) => ({
    provider: 'mail_tm',
    accountId: args.accountId,
    credentials: { type: 'mail_tm', value: args.credentials },
    options: { readOnly: args.readOnly },
  })),
  deriveAutoRegProfile: jest.fn(() => null),
  upsertAutoRegMailboxProfile: jest.fn(async () => null),
  buildEmailQuery: jest.fn(() => ({})),
  buildWaitForEmailOptions: jest.fn(() => ({})),
  markMessageAsReadLocal: jest.fn((messages: unknown[]) => messages),
  removeMessageLocal: jest.fn((messages: unknown[]) => messages),
  upsertMessageById: jest.fn((messages: unknown[], msg: unknown) => [...messages, msg]),
}));

jest.mock('sonner', () => ({
  toast: {
    error: jest.fn(),
    success: jest.fn(),
    warning: jest.fn(),
  },
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const mailPluginFixture: ServicePluginInfo = {
  id: 'stitch-mail',
  version: '1.0.0',
  status: {
    status: 'running',
    port: null,
    pid: 123,
    uptimeSeconds: 5,
    error: null,
    plugin_id: 'stitch-mail',
    restarts: 0,
    stopping: false,
  },
};

/** safeInvoke stub that handles all commands the store calls on mount. */
function mockSafeInvokeWith(plugins: ServicePluginInfo[]): jest.Mock {
  return jest.fn((cmd: string) => {
    if (cmd === 'list_service_plugins') return Promise.resolve(plugins);
    if (cmd === 'email_inbox_list_profiles') return Promise.resolve([]);
    if (cmd === 'email_inbox_get_sync_state') return Promise.resolve(null);
    if (cmd === 'email_inbox_get_provider_catalog') return Promise.resolve([]);
    if (cmd === 'email_inbox_list_folders') return Promise.resolve([]);
    return Promise.resolve(null);
  }) as unknown as jest.Mock;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Mail dual-format UI', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _resetForTests();
    (safeInvoke as jest.Mock).mockImplementation(mockSafeInvokeWith([]) as unknown as () => Promise<unknown>);
  });

  it('(a) no plugins -> badge shows mail.sourceBuiltin', async () => {
    (safeInvoke as jest.Mock).mockImplementation(mockSafeInvokeWith([]) as unknown as () => Promise<unknown>);

    render(
      <MemoryRouter>
        <Mail />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(safeInvoke).toHaveBeenCalledWith('list_service_plugins');
    });

    const actions = await screen.findByTestId('header-actions');
    expect(actions.textContent).toContain('mail.sourceBuiltin');
    expect(actions.textContent).not.toContain('mail.sourcePlugin');
  });

  it('(b) stitch-mail plugin present -> badge shows mail.sourcePlugin', async () => {
    (safeInvoke as jest.Mock).mockImplementation(mockSafeInvokeWith([mailPluginFixture]) as unknown as () => Promise<unknown>);

    render(
      <MemoryRouter>
        <Mail />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(safeInvoke).toHaveBeenCalledWith('list_service_plugins');
    });

    const actions = await screen.findByTestId('header-actions');
    expect(actions.textContent).toContain('mail.sourcePlugin');
    expect(actions.textContent).not.toContain('mail.sourceBuiltin');
  });

  it('(c) invalidate triggers loadProfiles refetch', async () => {
    (safeInvoke as jest.Mock).mockImplementation(mockSafeInvokeWith([]) as unknown as () => Promise<unknown>);

    render(
      <MemoryRouter>
        <Mail />
      </MemoryRouter>,
    );

    // Wait for initial mount fetch to settle.
    await waitFor(() => {
      expect(safeInvoke).toHaveBeenCalledWith('list_service_plugins');
    });
    await waitFor(() => {
      expect(safeInvoke).toHaveBeenCalledWith('email_inbox_list_profiles');
    });

    const listProfilesCallsBefore = (safeInvoke as jest.Mock).mock.calls.filter(
      (call: unknown[]) => call[0] === 'email_inbox_list_profiles',
    ).length;
    expect(listProfilesCallsBefore).toBeGreaterThanOrEqual(1);

    // Simulate plugin install: next list_service_plugins returns stitch-mail.
    (safeInvoke as jest.Mock).mockImplementation(mockSafeInvokeWith([mailPluginFixture]) as unknown as () => Promise<unknown>);

    // Invalidate cache — triggers a refetch that populates the cache with
    // the plugin, changing servicePluginsVersion, which fires the refetch
    // effect in Mail.tsx.
    act(() => {
      invalidate();
    });

    // Wait for the refetch to call loadProfiles again.
    await waitFor(() => {
      const listProfilesCallsAfter = (safeInvoke as jest.Mock).mock.calls.filter(
        (call: unknown[]) => call[0] === 'email_inbox_list_profiles',
      ).length;
      expect(listProfilesCallsAfter).toBeGreaterThan(listProfilesCallsBefore);
    });
  });
});
