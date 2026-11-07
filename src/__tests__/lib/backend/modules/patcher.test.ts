import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import * as patcherModule from '../../../../lib/backend/modules/patcher';
import {
  detectIDEs,
  getPatchStatus,
  patchIDE,
  unpatchIDE,
  listBackups,
  restoreBackup,
  deleteBackup,
  launchIDE,
} from '../../../../lib/backend/modules/patcher';

const originalFetch = globalThis.fetch;

const mockFetchOk = (data: unknown) => {
  globalThis.fetch = jest.fn<() => Promise<unknown>>().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
  }) as unknown as typeof fetch;
};

describe('lib/backend/modules/patcher', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('detectIDEs invokes detect_ides with { force }', async () => {
    const ides: unknown[] = [];
    mockFetchOk(ides);

    await expect(detectIDEs(true)).resolves.toEqual(ides);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/detect_ides',
      expect.objectContaining({ body: JSON.stringify({ force: true }) }),
    );
  });

  it('getPatchStatus invokes get_patch_status with { ideType }', async () => {
    const status = { ideId: 'kiro', status: 'unpatched' };
    mockFetchOk(status);

    await expect(getPatchStatus({ ideId: 'kiro' })).resolves.toEqual(status);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/get_patch_status',
      expect.objectContaining({ body: JSON.stringify({ ideType: 'kiro' }) }),
    );
  });

  it('patchIDE invokes apply_patch with { ideType, strategy, createBackup }', async () => {
    const result = { success: true, message: 'ok', backupPath: null };
    mockFetchOk(result);

    await expect(patchIDE({ ideId: 'kiro' })).resolves.toEqual(result);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/apply_patch',
      expect.objectContaining({
        body: JSON.stringify({ ideType: 'kiro', strategy: 'injection', createBackup: true }),
      }),
    );
  });

  it('unpatchIDE invokes remove_patch with { ideType }', async () => {
    const result = { success: true, message: 'ok', backupPath: null };
    mockFetchOk(result);

    await expect(unpatchIDE({ ideId: 'windsurf' })).resolves.toEqual(result);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/remove_patch',
      expect.objectContaining({ body: JSON.stringify({ ideType: 'windsurf' }) }),
    );
  });

  it('listBackups preserves backend filename ID and size for delete and restore', async () => {
    const backups = [
      {
        id: 'kiro_extension_20260101.bak',
        path: '/backups/kiro_extension_20260101.bak',
        createdAt: '2026-01-01T00:00:00Z',
        size: 1024,
      },
    ];
    mockFetchOk(backups);

    const result = await listBackups({ ideId: 'kiro' });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('kiro_extension_20260101.bak');
    expect(result[0].size).toBe(1024);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/list_backups',
      expect.objectContaining({ body: JSON.stringify({ ideType: 'kiro' }) }),
    );
  });

  it('restoreBackup invokes restore_backup with { backupId }', async () => {
    const result = { success: true, message: 'ok', backupPath: null };
    mockFetchOk(result);

    await expect(restoreBackup({ backupId: 'kiro_extension_20260101.bak' })).resolves.toEqual(result);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/restore_backup',
      expect.objectContaining({ body: JSON.stringify({ backupId: 'kiro_extension_20260101.bak' }) }),
    );
  });

  it('deleteBackup invokes delete_backup with { backupId }', async () => {
    mockFetchOk(undefined);

    await expect(deleteBackup({ backupId: 'kiro_extension_20260101.bak' })).resolves.toBeUndefined();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/delete_backup',
      expect.objectContaining({ body: JSON.stringify({ backupId: 'kiro_extension_20260101.bak' }) }),
    );
  });

  it('launchIDE invokes launch_ide with { ideId }', async () => {
    mockFetchOk(undefined);

    await expect(launchIDE('kiro')).resolves.toBeUndefined();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/launch_ide',
      expect.objectContaining({ body: JSON.stringify({ ideId: 'kiro' }) }),
    );
  });

  it('exposes no legacy Trae RPC surface', () => {
    const exports = Object.keys(patcherModule);
    for (const legacy of [
      'isTraePatched',
      'patchTraeFull',
      'isTraeExtensionPatched',
      'isTraeWorkbenchPatched',
    ]) {
      expect(exports).not.toContain(legacy);
    }
  });
});
