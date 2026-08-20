/**
 * ShareToGroupPicker tests.
 *
 * Verifies the picker:
 *   - Pre-checks groups from alreadySharedIds.
 *   - Calls onApply with the correct (toShare, toUnshare) diff on Apply.
 *   - Disables Apply when no changes.
 *
 * Follows the same mock pattern as GroupPoolTab.test.tsx.
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
}));

// ── Mutable store state mock ─────────────────────────────────────────────────
const groupsState: any = {
  groups: [],
  loading: { list: false },
  fetchList: jest.fn(async () => undefined),
};

jest.mock('@/stores/groups', () => ({
  useGroupsStore: (selector?: (s: any) => any) =>
    selector ? selector(groupsState) : groupsState,
}));

// ── Stub UI primitives ───────────────────────────────────────────────────────
jest.mock('@/components/ui', () => ({
  Modal: ({ children, isOpen, footer }: any) =>
    isOpen ? (
      <div>
        <div>{children}</div>
        <div>{footer}</div>
      </div>
    ) : null,
  Button: ({ children, onClick, disabled }: any) => (
    <button onClick={onClick} disabled={disabled}>{children}</button>
  ),
  Checkbox: ({ checked, onChange, label }: any) => (
    <label>
      <input
        type="checkbox"
        checked={!!checked}
        onChange={onChange}
        data-testid={`cb-${String(label).replace(/\s+/g, '-')}`}
      />
      {label}
    </label>
  ),
  EmptyState: ({ title }: any) => <div>{title}</div>,
}));

import { ShareToGroupPicker } from '@/components/ai-groups/ShareToGroupPicker';

describe('ShareToGroupPicker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    groupsState.groups = [];
    groupsState.loading = { list: false };
  });

  it('pre-checks groups from alreadySharedIds', async () => {
    groupsState.groups = [
      { id: 'g1', name: 'Team A', member_count: 3, key_count: 2, role: 'owner', created_at: '' },
      { id: 'g2', name: 'Team B', member_count: 1, key_count: 0, role: 'member', created_at: '' },
    ];

    render(
      <ShareToGroupPicker
        isOpen
        onClose={() => {}}
        alreadySharedIds={['g1']}
        onApply={() => {}}
        title="test"
      />,
    );

    // setSelected is deferred via queueMicrotask — wait for it.
    await waitFor(() => {
      const cbA = screen.getByTestId('cb-Team-A') as HTMLInputElement;
      expect(cbA.checked).toBe(true);
    });
    const cbB = screen.getByTestId('cb-Team-B') as HTMLInputElement;
    expect(cbB.checked).toBe(false);
  });

  it('calls onApply with correct toShare + toUnshare diff', async () => {
    groupsState.groups = [
      { id: 'g1', name: 'Team A', member_count: 3, key_count: 2, role: 'owner', created_at: '' },
      { id: 'g2', name: 'Team B', member_count: 1, key_count: 0, role: 'member', created_at: '' },
      { id: 'g3', name: 'Team C', member_count: 2, key_count: 1, role: 'member', created_at: '' },
    ];

    const onApply = jest.fn();
    render(
      <ShareToGroupPicker
        isOpen
        onClose={() => {}}
        alreadySharedIds={['g1', 'g3']}
        onApply={onApply}
        title="test"
      />,
    );

    // Wait for the deferred setSelected to flush.
    await waitFor(() => {
      expect((screen.getByTestId('cb-Team-A') as HTMLInputElement).checked).toBe(true);
    });

    // Uncheck g1 (was shared → now unshare)
    fireEvent.click(screen.getByTestId('cb-Team-A'));
    // Check g2 (was not shared → now share)
    fireEvent.click(screen.getByTestId('cb-Team-B'));
    // g3 stays checked (no change)

    // Apply button = ai.groups.share.apply
    const applyBtn = screen.getByText('ai.groups.share.apply');
    fireEvent.click(applyBtn);

    await waitFor(() => {
      expect(onApply).toHaveBeenCalledTimes(1);
    });

    const [toShare, toUnshare] = onApply.mock.calls[0];
    expect(toShare).toEqual(['g2']);
    expect(toUnshare).toEqual(['g1']);
  });

  it('disables Apply when no changes', async () => {
    groupsState.groups = [
      { id: 'g1', name: 'Team A', member_count: 1, key_count: 0, role: 'owner', created_at: '' },
    ];

    render(
      <ShareToGroupPicker
        isOpen
        onClose={() => {}}
        alreadySharedIds={['g1']}
        onApply={() => {}}
        title="test"
      />,
    );

    // Wait for the deferred setSelected to flush so hasChanges recomputes.
    await waitFor(() => {
      expect((screen.getByTestId('cb-Team-A') as HTMLInputElement).checked).toBe(true);
    });

    const applyBtn = screen.getByText('ai.groups.share.apply') as HTMLButtonElement;
    expect(applyBtn.disabled).toBe(true);
  });

  it('keeps user checkbox changes when parent re-renders with same alreadySharedIds (new ref)', async () => {
    groupsState.groups = [
      { id: 'g1', name: 'Team A', member_count: 3, key_count: 2, role: 'owner', created_at: '' },
      { id: 'g2', name: 'Team B', member_count: 1, key_count: 0, role: 'member', created_at: '' },
    ];

    // Parent passes a NEW array reference each render with the same ids.
    // Without the value-based guard, the picker would reset selection on
    // every parent re-render, wiping the user's checkbox changes.
    const { rerender } = render(
      <ShareToGroupPicker
        isOpen
        onClose={() => {}}
        alreadySharedIds={['g1']}
        onApply={() => {}}
        title="test"
      />,
    );

    // Wait for the deferred setSelected to flush.
    await waitFor(() => {
      expect((screen.getByTestId('cb-Team-A') as HTMLInputElement).checked).toBe(true);
    });

    // User checks Team B (was not shared → now share).
    fireEvent.click(screen.getByTestId('cb-Team-B'));
    expect((screen.getByTestId('cb-Team-B') as HTMLInputElement).checked).toBe(true);

    // Parent re-renders with a NEW array reference but the same ids.
    rerender(
      <ShareToGroupPicker
        isOpen
        onClose={() => {}}
        alreadySharedIds={['g1']}
        onApply={() => {}}
        title="test"
      />,
    );

    // The user's checkbox change must survive the re-render.
    expect((screen.getByTestId('cb-Team-B') as HTMLInputElement).checked).toBe(true);
  });
});
