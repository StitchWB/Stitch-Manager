/**
 * PartnerChannels admin page tests.
 *
 * Verifies:
 *   - Renders the partner-channel list from GET /api/partners/channels.
 *   - Delete flow: click delete → askConfirm → DELETE /api/partners/channels/{id}
 *     → list refreshes.
 *   - Create button opens the form modal.
 *
 * Mocks global.fetch (the partners module calls fetch directly), mirroring
 * the Codes.test.tsx pattern.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PartnerChannels from '../../pages/PartnerChannels';

jest.mock('../../components/layout/Header', () => ({
  __esModule: true,
  default: ({ title }: { title: string }) => <div data-testid="header">{title}</div>,
}));

jest.mock('../../stores/app', () => ({
  useAppStore: (selector?: (s: { language: string }) => unknown) =>
    selector ? selector({ language: 'en' }) : { language: 'en' },
}));

jest.mock('sonner', () => ({
  toast: {
    error: jest.fn(),
    success: jest.fn(),
  },
}));

jest.mock('../../components/ui/ConfirmDialogHost', () => ({
  ConfirmDialogHost: () => null,
  askConfirm: jest.fn(() => Promise.resolve(true)),
}));

interface MockChannel {
  id: string;
  tg_chat_id: number | null;
  title: string;
  url: string;
  description: string | null;
  badge: string;
  type: string;
  owner_telegram_id: string | null;
  allowed_grant_roles: string[];
  max_members: number | null;
  active: boolean;
  member_count: number;
}

function mockChannel(): MockChannel {
  return {
    id: 'ch-1',
    tg_chat_id: -1001234567890,
    title: 'Test Partner Channel',
    url: 'https://t.me/test',
    description: null,
    badge: 'partner',
    type: 'telegram',
    owner_telegram_id: '12345',
    allowed_grant_roles: ['user'],
    max_members: 10,
    active: true,
    member_count: 3,
  };
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
  const calls: Array<{ url: string; method: string }> = [];
  const handler = async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    calls.push({ url, method });
    if (url.endsWith('/api/partners/channels') && method === 'GET') {
      return makeJsonResponse(200, { channels: [mockChannel()] });
    }
    if (url.endsWith('/api/partners/channels/ch-1') && method === 'DELETE') {
      return makeJsonResponse(200, {});
    }
    return makeJsonResponse(404, { detail: 'not found' });
  };
  return { handler, calls };
}

function installFetch(handler: (url: string, init?: RequestInit) => Promise<unknown>): void {
  globalThis.fetch = handler as unknown as typeof fetch;
}

describe('PartnerChannels page', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('renders the partner-channel list from the partners REST module', async () => {
    const { handler, calls } = makeFetchHandler();
    installFetch(handler);

    render(
      <MemoryRouter>
        <PartnerChannels />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Test Partner Channel')).toBeTruthy();
    });

    expect(calls.some(c => c.url.endsWith('/api/partners/channels') && c.method === 'GET')).toBe(true);
    expect(screen.getByText('partner')).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();
  });

  it('delete flow calls DELETE /api/partners/channels/{id} and refreshes the list', async () => {
    const { handler, calls } = makeFetchHandler();
    installFetch(handler);

    render(
      <MemoryRouter>
        <PartnerChannels />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Test Partner Channel')).toBeTruthy();
    });

    const deleteButton = screen.getByLabelText('Delete');
    await act(async () => {
      fireEvent.click(deleteButton);
    });

    await waitFor(() => {
      expect(
        calls.some(c => c.url.endsWith('/api/partners/channels/ch-1') && c.method === 'DELETE'),
      ).toBe(true);
    });

    await waitFor(() => {
      const listCalls = calls.filter(
        c => c.url.endsWith('/api/partners/channels') && c.method === 'GET',
      );
      expect(listCalls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('create button opens the form modal', async () => {
    const { handler } = makeFetchHandler();
    installFetch(handler);

    render(
      <MemoryRouter>
        <PartnerChannels />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Test Partner Channel')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Add channel'));
    });

    await waitFor(() => {
      expect(screen.getByText('New channel')).toBeTruthy();
    });
  });
});
