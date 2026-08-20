import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import {
  startOpenAIAutoregJob,
  getProviders,
  type ProviderInfo,
} from '../../../../lib/backend/modules/registration';

const originalFetch = globalThis.fetch;

const mockFetchOk = (data: unknown) => {
  globalThis.fetch = jest.fn<any>().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
  }) as unknown as typeof fetch;
};

describe('lib/Backend/modules/registration OpenAI contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('startOpenAIAutoregJob invokes start_openai_autoreg_job with { config }', async () => {
    const config = {
      email: 'u@example.com',
      password: null,
      name: null,
      emailStrategy: 'mailtm',
      baseEmail: 'u@example.com',
      headless: true,
      proxyUrl: null,
      imapServer: 'imap.gmail.com',
      imapPort: 993,
      imapUser: 'u@gmail.com',
      imapPassword: '********',
      addyioEnabled: null,
      addyioApiToken: null,
      addyioDomain: null,
      addyioAliasFormat: null,
      addyioAutoDelete: null,
      mailtmEnabled: null,
      thirtyThreeMailEnabled: null,
      thirtyThreeMailUsername: null,
      thirtyThreeMailDomain: null,
    };
    const result = { jobId: 'job-openai-1' };

    mockFetchOk(result);

    await expect(startOpenAIAutoregJob(config)).resolves.toEqual(result);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/start_openai_autoreg_job',
      expect.objectContaining({
        body: JSON.stringify({ config }),
      }),
    );
  });
});

describe('lib/Backend/modules/registration getProviders contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('getProviders invokes get_providers with no args and returns the providers array', async () => {
    const providers: ProviderInfo[] = [
      { id: 'kiro_v2', displayName: 'Kiro v2', requiresMachineId: true },
      { id: 'aws', displayName: 'AWS', requiresMachineId: false },
    ];
    mockFetchOk({ providers });

    await expect(getProviders()).resolves.toEqual(providers);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/get_providers',
      expect.objectContaining({ body: JSON.stringify({}) }),
    );
  });

  it('getProviders returns empty array when no provider plugins installed', async () => {
    // safeInvoke caches responses for 50ms; wait for the cache to expire
    // before re-mocking fetch so this test gets its own response.
    await new Promise(resolve => setTimeout(resolve, 60));
    mockFetchOk({ providers: [] });

    await expect(getProviders()).resolves.toEqual([]);
  });
});
