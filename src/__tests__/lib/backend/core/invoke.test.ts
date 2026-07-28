/**
 * Unit tests for core/invoke.ts — mocks global.fetch (HTTP backend).
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { safeInvoke, safeInvokeWithRetry, batchInvoke } from '../../../../lib/backend/core/invoke';
import { BackendError } from '../../../../lib/backend/core/types';

// Helper: create a mock fetch response
const mockFetchOk = (data: unknown): typeof fetch =>
  jest.fn<any>().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
  }) as unknown as typeof fetch;

const mockFetchError = (status: number, data: unknown): typeof fetch =>
  jest.fn<any>().mockResolvedValue({
    ok: false,
    status,
    json: () => Promise.resolve(data),
  }) as unknown as typeof fetch;

const originalFetch = globalThis.fetch;

describe('safeInvoke', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should successfully invoke a command and return result', async () => {
    const mockResult = { id: 1, name: 'Test Account' };
    globalThis.fetch = mockFetchOk(mockResult) as typeof fetch;

    const result = await safeInvoke('get_account', { id: 1 });

    expect(result).toEqual(mockResult);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:25584/api/get_account',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ id: 1 }),
      }),
    );
  });

  it('should handle Error objects and wrap in BackendError', async () => {
    globalThis.fetch = mockFetchError(500, { message: 'Command failed' }) as typeof fetch;

    await expect(safeInvoke('failing_command')).rejects.toThrow(BackendError);
  });

  it('should handle string errors and wrap in BackendError', async () => {
    globalThis.fetch = mockFetchError(400, { message: 'String error message' }) as typeof fetch;

    await expect(safeInvoke('failing_command')).rejects.toThrow(BackendError);
  });

  it('should handle unknown error types', async () => {
    globalThis.fetch = mockFetchError(500, { custom: 'error' }) as typeof fetch;

    await expect(safeInvoke('failing_command')).rejects.toThrow(BackendError);
  });

  it('should pass command arguments correctly', async () => {
    globalThis.fetch = mockFetchOk([]) as typeof fetch;

    const args = { provider: 'kiro', limit: 10 };
    await safeInvoke('list_accounts', args);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:25584/api/list_accounts',
      expect.objectContaining({
        body: JSON.stringify(args),
      }),
    );
  });

  it('should work without arguments', async () => {
    globalThis.fetch = mockFetchOk({ status: 'ok' }) as typeof fetch;

    const result = await safeInvoke('get_status');

    expect(result).toEqual({ status: 'ok' });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://localhost:25584/api/get_status',
      expect.objectContaining({
        body: JSON.stringify({}),
      }),
    );
  });

  it('should detect backend offline (connection refused)', async () => {
    globalThis.fetch = jest.fn<any>().mockRejectedValue(new TypeError('Failed to fetch')) as unknown as typeof fetch;

    await expect(safeInvoke('some_command')).rejects.toThrow(BackendError);
    await expect(safeInvoke('some_command')).rejects.toMatchObject({
      code: 'BACKEND_OFFLINE',
    });
  });
});

describe('safeInvokeWithRetry', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    globalThis.fetch = originalFetch;
  });

  it('should succeed on first attempt', async () => {
    const mockResult = { success: true };
    globalThis.fetch = mockFetchOk(mockResult) as typeof fetch;

    const result = await safeInvokeWithRetry('test_command', {}, 3, 1000);

    expect(result).toEqual(mockResult);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('should retry on failure and eventually succeed', async () => {
    let callCount = 0;
    globalThis.fetch = jest.fn<any>().mockImplementation(() => {
      callCount++;
      if (callCount < 3) {
        return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ message: 'fail' }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ success: true }) });
    }) as unknown as typeof fetch;

    const promise = safeInvokeWithRetry('test_command', {}, 3, 1000);

    // Fast-forward through retry delays
    await jest.runAllTimersAsync();

    const result = await promise;

    expect(result).toEqual({ success: true });
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });

  it('should throw after max retries exceeded', async () => {
    globalThis.fetch = mockFetchError(500, { message: 'Persistent failure' }) as typeof fetch;

    const promise = safeInvokeWithRetry('test_command', {}, 2, 500);

    const assertion = expect(promise).rejects.toThrow(BackendError);

    await jest.runAllTimersAsync();

    await assertion;
    expect(globalThis.fetch).toHaveBeenCalledTimes(3); // Initial + 2 retries
  });
});

describe('batchInvoke', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should invoke multiple commands in parallel', async () => {
    const results = [
      { id: 1, name: 'Account 1' },
      { id: 2, name: 'Account 2' },
      { id: 3, name: 'Account 3' },
    ];

    let callIndex = 0;
    globalThis.fetch = jest.fn().mockImplementation(() => {
      const data = results[callIndex++];
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(data) });
    }) as typeof fetch;

    const commands = [
      { command: 'get_account', args: { id: 1 } },
      { command: 'get_account', args: { id: 2 } },
      { command: 'get_account', args: { id: 3 } },
    ];

    const batchResults = await batchInvoke(commands);

    expect(batchResults).toEqual(results);
    expect(globalThis.fetch).toHaveBeenCalledTimes(3);
  });

  it('should handle empty command array', async () => {
    globalThis.fetch = mockFetchOk({}) as typeof fetch;

    const results = await batchInvoke([]);

    expect(results).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('should fail if any command fails', async () => {
    let callIndex = 0;
    globalThis.fetch = jest.fn<any>().mockImplementation(() => {
      callIndex++;
      if (callIndex === 2) {
        return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ message: 'Command 2 failed' }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ success: true }) });
    }) as unknown as typeof fetch;

    const commands = [{ command: 'cmd1' }, { command: 'cmd2' }, { command: 'cmd3' }];

    await expect(batchInvoke(commands)).rejects.toThrow(BackendError);
  });
});
