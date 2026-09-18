/**
 * CompressionSection contract test: the section must POST the backend's
 * field names.  Regression: it used to post `compression_enabled` while
 * `/api/compression/config` requires `enabled` → 422 → "save failed" toast.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';

jest.mock('@/lib/i18n', () => ({ t: (k: string) => k }));
jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
}));
jest.mock('@/lib/backend/core/invoke', () => ({ API_BASE_URL: '' }));
jest.mock('@/components/ui', () => ({
  GlassCard: ({ children, className }: any) => <div className={className}>{children}</div>,
  Toggle: ({ checked, onChange, disabled, label }: any) => (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  ),
  SegmentedControl: () => null,
  Input: (props: any) => <input {...props} />,
}));

import { CompressionSection } from '@/components/ai-proxy/sections/CompressionSection';

const fetchMock = jest.fn(async (input: any) => {
  const url = String(input);
  if (url.endsWith('/api/compression/status')) {
    return {
      ok: true,
      json: async () => ({
        enabled: false,
        rtk_enabled: false,
        caveman_enabled: false,
        caveman_level: 'full',
        input_compression_enabled: true,
        output_compression_enabled: true,
        preserve_system_prompt: true,
        auto_trigger_threshold: 500,
      }),
    };
  }
  if (url.endsWith('/api/compression/stats')) {
    return { ok: true, json: async () => ({ tokens_saved: 0, avg_savings_pct: 0 }) };
  }
  if (url.endsWith('/api/compression/config')) {
    return { ok: true, json: async () => ({}) };
  }
  return { ok: false, json: async () => ({}) };
});

beforeEach(() => {
  jest.clearAllMocks();
  (globalThis as any).fetch = fetchMock;
});

describe('CompressionSection contract', () => {
  it('posts the backend field names on toggle (enabled, not compression_enabled)', async () => {
    render(<CompressionSection />);
    await waitFor(() =>
      expect(screen.getByLabelText('aiHub.compression.enabled')).toBeTruthy()
    );
    await act(async () => {
      fireEvent.click(screen.getByLabelText('aiHub.compression.enabled'));
    });
    await waitFor(() => {
      const configCalls = fetchMock.mock.calls.filter(([u]) =>
        String(u).endsWith('/api/compression/config')
      );
      expect(configCalls.length).toBe(1);
      const body = JSON.parse(String((configCalls[0] as any)[1].body));
      expect(Object.keys(body)).toContain('enabled');
      expect(Object.keys(body)).not.toContain('compression_enabled');
      expect(body.enabled).toBe(true);
    });
  });
});
