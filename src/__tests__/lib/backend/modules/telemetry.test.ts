/**
 * Contract tests for lib/backend/modules/telemetry.ts
 *
 * Goal: lock down frontend<->backend invoke command names + arg shapes.
 * Mocks global.fetch (HTTP backend via safeInvoke).
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import {
  getPendingReports,
  getReportPreview,
  sendReport,
  discardReport,
  type PendingReport,
} from '../../../../lib/backend/modules/telemetry';

const originalFetch = globalThis.fetch;

const mockFetchOk = (data: unknown) => {
  globalThis.fetch = jest.fn<any>().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
  }) as unknown as typeof fetch;
};

describe('lib/backend/modules/telemetry', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('getPendingReports invokes get_pending_reports with no args', async () => {
    const reports: PendingReport[] = [
      {
        id: 'r1',
        plugin_id: 'kiro',
        version: '1.0.0',
        step: 'login',
        step_kind: 'action',
        created_at: '2025-01-01T00:00:00Z',
        scrubbed: true,
        size_bytes: 1024,
        error_preview: 'timeout',
      },
    ];
    mockFetchOk({ reports });

    await expect(getPendingReports()).resolves.toEqual({ reports });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/get_pending_reports',
      expect.objectContaining({ body: JSON.stringify({}) }),
    );
  });

  it('getReportPreview invokes get_report_preview with { id }', async () => {
    const preview = {
      id: 'r1',
      bundle: { error: 'timeout', step: 'login' },
      sensitive_dropped: true,
    };
    mockFetchOk(preview);

    await expect(getReportPreview({ id: 'r1' })).resolves.toEqual(preview);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/get_report_preview',
      expect.objectContaining({ body: JSON.stringify({ id: 'r1' }) }),
    );
  });

  it('sendReport invokes send_report with { id }', async () => {
    mockFetchOk({ success: true });

    await expect(sendReport({ id: 'r1' })).resolves.toEqual({ success: true });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/send_report',
      expect.objectContaining({ body: JSON.stringify({ id: 'r1' }) }),
    );
  });

  it('sendReport returns error field when backend reports failure', async () => {
    mockFetchOk({ success: false, error: 'network unreachable' });

    await expect(sendReport({ id: 'r2' })).resolves.toEqual({
      success: false,
      error: 'network unreachable',
    });
  });

  it('discardReport invokes discard_report with { id }', async () => {
    mockFetchOk({ success: true });

    await expect(discardReport({ id: 'r1' })).resolves.toEqual({ success: true });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/discard_report',
      expect.objectContaining({ body: JSON.stringify({ id: 'r1' }) }),
    );
  });

  it('discardReport returns error field when backend reports failure', async () => {
    mockFetchOk({ success: false, error: 'not found' });

    await expect(discardReport({ id: 'r3' })).resolves.toEqual({
      success: false,
      error: 'not found',
    });
  });
});
