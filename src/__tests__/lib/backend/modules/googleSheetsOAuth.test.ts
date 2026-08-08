import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

const originalFetch = globalThis.fetch;

function mockFetchOnce(response: unknown, ok = true) {
  globalThis.fetch = jest.fn<any>().mockResolvedValue({
    ok,
    status: ok ? 200 : 500,
    json: () => Promise.resolve(response),
  }) as unknown as typeof fetch;
}

const MODULE_PATH = '../../../../lib/backend/modules/googleSheets';

describe('googleSheets OAuth commands', () => {
  // Re-imported fresh in beforeEach to clear the module-level response cache
  // in invoke.ts (added by the same-origin migration) between tests.
  let getGoogleOAuthStatus: typeof import('../../../../lib/backend/modules/googleSheets')['getGoogleOAuthStatus'];
  let startGoogleOAuth: typeof import('../../../../lib/backend/modules/googleSheets')['startGoogleOAuth'];
  let disconnectGoogleOAuth: typeof import('../../../../lib/backend/modules/googleSheets')['disconnectGoogleOAuth'];

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    const mod = require(MODULE_PATH);
    getGoogleOAuthStatus = mod.getGoogleOAuthStatus;
    startGoogleOAuth = mod.startGoogleOAuth;
    disconnectGoogleOAuth = mod.disconnectGoogleOAuth;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('startGoogleOAuth posts to start_google_oauth with empty args', async () => {
    mockFetchOnce({ authUrl: 'https://accounts.google.com/o/oauth2/auth?state=abc', state: 'abc' });

    const result = await startGoogleOAuth();

    expect(result).toEqual({
      authUrl: 'https://accounts.google.com/o/oauth2/auth?state=abc',
      state: 'abc',
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/start_google_oauth',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({}),
      })
    );
  });

  it('disconnectGoogleOAuth posts to disconnect_google_oauth', async () => {
    mockFetchOnce({ success: true });

    const result = await disconnectGoogleOAuth();

    expect(result).toEqual({ success: true });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/disconnect_google_oauth',
      expect.objectContaining({ body: JSON.stringify({}) })
    );
  });

  it('getGoogleOAuthStatus returns connected + email', async () => {
    mockFetchOnce({ connected: true, email: 'user@gmail.com' });

    const result = await getGoogleOAuthStatus();

    expect(result).toEqual({ connected: true, email: 'user@gmail.com' });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/get_google_oauth_status',
      expect.objectContaining({ body: JSON.stringify({}) })
    );
  });

  it('getGoogleOAuthStatus returns disconnected when not connected', async () => {
    mockFetchOnce({ connected: false, email: null });

    const result = await getGoogleOAuthStatus();

    expect(result).toEqual({ connected: false, email: null });
  });

  it('startGoogleOAuth surfaces BackendError on failure', async () => {
    globalThis.fetch = jest.fn<any>().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ message: 'oauth not configured' }),
    }) as unknown as typeof fetch;

    await expect(startGoogleOAuth()).rejects.toThrow(/oauth not configured/);
  });
});
