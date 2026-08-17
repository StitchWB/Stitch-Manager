/**
 * Codes page tests.
 *
 * Verifies:
 *   - Renders the codes list with mixed statuses (unused/used/revoked/expired).
 *   - Status badges are computed correctly from code fields.
 *   - Revoke flow: clicking revoke → confirm dialog → POST /api/dist/revoke-code
 *     → list refreshes.
 *   - Issue form: submitting sends the correct JSON body to
 *     POST /api/dist/issue-code.
 *
 * Mocks global.fetch (the dist module calls fetch directly) and the
 * ConfirmDialogHost (askConfirm resolves true immediately).
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Codes from '../../pages/Codes';

// Mock Header to keep the test focused on the page body.
jest.mock('../../components/layout/Header', () => ({
  __esModule: true,
  default: ({ title }: { title: string }) => <div data-testid="header">{title}</div>,
}));

// Mock the app store so language is set and t() resolves.
jest.mock('../../stores/app', () => ({
  useAppStore: (selector?: (s: { language: string }) => unknown) =>
    selector ? selector({ language: 'en' }) : { language: 'en' },
}));

// Mock sonner so toast calls don't blow up in jsdom.
jest.mock('sonner', () => ({
  toast: {
    error: jest.fn(),
    success: jest.fn(),
  },
}));

// Mock ConfirmDialogHost — askConfirm resolves true immediately so the
// revoke flow proceeds without rendering the actual dialog.
jest.mock('../../components/ui/ConfirmDialogHost', () => ({
  ConfirmDialogHost: () => null,
  askConfirm: jest.fn(() => Promise.resolve(true)),
}));

// ── Test data ────────────────────────────────────────────────────────────────

interface MockCode {
  id: number;
  code_hash_prefix: string;
  entitlements: string[];
  used: boolean;
  used_at: string | null;
  token_id: number | null;
  created_at: string;
  expires_at: string | null;
  revoked: boolean;
  tg_user_id: number | null;
  label: string | null;
}

function mockCodes(): MockCode[] {
  return [
    {
      id: 1,
      code_hash_prefix: 'abc12345',
      entitlements: ['kiro'],
      used: false,
      used_at: null,
      token_id: null,
      created_at: '2025-01-01T00:00:00Z',
      expires_at: '2099-12-31T23:59:59Z', // far future → not expired
      revoked: false,
      tg_user_id: null,
      label: 'unused-code',
    },
    {
      id: 2,
      code_hash_prefix: 'def67890',
      entitlements: ['windsurf'],
      used: true,
      used_at: '2025-02-01T00:00:00Z',
      token_id: 42,
      created_at: '2025-01-15T00:00:00Z',
      expires_at: null,
      revoked: false,
      tg_user_id: 12345,
      label: null,
    },
    {
      id: 3,
      code_hash_prefix: 'ghi11223',
      entitlements: ['kiro', 'windsurf'],
      used: false,
      used_at: null,
      token_id: null,
      created_at: '2025-03-01T00:00:00Z',
      expires_at: null,
      revoked: true,
      tg_user_id: null,
      label: 'revoked-code',
    },
    {
      id: 4,
      code_hash_prefix: 'jkl44556',
      entitlements: ['trae'],
      used: false,
      used_at: null,
      token_id: null,
      created_at: '2025-01-01T00:00:00Z',
      expires_at: '2020-01-01T00:00:00Z', // past → expired
      revoked: false,
      tg_user_id: null,
      label: 'expired-code',
    },
  ];
}

// ── fetch mock helper ────────────────────────────────────────────────────────

function mockFetchResponse(
  url: string,
  method: string,
  status: number,
  body: unknown
): void {
  const calls = (globalThis.fetch as jest.Mock).mock.calls;
  calls.push([
    url,
    {
      method,
      credentials: 'include',
      headers: expect.any(Object),
      body: expect.any(String),
    },
  ]);
  // We use a queue-based approach below; this is a placeholder.
}

function makeJsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    clone() { return this; },
    headers: new Headers(),
  };
}

function makeFetchHandler() {
  const codesList = mockCodes();
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  const handler = jest.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: init?.body as string | undefined });
    if (url.endsWith('/api/dist/codes')) {
      return makeJsonResponse(200, { codes: codesList });
    }
    if (url.endsWith('/api/dist/issue-code')) {
      return makeJsonResponse(200, {
        codes: ['NEW-CODE-1', 'NEW-CODE-2'],
        entitlements: ['kiro'],
      });
    }
    if (url.endsWith('/api/dist/revoke-code')) {
      return makeJsonResponse(200, { code_id: 1, revoked: true });
    }
    return makeJsonResponse(404, { detail: 'not found' });
  });
  return { handler, calls, codesList };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('Codes page', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('renders the codes list with mixed statuses and correct badges', async () => {
    const { handler } = makeFetchHandler();
    (globalThis as { fetch: jest.Mock }).fetch = jest.fn(handler);

    render(
      <MemoryRouter>
        <Codes />
      </MemoryRouter>
    );

    // Wait for codes to load.
    await waitFor(() => {
      expect(screen.getByText('abc12345')).toBeTruthy();
    });

    // All four hash prefixes are rendered.
    expect(screen.getByText('abc12345')).toBeTruthy(); // unused
    expect(screen.getByText('def67890')).toBeTruthy(); // used
    expect(screen.getByText('ghi11223')).toBeTruthy(); // revoked
    expect(screen.getByText('jkl44556')).toBeTruthy(); // expired

    // Status badges — the t() function resolves keys to the en locale.
    // Unused → "Unused", Used → "Used", Revoked → "Revoked", Expired → "Expired".
    // These labels appear both in the stats row and as badges, so use getAllByText.
    expect(screen.getAllByText('Unused').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Used').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Revoked').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Expired').length).toBeGreaterThanOrEqual(1);

    // Stats row: total=4. The stat card renders the value as a bold number
    // in a div with class "text-2xl".
    const statValues = screen.getAllByText('4').filter(
      el => el.tagName === 'DIV' && el.classList.contains('text-2xl')
    );
    expect(statValues.length).toBeGreaterThanOrEqual(1);
  });

  it('revoke flow calls POST /api/dist/revoke-code and refreshes the list', async () => {
    const { handler, calls } = makeFetchHandler();
    (globalThis as { fetch: jest.Mock }).fetch = jest.fn(handler);

    render(
      <MemoryRouter>
        <Codes />
      </MemoryRouter>
    );

    // Wait for codes to load.
    await waitFor(() => {
      expect(screen.getByText('abc12345')).toBeTruthy();
    });

    // The unused code (id=1) should have a revoke button.
    const revokeButtons = screen.getAllByLabelText('Revoke');
    expect(revokeButtons.length).toBeGreaterThanOrEqual(1);

    // Click the first revoke button (unused code).
    await act(async () => {
      fireEvent.click(revokeButtons[0]);
    });

    // askConfirm resolves true → the revoke POST should fire.
    await waitFor(() => {
      const revokeCall = calls.find(c => c.url.endsWith('/api/dist/revoke-code') && c.method === 'POST');
      expect(revokeCall).toBeTruthy();
      expect(JSON.parse(revokeCall!.body!)).toEqual({ code_id: 1 });
    });

    // After revoke, the list refreshes (GET /api/dist/codes called again).
    await waitFor(() => {
      const codesCalls = calls.filter(c => c.url.endsWith('/api/dist/codes') && c.method === 'GET');
      expect(codesCalls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('issue form submits the correct JSON body to POST /api/dist/issue-code', async () => {
    const { handler, calls } = makeFetchHandler();
    (globalThis as { fetch: jest.Mock }).fetch = jest.fn(handler);

    render(
      <MemoryRouter>
        <Codes />
      </MemoryRouter>
    );

    // Wait for codes to load.
    await waitFor(() => {
      expect(screen.getByText('abc12345')).toBeTruthy();
    });

    // Open the issue form by clicking the collapsible header.
    const issueHeader = screen.getByText('Issue new codes');
    await act(async () => {
      fireEvent.click(issueHeader);
    });

    // Fill the form. The count input is a number input.
    const countInput = screen.getByDisplayValue('1');
    await act(async () => {
      fireEvent.change(countInput, { target: { value: '5' } });
    });

    // The label input.
    const labelInput = screen.getByPlaceholderText('Optional batch label');
    await act(async () => {
      fireEvent.change(labelInput, { target: { value: 'batch-42' } });
    });

    // The entitlements input.
    const entInput = screen.getByPlaceholderText(/comma-separated/);
    await act(async () => {
      fireEvent.change(entInput, { target: { value: 'kiro, windsurf' } });
    });

    // Submit the form.
    const submitButton = screen.getByText('Issue');
    await act(async () => {
      fireEvent.click(submitButton);
    });

    // Verify the issue POST was called with the correct body.
    await waitFor(() => {
      const issueCall = calls.find(c => c.url.endsWith('/api/dist/issue-code') && c.method === 'POST');
      expect(issueCall).toBeTruthy();
      const body = JSON.parse(issueCall!.body!);
      expect(body.count).toBe(5);
      expect(body.label).toBe('batch-42');
      expect(body.entitlements).toEqual(['kiro', 'windsurf']);
      // ttl_minutes should be present (default 60).
      expect(body.ttl_minutes).toBe(60);
    });
  });

  it('shows empty state when no codes are returned', async () => {
    const handler = jest.fn(async (url: string) => {
      if (url.endsWith('/api/dist/codes')) {
        return makeJsonResponse(200, { codes: [] });
      }
      return makeJsonResponse(404, { detail: 'not found' });
    });
    (globalThis as { fetch: jest.Mock }).fetch = jest.fn(handler);

    render(
      <MemoryRouter>
        <Codes />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('No codes yet')).toBeTruthy();
    });
  });

  it('shows error banner with retry when fetch fails', async () => {
    const handler = jest.fn(async () => {
      return makeJsonResponse(503, { detail: 'Distribution server disabled' });
    });
    (globalThis as { fetch: jest.Mock }).fetch = jest.fn(handler);

    render(
      <MemoryRouter>
        <Codes />
      </MemoryRouter>
    );

    // The error banner shows the mapped error message (Distribution server
    // disabled) and a Retry button.
    await waitFor(() => {
      expect(screen.getByText('Distribution server disabled')).toBeTruthy();
    });
    expect(screen.getByText('Retry')).toBeTruthy();
  });
});
