import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import {
  modelSyncApply,
  modelSyncCatalog,
  modelSyncPreview,
  modelSyncRestore,
  modelSyncStatus,
} from '../../../../lib/backend/modules/modelSync';

const originalFetch = globalThis.fetch;

const mockFetchOk = (data: unknown) => {
  globalThis.fetch = jest.fn<any>().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
  }) as unknown as typeof fetch;
};

function lastBody(): Record<string, unknown> {
  const call = (globalThis.fetch as jest.Mock).mock.calls.at(-1);
  return JSON.parse((call?.[1] as { body: string }).body) as Record<string, unknown>;
}

describe('lib/backend/modules/modelSync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('modelSyncCatalog invokes model_sync_catalog with empty params', async () => {
    const response = { ok: true, models: [], count: 0 };
    mockFetchOk(response);

    await expect(modelSyncCatalog()).resolves.toEqual(response);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/model_sync_catalog',
      expect.objectContaining({ body: JSON.stringify({}) }),
    );
  });

  it('modelSyncStatus passes only the documented path overrides', async () => {
    mockFetchOk({ ok: true });

    await modelSyncStatus({ opencodeConfigPath: '/tmp/opencode.json' });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/model_sync_status',
      expect.objectContaining({
        body: JSON.stringify({ opencodeConfigPath: '/tmp/opencode.json' }),
      }),
    );
  });

  it('modelSyncPreview sends the exact top-level plan shape', async () => {
    mockFetchOk({ ok: true, expectedSha256: {} });
    const params = {
      targets: ['opencode', 'omp'],
      models: ['gpt-4.1', 'vision-best'],
      schema: 'v1',
      opencodeConfigPath: '/tmp/opencode.json',
      opencodeConfigDir: '/tmp',
      defaultModel: 'stitch/gpt-4.1',
      ompProfile: 'work',
      pruneUnselected: true,
      roles: [
        { role: 'default', model: 'gpt-4.1', effort: 'high' },
        { role: 'vision', model: 'vision-best' },
      ],
      ensureEnabled: true,
      ompModelsPath: '/tmp/models.yml',
      ompConfigPath: '/tmp/config.yml',
    } as const;

    await modelSyncPreview(params as any);
    expect(lastBody()).toEqual(params);
  });

  it('modelSyncApply sends plan fields plus expectedSha256 unchanged', async () => {
    mockFetchOk({ ok: true, files: [] });
    const expectedSha256 = { '/tmp/opencode.json': 'abc', '/tmp/models.yml': null };
    const params = {
      targets: ['opencode'],
      models: ['gpt-4.1'],
      schema: 'auto',
      pruneUnselected: false,
      ensureEnabled: false,
      expectedSha256,
    } as const;

    await modelSyncApply(params as any);
    expect(lastBody()).toEqual(params);
  });

  it('modelSyncRestore sends entries unchanged', async () => {
    mockFetchOk({ ok: true, files: [] });
    const params = {
      entries: [
        {
          path: '/tmp/opencode.json',
          backupPath: '/tmp/opencode.json.bak',
          expectedSha256: 'abc',
        },
      ],
    };

    await modelSyncRestore(params);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/model_sync_restore',
      expect.objectContaining({ body: JSON.stringify(params) }),
    );
  });
});
