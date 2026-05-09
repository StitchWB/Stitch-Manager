import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { useMailStore } from '../../stores/mail';

const mockInvoke = jest.fn() as jest.MockedFunction<typeof import('@tauri-apps/api/core').invoke>;
jest.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: Parameters<typeof mockInvoke>) => mockInvoke(...args),
}));

describe('mail store', () => {
  beforeEach(() => {
    const store = useMailStore.getState();
    store.disconnect();
    useMailStore.setState({
      source: 'imap',
      accountId: '',
      mailbox: 'INBOX',
      imapCredentials: {
        host: '',
        port: 993,
        username: '',
        password: '',
        useTls: true,
      },
      mailTmCredentials: {
        address: '',
        password: '',
        baseUrl: '',
      },
      availableFolders: [],
      selectedFolder: null,
      connectedMailbox: null,
      session: null,
      capabilities: null,
      messages: [],
      selectedMessageId: null,
      query: {
        from: '',
        to: '',
        subjectContains: '',
        bodyContains: '',
        unreadOnly: true,
        since: '',
        limit: 50,
      },
      sync: {
        timeoutMs: 120000,
        pollIntervalMs: 3000,
        dedupeKey: 'mail-page',
      },
      lastSyncAt: null,
      isConnecting: false,
      isSyncing: false,
      isWaiting: false,
      isMutating: false,
      isLoadingMessage: false,
      error: null,
      profiles: [],
      activeProfileId: null,
      profileSyncMap: {},
      providerCatalog: [],
      isProfilesLoading: false,
      isProfileSaving: false,
      isProfileMutating: false,
    });
    
    mockInvoke.mockReset();
  });

  describe('connect action', () => {
    it('calls emailInboxUpsertProfile when connect succeeds with no activeProfileId', async () => {
      const store = useMailStore.getState();
      
      store.setAccountId('test@example.com');
      store.setImapCredentials({
        host: 'imap.gmail.com',
        port: 993,
        username: 'test@example.com',
        password: 'password',
        useTls: true,
      });
      
      expect(store.activeProfileId).toBeNull();
      
      const session = {
        sessionId: 's1',
        provider: 'imap',
        accountId: 'test@example.com',
        capabilities: {
          canDelete: true,
          canMarkAsRead: true,
          canSearchBody: true,
          canDownloadAttachments: true,
          canListFolders: true,
        },
        connectedAt: '2026-03-09T00:00:00Z',
      };
      
      const capabilities = {
        canDelete: true,
        canMarkAsRead: true,
        canSearchBody: true,
        canDownloadAttachments: true,
        canListFolders: true,
      };
      
      const profile = {
        id: 'p1',
        label: 'IMAP · test@example.com',
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
      };
      
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === 'email_inbox_connect') return session;
        if (cmd === 'email_inbox_get_capabilities') return capabilities;
        if (cmd === 'email_inbox_list_folders') return [];
        if (cmd === 'email_inbox_upsert_profile') return profile;
        if (cmd === 'email_inbox_get_sync_state') return null;
        throw new Error(`Unexpected command: ${cmd}`);
      });
      
      await store.connect();
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const upsertCalls = mockInvoke.mock.calls.filter(call => call[0] === 'email_inbox_upsert_profile');
      expect(upsertCalls.length).toBeGreaterThan(0);
      
      const upsertCall = upsertCalls[0];
      expect(upsertCall[1].input.label).toMatch(/IMAP · test@example\.com/);
    });

    it('does NOT call emailInboxUpsertProfile when connect succeeds WITH activeProfileId', async () => {
      const store = useMailStore.getState();
      
      useMailStore.setState({
        activeProfileId: 'existing-profile-id',
        profiles: [{
          id: 'existing-profile-id',
          label: 'Existing Profile',
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
        }],
      });
      
      store.setAccountId('test@example.com');
      store.setImapCredentials({
        host: 'imap.gmail.com',
        port: 993,
        username: 'test@example.com',
        password: 'password',
        useTls: true,
      });
      
      expect(useMailStore.getState().activeProfileId).toBe('existing-profile-id');
      
      const session = {
        sessionId: 's1',
        provider: 'imap',
        accountId: 'test@example.com',
        capabilities: {
          canDelete: true,
          canMarkAsRead: true,
          canSearchBody: true,
          canDownloadAttachments: true,
          canListFolders: true,
        },
        connectedAt: '2026-03-09T00:00:00Z',
      };
      
      const capabilities = {
        canDelete: true,
        canMarkAsRead: true,
        canSearchBody: true,
        canDownloadAttachments: true,
        canListFolders: true,
      };
      
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === 'email_inbox_connect_profile') return session;
        if (cmd === 'email_inbox_get_capabilities') return capabilities;
        if (cmd === 'email_inbox_list_folders') return [];
        throw new Error(`Unexpected command: ${cmd}`);
      });
      
      await store.connect();
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const upsertCalls = mockInvoke.mock.calls.filter(call => call[0] === 'email_inbox_upsert_profile');
      expect(upsertCalls.length).toBe(0);
    });

    it('logs warning but does not fail connect when auto-save fails', async () => {
      const store = useMailStore.getState();
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      
      store.setAccountId('test@example.com');
      store.setImapCredentials({
        host: 'imap.gmail.com',
        port: 993,
        username: 'test@example.com',
        password: 'password',
        useTls: true,
      });
      
      expect(store.activeProfileId).toBeNull();
      
      const session = {
        sessionId: 's1',
        provider: 'imap',
        accountId: 'test@example.com',
        capabilities: {
          canDelete: true,
          canMarkAsRead: true,
          canSearchBody: true,
          canDownloadAttachments: true,
          canListFolders: true,
        },
        connectedAt: '2026-03-09T00:00:00Z',
      };
      
      const capabilities = {
        canDelete: true,
        canMarkAsRead: true,
        canSearchBody: true,
        canDownloadAttachments: true,
        canListFolders: true,
      };
      
      mockInvoke.mockImplementation(async (cmd: string) => {
        if (cmd === 'email_inbox_connect') return session;
        if (cmd === 'email_inbox_get_capabilities') return capabilities;
        if (cmd === 'email_inbox_list_folders') return [];
        if (cmd === 'email_inbox_upsert_profile') throw new Error('Profile save failed');
        throw new Error(`Unexpected command: ${cmd}`);
      });
      
      await expect(store.connect()).resolves.not.toThrow();
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Auto-save session as profile failed:',
        'Profile save failed'
      );
      
      expect(useMailStore.getState().session).toEqual(session);
      
      consoleWarnSpy.mockRestore();
    });
  });
});