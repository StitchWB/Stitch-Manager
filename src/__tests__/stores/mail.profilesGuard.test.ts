/**
 * Mail profile boundary guard tests.
 *
 * Verifies:
 *   (a) loadProfiles filters malformed backend/plugin rows (the production
 *       crash shape: stitch-mail returning marker rows for an empty profile
 *       DB) — valid rows survive, an error is surfaced, nothing throws.
 *   (b) well-formed responses pass through untouched.
 *   (c) isEmailInboxProfile unit cases: missing connectInput, non-object
 *       and array inputs, corrupt credentials.
 *
 * Mocks: invoke (safeInvoke) — same pattern as Mail.dualformat.test.tsx.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { useMailStore, _resetErrorDedupeForTests } from '../../stores/mail';
import { isEmailInboxProfile } from '../../stores/mail/helpers';
import { safeInvoke } from '@/lib/backend/core/invoke';
import type { EmailInboxProfile } from '@/lib/backend/modules/emailInbox';

jest.mock('@/lib/backend/core/invoke', () => ({
  setAuthExpiredHandler: jest.fn(),
  safeInvoke: jest.fn(),
  BackendError: class extends Error {},
}));

const validImapProfile: EmailInboxProfile = {
  id: 'p1',
  label: 'IMAP · test@example.com',
  provider: 'imap',
  accountId: 'test@example.com',
  connectInput: {
    provider: 'imap',
    accountId: 'test@example.com',
    credentials: {
      type: 'imap',
      value: {
        host: 'imap.gmail.com',
        port: 993,
        username: 'test@example.com',
        password: 'password',
        useTls: true,
      },
    },
  },
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const validMailTmProfile: EmailInboxProfile = {
  id: 'p2',
  label: 'Mail.tm · user@mail.tm',
  provider: 'mail_tm',
  accountId: 'mailtm:user@mail.tm',
  connectInput: {
    provider: 'mail_tm',
    accountId: 'mailtm:user@mail.tm',
    credentials: {
      type: 'mail_tm',
      value: {
        address: 'user@mail.tm',
        password: 'password',
        baseUrl: 'https://api.mail.tm',
      },
    },
  },
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const pluginMarkerRow = { id: 'plugin-served-marker', source: 'stitch-mail' };

function mockSafeInvokeWith(listProfilesResult: unknown): jest.Mock {
  return jest.fn((cmd: string) => {
    if (cmd === 'email_inbox_list_profiles') return Promise.resolve(listProfilesResult);
    if (cmd === 'email_inbox_get_sync_state') return Promise.resolve(null);
    return Promise.resolve(null);
  }) as unknown as jest.Mock;
}

const flushAsync = () => new Promise<void>(resolve => setTimeout(resolve, 0));

describe('mail profiles boundary guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _resetErrorDedupeForTests();
    useMailStore.setState({
      profiles: [],
      activeProfileId: null,
      profileSyncMap: {},
      providerCatalog: [],
      isProfilesLoading: false,
      error: null,
      session: null,
      capabilities: null,
      availableFolders: [],
      selectedFolder: null,
      connectedMailbox: null,
    });
  });

  it('loadProfiles drops plugin marker rows, keeps valid profiles, and surfaces an error', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    (safeInvoke as jest.Mock).mockImplementation(
      mockSafeInvokeWith([pluginMarkerRow, validImapProfile]) as unknown as () => Promise<unknown>,
    );

    await useMailStore.getState().loadProfiles();
    await flushAsync();

    const state = useMailStore.getState();
    expect(state.profiles).toEqual([validImapProfile]);
    expect(state.error).toBe('1 mail profile(s) rejected: malformed response from backend');
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Malformed mail profiles rejected:',
      [pluginMarkerRow],
    );

    consoleErrorSpy.mockRestore();
  });

  it('loadProfiles keeps well-formed profiles untouched with no error', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    (safeInvoke as jest.Mock).mockImplementation(
      mockSafeInvokeWith([validImapProfile, validMailTmProfile]) as unknown as () => Promise<unknown>,
    );

    await useMailStore.getState().loadProfiles();
    await flushAsync();

    const state = useMailStore.getState();
    expect(state.profiles).toEqual([validImapProfile, validMailTmProfile]);
    expect(state.error).toBeNull();
    expect(consoleErrorSpy).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it('loadProfiles degrades a non-array response to an empty list with an error', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    (safeInvoke as jest.Mock).mockImplementation(
      mockSafeInvokeWith(pluginMarkerRow) as unknown as () => Promise<unknown>,
    );

    await useMailStore.getState().loadProfiles();
    await flushAsync();

    const state = useMailStore.getState();
    expect(state.profiles).toEqual([]);
    expect(state.error).toBe('1 mail profile(s) rejected: malformed response from backend');

    consoleErrorSpy.mockRestore();
  });
});

describe('isEmailInboxProfile', () => {
  it('accepts well-formed imap and mail_tm profiles', () => {
    expect(isEmailInboxProfile(validImapProfile)).toBe(true);
    expect(isEmailInboxProfile(validMailTmProfile)).toBe(true);
  });

  it('accepts a minimal profile without optional fields', () => {
    const minimal = {
      id: 'p1',
      label: 'Mailbox profile',
      provider: 'imap',
      accountId: 'test@example.com',
      connectInput: {
        provider: 'imap',
        accountId: 'test@example.com',
        credentials: { type: 'imap', value: {} },
      },
    };

    expect(isEmailInboxProfile(minimal)).toBe(true);
  });

  it('rejects rows without connectInput', () => {
    expect(
      isEmailInboxProfile({ id: 'p1', label: 'L', provider: 'imap', accountId: 'a' }),
    ).toBe(false);
  });

  it('rejects non-object and array inputs', () => {
    expect(isEmailInboxProfile(null)).toBe(false);
    expect(isEmailInboxProfile(undefined)).toBe(false);
    expect(isEmailInboxProfile('profile')).toBe(false);
    expect(isEmailInboxProfile(42)).toBe(false);
    expect(isEmailInboxProfile([validImapProfile])).toBe(false);
  });

  it('rejects corrupt credentials', () => {
    const valueNotObject = {
      ...validImapProfile,
      connectInput: {
        ...validImapProfile.connectInput,
        credentials: { type: 'imap', value: 'oops' },
      },
    };
    expect(isEmailInboxProfile(valueNotObject)).toBe(false);

    const unknownCredentialType = {
      ...validImapProfile,
      connectInput: {
        ...validImapProfile.connectInput,
        credentials: { type: 'smtp', value: {} },
      },
    };
    expect(isEmailInboxProfile(unknownCredentialType)).toBe(false);

    const missingCredentials = {
      ...validImapProfile,
      connectInput: { provider: 'imap', accountId: 'test@example.com' },
    };
    expect(isEmailInboxProfile(missingCredentials)).toBe(false);
  });

  it('rejects an unknown top-level provider', () => {
    expect(isEmailInboxProfile({ ...validImapProfile, provider: 'smtp' })).toBe(false);
  });
});
