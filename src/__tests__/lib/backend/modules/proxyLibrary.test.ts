import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import {
  listProxyLibrary,
  createProxyLibraryEntry,
  createOrGetProxyLibraryEntry,
  updateProxyLibraryEntry,
  deleteProxyLibraryEntry,
  importProxyLibraryBulk,
  previewProxyLibraryBulk,
  getProxyLibraryRuntimeProxyUrl,
  getProxyLibraryRuntimeProxyMap,
  getProxyLibraryUsage,
  ensureProxySaveUseAllowed,
  parseProxyLibraryInput,
  testProxyLibraryDraft,
} from '../../../../lib/backend/modules/proxyLibrary';

const originalFetch = globalThis.fetch;

const mockFetchOk = (data: unknown) => {
  globalThis.fetch = jest.fn<any>().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
  }) as unknown as typeof fetch;
};

const mockFetchSequence = (responses: unknown[]) => {
  let idx = 0;
  globalThis.fetch = jest.fn<any>().mockImplementation(() => {
    const data = responses[idx++];
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(data) });
  }) as unknown as typeof fetch;
};

describe('lib/Backend/modules/proxyLibrary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('imports bulk proxies with request payload', async () => {
    mockFetchOk({
      totalLines: 2,
      imported: 1,
      skipped: 1,
      issues: [],
      items: [],
    });

    await importProxyLibraryBulk({
      text: '138.249.63.52:63942:NcyVVTzb:fqQDvDLA',
      defaultType: 'http',
      defaultEnabled: true,
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:25584/api/import_proxy_library_bulk',
      expect.objectContaining({
        body: JSON.stringify({
          request: {
            text: '138.249.63.52:63942:NcyVVTzb:fqQDvDLA',
            defaultType: 'http',
            defaultEnabled: true,
          },
        }),
      }),
    );
  });

  it('previews bulk proxies without importing', async () => {
    mockFetchOk({ totalLines: 1, imported: 1, skipped: 0, issues: [], items: [] });
    await previewProxyLibraryBulk({
      text: '1.2.3.4:8080',
      defaultType: 'http',
      defaultEnabled: true,
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:25584/api/preview_proxy_library_bulk',
      expect.objectContaining({
        body: JSON.stringify({
          request: {
            text: '1.2.3.4:8080',
            defaultType: 'http',
            defaultEnabled: true,
          },
        }),
      }),
    );
  });

  it('creates and updates entries with draft structure', async () => {
    mockFetchOk({ id: 'p1' });

    await createProxyLibraryEntry({
      label: 'A',
      host: '1.2.3.4',
      port: 8080,
      proxyType: 'http',
      enabled: true,
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:25584/api/create_proxy_library_entry',
      expect.objectContaining({
        body: JSON.stringify({
          draft: {
            label: 'A',
            host: '1.2.3.4',
            port: 8080,
            proxyType: 'http',
            enabled: true,
          },
        }),
      }),
    );

    await updateProxyLibraryEntry({
      id: 'p1',
      draft: {
        host: '5.6.7.8',
        port: 9090,
        proxyType: 'socks5',
        enabled: true,
      },
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:25584/api/update_proxy_library_entry',
      expect.objectContaining({
        body: JSON.stringify({
          request: {
            id: 'p1',
            draft: {
              host: '5.6.7.8',
              port: 9090,
              proxyType: 'socks5',
              enabled: true,
            },
          },
        }),
      }),
    );
  });

  it('creates or gets entry via dedicated command', async () => {
    mockFetchOk({ id: 'p2' });
    await createOrGetProxyLibraryEntry({
      host: '9.9.9.9',
      port: 9999,
      proxyType: 'http',
      enabled: true,
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:25584/api/create_or_get_proxy_library_entry',
      expect.objectContaining({
        body: JSON.stringify({
          draft: {
            host: '9.9.9.9',
            port: 9999,
            proxyType: 'http',
            enabled: true,
          },
        }),
      }),
    );
  });

  it('calls list/delete/runtime commands with expected args', async () => {
    mockFetchSequence([
      [],
      { changed: true, usage: { profileAliases: [], scenarioPaths: [] } },
      'http://1.2.3.4:8080',
      { p1: 'http://1.2.3.4:8080' },
      { profileAliases: ['a'], scenarioPaths: ['x.json'] },
    ]);

    await listProxyLibrary();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:25584/api/list_proxy_library',
      expect.objectContaining({ body: JSON.stringify({}) }),
    );

    await deleteProxyLibraryEntry({ id: 'p1' });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:25584/api/delete_proxy_library_entry',
      expect.objectContaining({
        body: JSON.stringify({ request: { id: 'p1', options: undefined } }),
      }),
    );

    await getProxyLibraryRuntimeProxyUrl('p1');
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:25584/api/get_proxy_library_runtime_proxy_url',
      expect.objectContaining({ body: JSON.stringify({ id: 'p1' }) }),
    );

    await getProxyLibraryRuntimeProxyMap();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:25584/api/get_proxy_library_runtime_proxy_map',
      expect.objectContaining({ body: JSON.stringify({}) }),
    );

    await getProxyLibraryUsage('p1');
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:25584/api/get_proxy_library_usage',
      expect.objectContaining({ body: JSON.stringify({ id: 'p1' }) }),
    );
  });

  it('parses proxy input through backend parser command', async () => {
    mockFetchOk({
      host: '1.2.3.4',
      port: 8080,
      proxyType: 'http',
      enabled: true,
    });
    await parseProxyLibraryInput({ raw: 'http://u:p@1.2.3.4:8080', defaultType: 'http' });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:25584/api/parse_proxy_library_input',
      expect.objectContaining({
        body: JSON.stringify({
          request: {
            raw: 'http://u:p@1.2.3.4:8080',
            defaultType: 'http',
          },
        }),
      }),
    );
  });

  it('tests proxy draft through backend command', async () => {
    mockFetchOk({ success: true, responseTimeMs: 123 });
    await testProxyLibraryDraft(
      {
        host: '1.2.3.4',
        port: 8080,
        proxyType: 'http',
        enabled: true,
      },
      {
        proxyLibraryId: 'p1',
        persistResult: true,
      }
    );
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:25584/api/test_proxy_library_draft',
      expect.objectContaining({
        body: JSON.stringify({
          request: {
            draft: {
              host: '1.2.3.4',
              port: 8080,
              proxyType: 'http',
              enabled: true,
            },
            proxyLibraryId: 'p1',
            persistResult: true,
          },
        }),
      }),
    );
  });

  it('checks save/use guard by proxy id', async () => {
    mockFetchOk(true);
    await ensureProxySaveUseAllowed({ proxyLibraryId: 'p1', maxAgeSeconds: 300 });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:25584/api/ensure_proxy_save_use_allowed',
      expect.objectContaining({
        body: JSON.stringify({
          request: {
            proxyLibraryId: 'p1',
            maxAgeSeconds: 300,
          },
        }),
      }),
    );
  });
});
