import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import {
  emailInboxConnectProfile,
  emailInboxConnect,
  emailInboxDeleteProfile,
  emailInboxDelete,
  emailInboxDisconnect,
  emailInboxGetProviderCatalog,
  emailInboxGetProfile,
  emailInboxGetById,
  emailInboxGetCapabilities,
  emailInboxGetSyncState,
  emailInboxList,
  emailInboxListFolders,
  emailInboxListProfiles,
  emailInboxMarkAsRead,
  emailInboxUpsertProfile,
  emailInboxUpsertSyncState,
  emailInboxWaitForEmail,
} from '../../../../lib/backend/modules/emailInbox';

const originalFetch = globalThis.fetch;

const mockFetchOk = (data: unknown) => {
  globalThis.fetch = jest.fn<any>().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
  }) as unknown as typeof fetch;
};

describe('lib/Backend/modules/emailInbox contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('emailInboxConnect invokes email_inbox_connect with { input }', async () => {
    const input = {
      provider: 'imap' as const,
      accountId: 'acc-1',
      credentials: {
        type: 'imap' as const,
        value: {
          host: 'imap.gmail.com',
          port: 993,
          username: 'u@gmail.com',
          password: 'secret',
          useTls: true,
        },
      },
      options: { mailbox: 'INBOX', readOnly: false },
    };

    const session = {
      sessionId: 's1',
      provider: 'imap',
      accountId: 'acc-1',
      capabilities: {
        canDelete: true,
        canMarkAsRead: true,
        canSearchBody: true,
        canDownloadAttachments: true,
        canListFolders: true,
      },
      connectedAt: '2026-03-09T00:00:00Z',
    };
    mockFetchOk(session);

    await expect(emailInboxConnect(input)).resolves.toEqual(session);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:25584/api/email_inbox_connect',
      expect.objectContaining({ body: JSON.stringify({ input }) }),
    );
  });

  it('emailInboxList invokes email_inbox_list with { sessionId, query }', async () => {
    const messages: Array<{ id: string }> = [{ id: 'm1' }];
    mockFetchOk(messages);

    const query = { subjectContains: 'Verify', unreadOnly: true };
    await expect(emailInboxList('s1', query)).resolves.toEqual(messages);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:25584/api/email_inbox_list',
      expect.objectContaining({ body: JSON.stringify({ sessionId: 's1', query }) }),
    );
  });

  it('emailInboxGetById invokes email_inbox_get_by_id with ids', async () => {
    const message = { id: 'm1' };
    mockFetchOk(message);

    await expect(emailInboxGetById('s1', 'm1')).resolves.toEqual(message);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:25584/api/email_inbox_get_by_id',
      expect.objectContaining({ body: JSON.stringify({ sessionId: 's1', messageId: 'm1' }) }),
    );
  });

  it('emailInboxListFolders invokes email_inbox_list_folders', async () => {
    const folders = [{ id: 'INBOX', path: 'INBOX', name: 'Inbox', kind: 'inbox' }];
    mockFetchOk(folders);

    await expect(emailInboxListFolders('s1')).resolves.toEqual(folders);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:25584/api/email_inbox_list_folders',
      expect.objectContaining({ body: JSON.stringify({ sessionId: 's1' }) }),
    );
  });

  it('emailInboxWaitForEmail invokes email_inbox_wait_for_email with options', async () => {
    const message = { id: 'm2' };
    mockFetchOk(message);

    const query = { from: 'no-reply@x.com' };
    const options = { timeoutMs: 120000, pollIntervalMs: 3000, dedupeKey: 'scenario-a' };

    await expect(emailInboxWaitForEmail('s1', query, options)).resolves.toEqual(message);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:25584/api/email_inbox_wait_for_email',
      expect.objectContaining({
        body: JSON.stringify({ sessionId: 's1', query, options }),
      }),
    );
  });

  it('emailInboxMarkAsRead invokes email_inbox_mark_as_read', async () => {
    mockFetchOk(undefined);
    await expect(emailInboxMarkAsRead('s1', 'm1')).resolves.toBeUndefined();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:25584/api/email_inbox_mark_as_read',
      expect.objectContaining({ body: JSON.stringify({ sessionId: 's1', messageId: 'm1' }) }),
    );
  });

  it('emailInboxDelete invokes email_inbox_delete', async () => {
    mockFetchOk(undefined);
    await expect(emailInboxDelete('s1', 'm1')).resolves.toBeUndefined();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:25584/api/email_inbox_delete',
      expect.objectContaining({ body: JSON.stringify({ sessionId: 's1', messageId: 'm1' }) }),
    );
  });

  it('emailInboxDisconnect invokes email_inbox_disconnect', async () => {
    mockFetchOk(undefined);
    await expect(emailInboxDisconnect('s1')).resolves.toBeUndefined();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:25584/api/email_inbox_disconnect',
      expect.objectContaining({ body: JSON.stringify({ sessionId: 's1' }) }),
    );
  });

  it('emailInboxGetCapabilities invokes email_inbox_get_capabilities', async () => {
    const capabilities = {
      canDelete: true,
      canMarkAsRead: true,
      canSearchBody: true,
      canDownloadAttachments: false,
      canListFolders: true,
    };
    mockFetchOk(capabilities);

    await expect(emailInboxGetCapabilities('s1')).resolves.toEqual(capabilities);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:25584/api/email_inbox_get_capabilities',
      expect.objectContaining({ body: JSON.stringify({ sessionId: 's1' }) }),
    );
  });

  it('emailInboxGetProviderCatalog invokes email_inbox_get_provider_catalog', async () => {
    const catalog = [
      {
        provider: 'imap',
        displayName: 'IMAP',
        available: true,
        capabilities: {
          canDelete: true,
          canMarkAsRead: true,
          canSearchBody: true,
          canDownloadAttachments: true,
          canListFolders: true,
        },
        supportsProfileConnect: true,
      },
    ];
    mockFetchOk(catalog);

    await expect(emailInboxGetProviderCatalog()).resolves.toEqual(catalog);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:25584/api/email_inbox_get_provider_catalog',
      expect.objectContaining({ body: JSON.stringify({}) }),
    );
  });

  it('emailInboxListProfiles invokes email_inbox_list_profiles', async () => {
    const profiles = [{ id: 'p1' }];
    mockFetchOk(profiles);

    await expect(emailInboxListProfiles()).resolves.toEqual(profiles);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:25584/api/email_inbox_list_profiles',
      expect.objectContaining({ body: JSON.stringify({}) }),
    );
  });

  it('emailInboxGetProfile invokes email_inbox_get_profile', async () => {
    const profile = { id: 'p1' };
    mockFetchOk(profile);

    await expect(emailInboxGetProfile('p1')).resolves.toEqual(profile);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:25584/api/email_inbox_get_profile',
      expect.objectContaining({ body: JSON.stringify({ profileId: 'p1' }) }),
    );
  });

  it('emailInboxUpsertProfile invokes email_inbox_upsert_profile', async () => {
    const input = {
      id: null,
      label: 'Profile',
      connectInput: {
        provider: 'imap' as const,
        accountId: 'acc-1',
        credentials: {
          type: 'imap' as const,
          value: {
            host: 'imap.gmail.com',
            port: 993,
            username: 'u@gmail.com',
            password: 'secret',
            useTls: true,
          },
        },
      },
    };
    const saved = { id: 'p1' };
    mockFetchOk(saved);

    await expect(emailInboxUpsertProfile(input)).resolves.toEqual(saved);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:25584/api/email_inbox_upsert_profile',
      expect.objectContaining({ body: JSON.stringify({ input }) }),
    );
  });

  it('emailInboxDeleteProfile invokes email_inbox_delete_profile', async () => {
    mockFetchOk(true);

    await expect(emailInboxDeleteProfile('p1')).resolves.toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:25584/api/email_inbox_delete_profile',
      expect.objectContaining({ body: JSON.stringify({ profileId: 'p1' }) }),
    );
  });

  it('emailInboxConnectProfile invokes email_inbox_connect_profile', async () => {
    const session = { sessionId: 's1' };
    mockFetchOk(session);

    await expect(emailInboxConnectProfile('p1')).resolves.toEqual(session);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:25584/api/email_inbox_connect_profile',
      expect.objectContaining({ body: JSON.stringify({ profileId: 'p1' }) }),
    );
  });

  it('emailInboxGetSyncState invokes email_inbox_get_sync_state', async () => {
    const syncState = { profileId: 'p1', status: 'idle' };
    mockFetchOk(syncState);

    await expect(emailInboxGetSyncState('p1')).resolves.toEqual(syncState);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:25584/api/email_inbox_get_sync_state',
      expect.objectContaining({ body: JSON.stringify({ profileId: 'p1' }) }),
    );
  });

  it('emailInboxUpsertSyncState invokes email_inbox_upsert_sync_state', async () => {
    const input = { profileId: 'p1', status: 'syncing' as const };
    const saved = { profileId: 'p1', status: 'syncing' };
    mockFetchOk(saved);

    await expect(emailInboxUpsertSyncState(input)).resolves.toEqual(saved);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:25584/api/email_inbox_upsert_sync_state',
      expect.objectContaining({ body: JSON.stringify({ input }) }),
    );
  });
});
