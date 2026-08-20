/**
 * GroupUsageTab tests.
 *
 * Covers:
 *   - Owner view: renders per-member aggregate (username, today + 7d
 *     requests/tokens) from raw usage rows.
 *   - Member view: renders own rows by day.
 *   - Quota save: owner changes the quota Input and clicks Save →
 *     groupsSetQuota called with { groupId, maxPerMemberDaily }.
 *   - Loading skeleton and empty state.
 *
 * Mocks the Zustand store with a mutable state object, stubs UI primitives,
 * mocks the backend groups module (usage + quota spies), and mocks i18n to
 * return keys so assertions are stable across locale changes (same pattern
 * as GroupPoolTab.test.tsx).
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

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

// ── Mock sonner toast ───────────────────────────────────────────────────────
jest.mock('sonner', () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  },
}));

// ── Mock askConfirm (not used here but stubbed for safety) ──────────────────
jest.mock('@/components/ui/ConfirmDialogHost', () => ({
  askConfirm: jest.fn(async () => true),
}));

// ── Mock backend groups module (usage + quota spies) ───────────────────────
const groupsUsageList = jest.fn(async () => ({ rows: [], max_per_member_daily: null }));
const groupsSetQuota = jest.fn(async () => ({ id: 'g-1', name: 'Test', owner_id: 1, created_at: '' }));
jest.mock('@/lib/backend/modules/groups', () => ({
  groupsUsageList: (...args: unknown[]) => groupsUsageList(...args),
  groupsSetQuota: (...args: unknown[]) => groupsSetQuota(...args),
}));

// ── Stub UI primitives ─────────────────────────────────────────────────────
jest.mock('@/components/ui', () => ({
  GlassCard: ({ children, ...rest }: any) => <div {...rest}>{children}</div>,
  Badge: ({ children, ...rest }: any) => <span {...rest}>{children}</span>,
  Button: ({ children, onClick, disabled, ...rest }: any) => (
    <button onClick={onClick} disabled={disabled} {...rest}>{children}</button>
  ),
  Input: ({ value, onChange, label, containerClassName, ...rest }: any) => (
    <div>
      {label && <label>{label}</label>}
      <input
        value={value}
        onChange={onChange}
        {...rest}
      />
    </div>
  ),
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
  ProgressBar: ({ value, max, variant, ...rest }: any) => (
    <div
      data-testid="progress-bar"
      data-value={String(value)}
      data-max={String(max)}
      data-variant={variant ?? ''}
      {...rest}
    />
  ),
}));

// ── Mutable store state mock ───────────────────────────────────────────────
const storeState: any = {
  detail: null,
  fetchDetail: jest.fn(async () => undefined),
};

jest.mock('@/stores/groups', () => ({
  useGroupsStore: (selector?: (s: any) => any) =>
    selector ? selector(storeState) : storeState,
}));

import { GroupUsageTab } from '@/components/ai-groups/GroupUsageTab';
import type { GroupUsageRow, GroupDetailResponse } from '@/lib/backend/modules/groups';
import { toast } from 'sonner';

// ── Helpers ─────────────────────────────────────────────────────────────────

function utcToday(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function makeDetail(overrides: Partial<GroupDetailResponse> = {}): GroupDetailResponse {
  return {
    group: overrides.group ?? {
      id: 'g-1',
      name: 'Test Group',
      owner_id: 1,
      created_at: '2024-01-01T00:00:00Z',
    },
    members: overrides.members ?? [],
    invites: overrides.invites ?? [],
    is_owner: overrides.is_owner ?? true,
  };
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
    storeState.detail = null;
    groupsUsageList.mockResolvedValue({ rows: [], max_per_member_daily: null });
    groupsSetQuota.mockResolvedValue({ id: 'g-1', name: 'Test', owner_id: 1, created_at: '' });
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

  it('renders quota block for owner and saves quota via groupsSetQuota', async () => {
    storeState.detail = makeDetail({
      group: {
        id: 'g-1',
        name: 'Test',
        owner_id: 1,
        max_requests_per_member_daily: 50,
        created_at: '',
      },
    });

    render(<GroupUsageTab groupId="g-1" isOwner={true} />);

    // The quota Input is present (owner only) — wait for the
    // "adjusting state during render" pattern to flush the value.
    const quotaInput = await waitFor(() =>
      screen.getByDisplayValue('50') as HTMLInputElement,
    );
    expect(quotaInput).toBeTruthy();

    // Change the quota value.
    fireEvent.change(quotaInput, { target: { value: '100' } });

    // Click Save.
    const saveBtn = screen.getByText('common.save');
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(groupsSetQuota).toHaveBeenCalledWith({
        groupId: 'g-1',
        maxPerMemberDaily: 100,
      });
    });
    expect(storeState.fetchDetail).toHaveBeenCalledWith('g-1');
    expect(toast.success).toHaveBeenCalledWith('ai.groups.usage.saved');
  });

  it('sends null when quota input is cleared (unlimited)', async () => {
    storeState.detail = makeDetail({
      group: {
        id: 'g-1',
        name: 'Test',
        owner_id: 1,
        max_requests_per_member_daily: 50,
        created_at: '',
      },
    });

    render(<GroupUsageTab groupId="g-1" isOwner={true} />);

    const quotaInput = await waitFor(() =>
      screen.getByDisplayValue('50') as HTMLInputElement,
    );
    fireEvent.change(quotaInput, { target: { value: '' } });

    fireEvent.click(screen.getByText('common.save'));

    await waitFor(() => {
      expect(groupsSetQuota).toHaveBeenCalledWith({
        groupId: 'g-1',
        maxPerMemberDaily: null,
      });
    });
  });

  it('rejects fractional quota input with quotaFractional error', async () => {
    storeState.detail = makeDetail({
      group: {
        id: 'g-1',
        name: 'Test',
        owner_id: 1,
        max_requests_per_member_daily: 50,
        created_at: '',
      },
    });

    render(<GroupUsageTab groupId="g-1" isOwner={true} />);

    const quotaInput = await waitFor(() =>
      screen.getByDisplayValue('50') as HTMLInputElement,
    );
    // Enter a fractional value.
    fireEvent.change(quotaInput, { target: { value: '10.5' } });

    fireEvent.click(screen.getByText('common.save'));

    // Error toast with the fractional key.
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('ai.groups.usage.quotaFractional');
    });

    // groupsSetQuota was NOT called.
    expect(groupsSetQuota).not.toHaveBeenCalled();
  });

  it('does not render quota block for members', async () => {
    render(<GroupUsageTab groupId="g-1" isOwner={false} />);

    await waitFor(() => {
      expect(screen.getByText('ai.groups.usage.empty')).toBeTruthy();
    });

    // No quota label visible.
    expect(screen.queryByText('ai.groups.usage.quotaLabel')).toBeNull();
  });

  // ── Member summary card: limit + today progress ──────────────────────────

  it('renders member summary card with group limit and progress bar', async () => {
    const today = utcToday();
    groupsUsageList.mockResolvedValue({
      rows: [
        makeRow({ user_id: 1, username: 'alice', day: today, requests: 30, tokens: 300 }),
      ],
      max_per_member_daily: 50,
    });

    render(<GroupUsageTab groupId="g-1" isOwner={false} />);

    await waitFor(() => {
      // Limit label + value
      expect(screen.getByText('ai.groups.usage.limit')).toBeTruthy();
      expect(screen.getByText('50 ai.groups.usage.perDay')).toBeTruthy();
      // Today label + X/N
      expect(screen.getByText('ai.groups.usage.today')).toBeTruthy();
      expect(screen.getByText('30/50')).toBeTruthy();
    });

    // Progress bar rendered with correct value/max/variant.
    const bar = screen.getByTestId('progress-bar');
    expect(bar.getAttribute('data-value')).toBe('30');
    expect(bar.getAttribute('data-max')).toBe('50');
    // 30/50 = 60% → success (ok < 70%)
    expect(bar.getAttribute('data-variant')).toBe('success');
  });

  it('renders member summary with unlimited when cap is null', async () => {
    groupsUsageList.mockResolvedValue({
      rows: [],
      max_per_member_daily: null,
    });

    render(<GroupUsageTab groupId="g-1" isOwner={false} />);

    await waitFor(() => {
      expect(screen.getByText('ai.groups.usage.limit')).toBeTruthy();
      expect(screen.getByText('ai.groups.usage.unlimited')).toBeTruthy();
    });

    // No progress bar when cap is null (unlimited).
    expect(screen.queryByTestId('progress-bar')).toBeNull();
  });

  it('colors progress bar as warning when usage >= 70% and < 100%', async () => {
    const today = utcToday();
    groupsUsageList.mockResolvedValue({
      rows: [
        makeRow({ user_id: 1, username: 'alice', day: today, requests: 35, tokens: 100 }),
      ],
      max_per_member_daily: 50,
    });

    render(<GroupUsageTab groupId="g-1" isOwner={false} />);

    await waitFor(() => {
      const bar = screen.getByTestId('progress-bar');
      // 35/50 = 70% → warning
      expect(bar.getAttribute('data-variant')).toBe('warning');
    });
  });

  it('colors progress bar as danger when usage >= 100%', async () => {
    const today = utcToday();
    groupsUsageList.mockResolvedValue({
      rows: [
        makeRow({ user_id: 1, username: 'alice', day: today, requests: 55, tokens: 100 }),
      ],
      max_per_member_daily: 50,
    });

    render(<GroupUsageTab groupId="g-1" isOwner={false} />);

    await waitFor(() => {
      const bar = screen.getByTestId('progress-bar');
      // 55/50 = 110% → danger
      expect(bar.getAttribute('data-variant')).toBe('danger');
    });
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

  // ── Owner per-member progress bar ────────────────────────────────────────

  it('renders owner per-member progress bar when cap is set', async () => {
    const today = utcToday();
    groupsUsageList.mockResolvedValue({
      rows: [
        makeRow({ user_id: 1, username: 'alice', day: today, requests: 20, tokens: 100 }),
      ],
      max_per_member_daily: 50,
    });

    render(<GroupUsageTab groupId="g-1" isOwner={true} />);

    await waitFor(() => {
      expect(screen.getByText('@alice')).toBeTruthy();
    });

    // Owner sees a progress bar for alice (20/50 = 40% → success).
    const bars = screen.getAllByTestId('progress-bar');
    expect(bars).toHaveLength(1);
    expect(bars[0].getAttribute('data-value')).toBe('20');
    expect(bars[0].getAttribute('data-max')).toBe('50');
    expect(bars[0].getAttribute('data-variant')).toBe('success');
  });

  it('does not render owner progress bar when cap is null', async () => {
    const today = utcToday();
    groupsUsageList.mockResolvedValue({
      rows: [
        makeRow({ user_id: 1, username: 'alice', day: today, requests: 20, tokens: 100 }),
      ],
      max_per_member_daily: null,
    });

    render(<GroupUsageTab groupId="g-1" isOwner={true} />);

    await waitFor(() => {
      expect(screen.getByText('@alice')).toBeTruthy();
    });

    // No progress bars when cap is null.
    expect(screen.queryByTestId('progress-bar')).toBeNull();
  });
});
