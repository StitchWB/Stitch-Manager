/**
 * GroupUsageTab tests.
 *
 * Covers:
 *   - Owner view: renders per-member aggregate (username, today + 30d
 *     requests/tokens) from raw usage rows.
 *   - Member view: renders own rows by day.
 *   - Loading skeleton and empty state.
 *
 * The legacy single-cap quota editor was removed (quota management lives
 * in GroupQuotasTab) — quota editor tests were removed with it.
 *
 * Mocks the backend groups module (usage spy) and mocks i18n to return
 * keys so assertions are stable across locale changes (same pattern as
 * GroupPoolTab.test.tsx).
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';

// ── Mock i18n: return the key (with params substituted if present) ──────────
jest.mock('@/lib/i18n', () => ({
  t: (key: string, params?: Record<string, string | number>): string => {
    if (!params) return key;
    return Object.entries(params).reduce(
      (acc, [k, v]) => acc.replace(`{${k}}`, String(v)),
      key,
    );
  },
  getLocale: () => 'en',
}));

// ── Mock backend groups module (usage spy) ──────────────────────────────────
const groupsUsageList = jest.fn(async () => ({ rows: [], max_per_member_daily: null }));
jest.mock('@/lib/backend/modules/groups', () => ({
  groupsUsageList: (...args: unknown[]) => groupsUsageList(...args),
}));

// ── Stub UI primitives ─────────────────────────────────────────────────────
jest.mock('@/components/ui', () => ({
  GlassCard: ({ children, ...rest }: any) => <div {...rest}>{children}</div>,
  Badge: ({ children, ...rest }: any) => <span {...rest}>{children}</span>,
  KeyValueList: ({ rows = [], ...rest }: any) => (
    <div {...rest}>
      {rows.map((r: any) => (
        <div key={r.id} data-testid="kv-row">
          <span data-testid="kv-label">{r.label}</span>
          <span data-testid="kv-value">{r.value}</span>
        </div>
      ))}
    </div>
  ),
  EmptyState: ({ title, ...rest }: any) => (
    <div {...rest}><span>{title}</span></div>
  ),
  SkeletonLoader: () => <div data-testid="skeleton" />,
}));

import { GroupUsageTab } from '@/components/ai-groups/GroupUsageTab';
import type { GroupUsageRow } from '@/lib/backend/modules/groups';

// ── Helpers ─────────────────────────────────────────────────────────────────

function utcToday(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function makeRow(overrides: Partial<GroupUsageRow> = {}): GroupUsageRow {
  return {
    user_id: overrides.user_id ?? 1,
    username: overrides.username ?? 'alice',
    day: overrides.day ?? utcToday(),
    requests: overrides.requests ?? 10,
    tokens: overrides.tokens ?? 500,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('GroupUsageTab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    groupsUsageList.mockResolvedValue({ rows: [], max_per_member_daily: null });
  });

  it('renders skeleton while loading', () => {
    // Never resolves → stays in loading state.
    groupsUsageList.mockReturnValue(new Promise(() => {}));

    render(<GroupUsageTab groupId="g-1" isOwner={true} />);

    expect(screen.getByTestId('skeleton')).toBeTruthy();
  });

  it('renders empty state when no usage rows', async () => {
    render(<GroupUsageTab groupId="g-1" isOwner={true} />);

    await waitFor(() => {
      expect(screen.getByText('ai.groups.usage.empty')).toBeTruthy();
    });
  });

  it('renders owner aggregate per member with today + 30d totals', async () => {
    const today = utcToday();
    const yesterday = '2024-01-01';
    groupsUsageList.mockResolvedValue({
      rows: [
        makeRow({ user_id: 1, username: 'alice', day: today, requests: 5, tokens: 100 }),
        makeRow({ user_id: 1, username: 'alice', day: yesterday, requests: 10, tokens: 200 }),
        makeRow({ user_id: 2, username: 'bob', day: today, requests: 3, tokens: 50 }),
      ],
      max_per_member_daily: null,
    });

    render(<GroupUsageTab groupId="g-1" isOwner={true} />);

    // Wait for data to load — usernames appear.
    await waitFor(() => {
      expect(screen.getByText('@alice')).toBeTruthy();
      expect(screen.getByText('@bob')).toBeTruthy();
    });

    // Alice: today=5 req / 100 tok, week=15 req / 300 tok.
    // Bob: today=3 req / 50 tok, week=3 req / 50 tok.
    const values = screen.getAllByTestId('kv-value').map(el => el.textContent);
    // Alice has 4 values, Bob has 4 values → 8 total.
    expect(values).toHaveLength(8);
    // Alice today requests = 5
    expect(values[0]).toBe('5');
    // Alice today tokens = 100
    expect(values[1]).toBe('100');
    // Alice week requests = 15
    expect(values[2]).toBe('15');
    // Alice week tokens = 300
    expect(values[3]).toBe('300');
    // Bob today requests = 3
    expect(values[4]).toBe('3');
    // Bob week requests = 3
    expect(values[6]).toBe('3');
  });

  it('renders member own rows by day', async () => {
    groupsUsageList.mockResolvedValue({
      rows: [
        makeRow({ user_id: 1, username: 'alice', day: '2024-01-01', requests: 5, tokens: 100 }),
        makeRow({ user_id: 1, username: 'alice', day: '2024-01-02', requests: 8, tokens: 200 }),
      ],
      max_per_member_daily: null,
    });

    render(<GroupUsageTab groupId="g-1" isOwner={false} />);

    await waitFor(() => {
      expect(screen.getByText('2024-01-01')).toBeTruthy();
      expect(screen.getByText('2024-01-02')).toBeTruthy();
    });

    // Each day row has 2 KV rows (requests + tokens) → 4 total.
    const values = screen.getAllByTestId('kv-value').map(el => el.textContent);
    expect(values).toHaveLength(4);
    expect(values[0]).toBe('5');
    expect(values[1]).toBe('100');
    expect(values[2]).toBe('8');
    expect(values[3]).toBe('200');
  });

  it('renders member 30d history list with header', async () => {
    groupsUsageList.mockResolvedValue({
      rows: [
        makeRow({ user_id: 1, username: 'alice', day: '2024-01-01', requests: 5, tokens: 100 }),
        makeRow({ user_id: 1, username: 'alice', day: '2024-01-02', requests: 8, tokens: 200 }),
      ],
      max_per_member_daily: null,
    });

    render(<GroupUsageTab groupId="g-1" isOwner={false} />);

    await waitFor(() => {
      expect(screen.getByText('ai.groups.usage.history30')).toBeTruthy();
      expect(screen.getByText('2024-01-01')).toBeTruthy();
      expect(screen.getByText('2024-01-02')).toBeTruthy();
    });
  });
});
