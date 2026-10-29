/**
 * Contract tests for lib/backend/modules/community.ts
 *
 * Goal: lock down frontend<->backend invoke command names + arg shapes.
 * Mocks global.fetch (HTTP backend via safeInvoke).
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import {
  getCommunityCatalog,
  installCommunityPlugin,
  uninstallCommunityPlugin,
  listInstalledCommunity,
  listLocalPackages,
  submitForReview,
  type CommunityCatalogPlugin,
} from '../../../../lib/backend/modules/community';

const originalFetch = globalThis.fetch;

const mockFetchOk = (data: unknown) => {
  globalThis.fetch = jest.fn<any>().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
  }) as unknown as typeof fetch;
};

describe('lib/backend/modules/community', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('getCommunityCatalog invokes get_community_catalog with no args', async () => {
    const plugins: CommunityCatalogPlugin[] = [
      {
        id: 'p1',
        name: 'Demo Plugin',
        version: '1.0.0',
        author: 'alice',
        description: 'A demo plugin',
        path: '/plugins/demo',
        services: ['kiro'],
        sha256: 'abc123',
      },
    ];
    mockFetchOk({ plugins });

    await expect(getCommunityCatalog()).resolves.toEqual({ plugins });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/get_community_catalog',
      expect.objectContaining({ body: JSON.stringify({}) }),
    );
  });

  it('installCommunityPlugin invokes install_community_plugin with { id, version }', async () => {
    mockFetchOk({ success: true });

    await expect(
      installCommunityPlugin({ id: 'p1', version: '1.0.0' }),
    ).resolves.toEqual({ success: true });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/install_community_plugin',
      expect.objectContaining({ body: JSON.stringify({ id: 'p1', version: '1.0.0' }) }),
    );
  });

  it('installCommunityPlugin returns error field when backend reports failure', async () => {
    mockFetchOk({ success: false, error: 'already installed' });

    await expect(
      installCommunityPlugin({ id: 'p2', version: '2.0.0' }),
    ).resolves.toEqual({ success: false, error: 'already installed' });
  });

  it('uninstallCommunityPlugin invokes uninstall_community_plugin with { id } when version omitted', async () => {
    mockFetchOk({ success: true });

    await expect(
      uninstallCommunityPlugin({ id: 'p3' }),
    ).resolves.toEqual({ success: true });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/uninstall_community_plugin',
      expect.objectContaining({ body: JSON.stringify({ id: 'p3' }) }),
    );
  });

  it('uninstallCommunityPlugin invokes uninstall_community_plugin with { id, version } when version provided', async () => {
    mockFetchOk({ success: true });

    await expect(
      uninstallCommunityPlugin({ id: 'p4', version: '3.0.0' }),
    ).resolves.toEqual({ success: true });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/uninstall_community_plugin',
      expect.objectContaining({
        body: JSON.stringify({ id: 'p4', version: '3.0.0' }),
      }),
    );
  });

  it('listInstalledCommunity invokes list_installed_community with no args', async () => {
    mockFetchOk({
      packages: [{ id: 'p1', version: '1.0.0', services: ['kiro'], name: 'Demo' }],
    });

    await expect(listInstalledCommunity()).resolves.toEqual({
      packages: [{ id: 'p1', version: '1.0.0', services: ['kiro'], name: 'Demo' }],
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/list_installed_community',
      expect.objectContaining({ body: JSON.stringify({}) }),
    );
  });

  it('listLocalPackages invokes list_local_packages with no args', async () => {
    mockFetchOk({
      packages: [
        { id: 'local1', name: 'My Plugin', version: '0.1.0', services: [], path: '/dev' },
      ],
    });

    await expect(listLocalPackages()).resolves.toEqual({
      packages: [
        { id: 'local1', name: 'My Plugin', version: '0.1.0', services: [], path: '/dev' },
      ],
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/list_local_packages',
      expect.objectContaining({ body: JSON.stringify({}) }),
    );
  });

  it('submitForReview invokes submit_for_review with { package_id, github_token }', async () => {
    mockFetchOk({ success: true, pr_url: 'https://github.com/owner/repo/pull/1' });

    await expect(
      submitForReview({ package_id: 'local1', github_token: 'ghp_abc' }),
    ).resolves.toEqual({
      success: true,
      pr_url: 'https://github.com/owner/repo/pull/1',
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/submit_for_review',
      expect.objectContaining({
        body: JSON.stringify({ package_id: 'local1', github_token: 'ghp_abc' }),
      }),
    );
  });

  it('submitForReview returns error field when backend reports failure', async () => {
    mockFetchOk({ success: false, error: 'invalid token' });

    await expect(
      submitForReview({ package_id: 'local2', github_token: 'bad' }),
    ).resolves.toEqual({ success: false, error: 'invalid token' });
  });
});
