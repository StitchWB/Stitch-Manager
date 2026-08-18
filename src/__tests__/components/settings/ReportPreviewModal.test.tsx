/**
 * Tests for ReportPreviewModal — long-string truncation in the JSON preview.
 *
 * The modal must NOT dump 500 KB base64 blobs inline. Strings longer than
 * MAX_INLINE_STRING (300 chars) are replaced with a size placeholder like
 * "<screenshot_b64: 488.3 KB>" while keeping the JSON key visible.
 */

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, waitFor } from '@testing-library/react';
import { ReportPreviewModal } from '../../../components/settings/ReportPreviewModal';

const originalFetch = globalThis.fetch;

function mockFetchOk(data: unknown) {
  globalThis.fetch = jest.fn<any>().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
  }) as unknown as typeof fetch;
}

describe('ReportPreviewModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('truncates long base64 strings in the bundle JSON preview', async () => {
    const longBase64 = 'x'.repeat(400_000); // > 300 chars → truncated
    const shortHtml = '<html>short</html>'; // < 300 chars → kept
    const preview = {
      id: 'r1',
      bundle: {
        schema: 'stitch.report/v1',
        plugin_id: 'kiro-autoreg',
        step: 'fill_email',
        error: 'fill: element not found',
        artifacts: {
          fill_email: {
            screenshot_b64: longBase64,
            html: shortHtml,
          },
        },
      },
      sensitive_dropped: false,
    };
    mockFetchOk(preview);

    const { container } = render(
      <ReportPreviewModal
        reportId="r1"
        onClose={jest.fn()}
        onActionComplete={jest.fn()}
        consentOn={true}
      />,
    );

    const pre = await waitFor(() => {
      const el = container.querySelector('pre');
      expect(el).toBeTruthy();
      return el!;
    });
    const text = pre.textContent || '';

    // Long string replaced with a size placeholder.
    expect(text).not.toContain(longBase64);
    expect(text).toContain('<screenshot_b64:');
    expect(text).toContain('KB>');

    // Short string kept as-is.
    expect(text).toContain(shortHtml);

    // JSON key still visible.
    expect(text).toContain('screenshot_b64');
    expect(text).toContain('fill_email');
  });

  it('keeps short strings under the threshold unchanged', async () => {
    const preview = {
      id: 'r2',
      bundle: {
        schema: 'stitch.report/v1',
        step: 'click_submit',
        error: 'click: element not found',
        matched_candidate: 2,
      },
      sensitive_dropped: false,
    };
    mockFetchOk(preview);

    const { container } = render(
      <ReportPreviewModal
        reportId="r2"
        onClose={jest.fn()}
        onActionComplete={jest.fn()}
        consentOn={true}
      />,
    );

    const pre = await waitFor(() => {
      const el = container.querySelector('pre');
      expect(el).toBeTruthy();
      return el!;
    });
    const text = pre.textContent || '';

    expect(text).toContain('click: element not found');
    expect(text).toContain('stitch.report/v1');
    expect(text).not.toContain('<');
    expect(text).not.toContain('KB>');
  });
});
