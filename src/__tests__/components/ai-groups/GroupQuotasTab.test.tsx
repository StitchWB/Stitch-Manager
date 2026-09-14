/**
 * GroupQuotasTab tests.
 *
 * Covers:
 *   - Loading skeleton and empty state.
 *   - Rules list: summary text, progress bar (used/amount + variant),
 *     unlimited rules render without a progress bar.
 *   - Owner: add-rule form → groupsQuotaRuleSet with parsed params
 *     (member + userId + model + tokens + amount + daily); empty amount
 *     maps to null (unlimited); invalid amount rejected with a toast.
 *   - Owner: delete → groupsQuotaRuleDelete + row removed.
 *   - Member view: no form, no delete buttons.
 *
 * Mirrors GroupUsageTab.test.tsx: mocked i18n (returns keys), stubbed UI
 * primitives, mocked backend module, mutable Zustand store state.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ── Mock i18n: return the key ───────────────────────────────────────────────
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

// ── Mock backend groups module ──────────────────────────────────────────────
const groupsQuotaRulesList = jest.fn(async () => ({ rules: [] }));
const groupsQuotaRuleSet = jest.fn(async (p: unknown) => p);
const groupsQuotaRuleDelete = jest.fn(async () => ({ success: true }));
jest.mock('@/lib/backend/modules/groups', () => ({
  groupsQuotaRulesList: (...args: unknown[]) => groupsQuotaRulesList(...args),
  groupsQuotaRuleSet: (...args: unknown[]) => groupsQuotaRuleSet(...args),
  groupsQuotaRuleDelete: (...args: unknown[]) => groupsQuotaRuleDelete(...args),
}));

// ── Stub UI primitives ─────────────────────────────────────────────────────
jest.mock('@/components/ui', () => ({
  GlassCard: ({ children, ...rest }: any) => <div {...rest}>{children}</div>,
  Badge: ({ children, ...rest }: any) => <span {...rest}>{children}</span>,
  Button: ({ children, onClick, disabled, ...rest }: any) => (
    <button onClick={onClick} disabled={disabled} {...rest}>{children}</button>
  ),
  IconButton: ({ children, onClick, ...rest }: any) => (
    <button onClick={onClick} {...rest}>{children}</button>
  ),
  Input: ({ value, onChange, label, containerClassName: _c, ...rest }: any) => (
    <div>
      {label ? (
        <label>
          {label}
          <input value={value} onChange={onChange} {...rest} />
        </label>
      ) : (
        <input value={value} onChange={onChange} {...rest} />
      )}
    </div>
  ),
  Select: ({ value, onValueChange, options = [], ...rest }: any) => (
    <select
      value={value}
      onChange={e => onValueChange(e.target.value)}
      {...rest}
    >
      {options.map((o: any) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  ),
  SegmentedControl: ({ value, onChange, options = [] }: any) => (
    <div>
      {options.map((o: any) => (
        <button
          key={o.value}
          data-active={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
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
};

jest.mock('@/stores/groups', () => ({
  useGroupsStore: (selector?: (s: any) => any) =>
    selector ? selector(storeState) : storeState,
}));

import { GroupQuotasTab } from '@/components/ai-groups/GroupQuotasTab';
import type { GroupQuotaRule, GroupDetailResponse } from '@/lib/backend/modules/groups';
import { toast } from 'sonner';

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeRule(overrides: Partial<GroupQuotaRule> = {}): GroupQuotaRule {
  return {
    id: overrides.id ?? 'r-1',
    group_id: 'g-1',
    subject: overrides.subject ?? 'member',
    user_id: overrides.user_id !== undefined ? overrides.user_id : 2,
    model: overrides.model !== undefined ? overrides.model : 'glm-5.2',
    unit: overrides.unit ?? 'tokens',
    amount: overrides.amount === undefined ? 100000 : overrides.amount,
    period: overrides.period ?? 'daily',
    created_at: '2026-01-01T00:00:00Z',
    used: overrides.used ?? 0,
  };
}

function makeDetail(overrides: Partial<GroupDetailResponse> = {}): GroupDetailResponse {
  return {
    group: overrides.group ?? {
      id: 'g-1',
      name: 'Test Group',
      owner_id: 1,
      created_at: '2026-01-01T00:00:00Z',
    },
    members: overrides.members ?? [
      { user_id: 1, username: 'owner', role: 'owner', joined_at: '' },
      { user_id: 2, username: 'wblord', role: 'member', joined_at: '' },
    ],
    invites: overrides.invites ?? [],
    is_owner: overrides.is_owner ?? true,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('GroupQuotasTab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    storeState.detail = makeDetail();
    groupsQuotaRulesList.mockResolvedValue({ rules: [] });
    groupsQuotaRuleSet.mockImplementation(async (p: unknown) => p as never);
    groupsQuotaRuleDelete.mockResolvedValue({ success: true });
  });

  it('renders skeleton while loading', () => {
    groupsQuotaRulesList.mockReturnValue(new Promise(() => {}));
    render(<GroupQuotasTab groupId="g-1" isOwner={true} />);
    expect(screen.getByTestId('skeleton')).toBeTruthy();
  });

  it('renders empty state when no rules', async () => {
    render(<GroupQuotasTab groupId="g-1" isOwner={true} />);
    await waitFor(() => {
      expect(screen.getByText('ai.groups.quotas.empty')).toBeTruthy();
    });
  });

  it('renders a member rule with summary and progress bar', async () => {
    groupsQuotaRulesList.mockResolvedValue({
      rules: [makeRule({ used: 25000 })],
    });

    render(<GroupQuotasTab groupId="g-1" isOwner={true} />);

    await waitFor(() => {
      const summary = screen.getByText(/@wblord · glm-5\.2/);
      expect(summary.textContent).toContain('glm-5.2');
      expect(summary.textContent).toContain('100,000');
    });

    const bar = screen.getByTestId('progress-bar');
    expect(bar.getAttribute('data-value')).toBe('25000');
    expect(bar.getAttribute('data-max')).toBe('100000');
    expect(bar.getAttribute('data-variant')).toBe('success');
  });

  it('renders unlimited rule without a progress bar', async () => {
    groupsQuotaRulesList.mockResolvedValue({
      rules: [makeRule({ amount: null })],
    });

    render(<GroupQuotasTab groupId="g-1" isOwner={true} />);

    await waitFor(() => {
      expect(screen.getByText(/ai\.groups\.quotas\.unlimited/)).toBeTruthy();
    });
    expect(screen.queryByTestId('progress-bar')).toBeNull();
  });

  it('renders pool rule with whole-pool label', async () => {
    groupsQuotaRulesList.mockResolvedValue({
      rules: [makeRule({ subject: 'pool', user_id: null, model: null, used: 90000 })],
    });

    render(<GroupQuotasTab groupId="g-1" isOwner={true} />);

    await waitFor(() => {
      const summary = screen.getByText(/ai\.groups\.quotas\.wholePool/);
      expect(summary.textContent).toContain('ai.groups.quotas.allModels');
    });
    const bar = screen.getByTestId('progress-bar');
    // 90000/100000 = 90% → warning
    expect(bar.getAttribute('data-variant')).toBe('warning');
  });

  it('owner adds a rule with parsed params', async () => {
    render(<GroupQuotasTab groupId="g-1" isOwner={true} />);
    await waitFor(() => {
      expect(screen.getByText('ai.groups.quotas.empty')).toBeTruthy();
    });

    // Pick member @wblord (user_id=2)
    fireEvent.change(
      screen.getByLabelText('ai.groups.quotas.scopeMember'),
      { target: { value: '2' } },
    );
    // Model input
    fireEvent.change(
      screen.getByLabelText('ai.groups.quotas.modelLabel'),
      { target: { value: 'glm-5.2' } },
    );
    // Amount
    fireEvent.change(
      screen.getByLabelText('ai.groups.quotas.amountLabel'),
      { target: { value: '100000' } },
    );

    fireEvent.click(screen.getByText('ai.groups.quotas.addRule'));

    await waitFor(() => {
      expect(groupsQuotaRuleSet).toHaveBeenCalledWith({
        groupId: 'g-1',
        subject: 'member',
        userId: 2,
        model: 'glm-5.2',
        unit: 'tokens',
        amount: 100000,
        period: 'daily',
      });
    });
    expect(toast.success).toHaveBeenCalledWith('ai.groups.quotas.saved');
  });

  it('empty amount maps to null (unlimited)', async () => {
    render(<GroupQuotasTab groupId="g-1" isOwner={true} />);
    await waitFor(() => {
      expect(screen.getByText('ai.groups.quotas.empty')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('ai.groups.quotas.addRule'));

    await waitFor(() => {
      expect(groupsQuotaRuleSet).toHaveBeenCalledWith(
        expect.objectContaining({ amount: null, model: null, userId: null }),
      );
    });
  });

  it('rejects invalid amount with a toast and no backend call', async () => {
    render(<GroupQuotasTab groupId="g-1" isOwner={true} />);
    await waitFor(() => {
      expect(screen.getByText('ai.groups.quotas.empty')).toBeTruthy();
    });

    fireEvent.change(
      screen.getByLabelText('ai.groups.quotas.amountLabel'),
      { target: { value: '10.5' } },
    );
    fireEvent.click(screen.getByText('ai.groups.quotas.addRule'));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('ai.groups.quotas.invalidAmount');
    });
    expect(groupsQuotaRuleSet).not.toHaveBeenCalled();
  });

  it('owner deletes a rule and the row disappears', async () => {
    groupsQuotaRulesList.mockResolvedValue({ rules: [makeRule()] });

    render(<GroupQuotasTab groupId="g-1" isOwner={true} />);
    await waitFor(() => {
      expect(screen.getByText(/@wblord · glm-5\.2/)).toBeTruthy();
    });

    fireEvent.click(screen.getByLabelText('ai.groups.quotas.deleteRule'));

    await waitFor(() => {
      expect(groupsQuotaRuleDelete).toHaveBeenCalledWith({
        groupId: 'g-1',
        ruleId: 'r-1',
      });
    });
    await waitFor(() => {
      expect(screen.queryByText(/@wblord · glm-5\.2/)).toBeNull();
    });
    expect(toast.success).toHaveBeenCalledWith('ai.groups.quotas.deleted');
  });

  it('member view hides the form and delete buttons', async () => {
    groupsQuotaRulesList.mockResolvedValue({ rules: [makeRule()] });

    render(<GroupQuotasTab groupId="g-1" isOwner={false} />);

    await waitFor(() => {
      expect(screen.getByText(/@wblord · glm-5\.2/)).toBeTruthy();
    });
    expect(screen.queryByText('ai.groups.quotas.addRule')).toBeNull();
    expect(screen.queryByLabelText('ai.groups.quotas.deleteRule')).toBeNull();
  });
});
