/**
 * HoloneSection auto-save tests.
 *
 * Covers:
 *   - Toggling protection immediately POSTs /api/holone/config and shows a
 *     success toast (no save bar in the DOM).
 *   - Switching the mode card POSTs the new mode.
 *   - On POST failure the toggle reverts and an error toast is shown.
 *
 * Mocks: i18n (t = identity), sonner toast, @/lib/events (listen),
 * API_BASE_URL, UI primitives, global.fetch.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';

// ── Module mocks ────────────────────────────────────────────────────────────

jest.mock('@/lib/i18n', () => ({
  t: (key: string) => key,
}));

jest.mock('sonner', () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  },
}));

jest.mock('@/lib/events', () => ({
  listen: jest.fn(() => Promise.resolve(() => {})),
}));

jest.mock('@/lib/backend/core/invoke', () => ({
  API_BASE_URL: '',
}));

jest.mock('@/components/ui', () => ({
  Button: ({ children, onClick, disabled, className }: any) => (
    <button type="button" onClick={onClick} disabled={disabled} className={className}>
      {children}
    </button>
  ),
  EmptyState: ({ title }: any) => <div>{title}</div>,
  GlassCard: ({ children, className }: any) => <div className={className}>{children}</div>,
  PageHeader: ({ title }: any) => <h1>{title}</h1>,
  RangeSlider: () => <div data-testid="range-slider" />,
  Table: ({ children }: any) => <table>{children}</table>,
  TableBody: ({ children }: any) => <tbody>{children}</tbody>,
  TableCell: ({ children }: any) => <td>{children}</td>,
  TableHead: ({ children }: any) => <th>{children}</th>,
  TableHeader: ({ children }: any) => <thead>{children}</thead>,
  TableRow: ({ children }: any) => <tr>{children}</tr>,
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
}));

import { HoloneSection } from '@/components/ai-proxy/sections/HoloneSection';
import { toast } from 'sonner';

// ── Fetch mock ───────────────────────────────────────────────────────────────

let configPostFails = false;

const fetchMock = jest.fn(async (input: any) => {
  const url = String(input);
  if (url.includes('/api/holone/status')) {
    return { ok: true, json: async () => ({ enabled: true, mode: 'monitor', rule_count: 3 }) };
  }
  if (url.includes('/api/holone/findings')) {
    return { ok: true, json: async () => ({ findings: [] }) };
  }
  if (url.includes('/api/holone/config')) {
    return { ok: !configPostFails, json: async () => ({}) };
  }
  return { ok: false, json: async () => ({}) };
});

function configPostCalls(): { url: string; body: any }[] {
  return fetchMock.mock.calls
    .filter(([url]) => String(url).includes('/api/holone/config'))
    .map(([url, init]: any) => ({ url: String(url), body: JSON.parse(init.body) }));
}

async function renderLoaded() {
  render(<HoloneSection />);
  await waitFor(() => {
    expect(screen.getByRole('switch', { name: 'aiHub.holone.enabled' })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/holone/status'));
  });
  await waitFor(() => {
    expect(screen.getByText('3')).toBeTruthy();
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('HoloneSection auto-save', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    configPostFails = false;
    (global as any).fetch = fetchMock;
  });

  it('POSTs config and toasts success when the protection toggle flips', async () => {
    await renderLoaded();

    // The unsaved-changes save bar is gone.
    expect(screen.queryByText('aiHub.holone.unsavedChanges')).toBeNull();
    expect(screen.queryByText('aiHub.holone.saveChanges')).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole('switch', { name: 'aiHub.holone.enabled' }));
    });

    await waitFor(() => {
      expect(configPostCalls()).toEqual([
        { url: '/api/holone/config', body: { enabled: false, mode: 'monitor' } },
      ]);
    });
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('aiHub.holone.toasts.configSaved');
    });
    expect(screen.getByRole('switch', { name: 'aiHub.holone.enabled' }).getAttribute('aria-checked')).toBe('false');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('POSTs config when a mode card is clicked', async () => {
    await renderLoaded();

    const blockCard = screen.getByText('aiHub.holone.blockMode').closest('button')!;
    await act(async () => {
      fireEvent.click(blockCard);
    });

    await waitFor(() => {
      expect(configPostCalls()).toEqual([
        { url: '/api/holone/config', body: { enabled: true, mode: 'block' } },
      ]);
    });
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('aiHub.holone.toasts.configSaved');
    });
  });

  it('reverts the toggle and toasts an error when the POST fails', async () => {
    configPostFails = true;
    await renderLoaded();

    await act(async () => {
      fireEvent.click(screen.getByRole('switch', { name: 'aiHub.holone.enabled' }));
    });

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('aiHub.holone.toasts.configSaveFailed');
    });
    expect(screen.getByRole('switch', { name: 'aiHub.holone.enabled' }).getAttribute('aria-checked')).toBe('true');
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('does not POST when the clicked mode is already active', async () => {
    await renderLoaded();

    const monitorCard = screen.getByText('aiHub.holone.monitorMode').closest('button')!;
    await act(async () => {
      fireEvent.click(monitorCard);
    });

    expect(configPostCalls()).toEqual([]);
    expect(toast.success).not.toHaveBeenCalled();
  });
});
