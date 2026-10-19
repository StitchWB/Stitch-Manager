/**
 * GroupPluginsTab tests.
 *
 * Covers:
 *   - Loading skeleton, load-error state and empty state.
 *   - Owner: plugin rows with audience badge and toggle; toggling calls
 *     group_plugin_toggle, updates optimistically and refetches the list.
 *   - Owner: a refused toggle rolls back the optimistic flip and toasts
 *     the backend error message.
 *   - Member: read-only badges instead of toggles plus the readonly hint.
 *
 * Mirrors GroupQuotasTab.test.tsx: mocked i18n (returns keys), stubbed UI
 * primitives, mocked backend module.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

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

jest.mock('sonner', () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  },
}));

const groupPluginList = jest.fn();
const groupPluginToggle = jest.fn();
jest.mock('@/lib/backend/modules/groupPlugins', () => ({
  groupPluginList: (...args: unknown[]) => groupPluginList(...args),
  groupPluginToggle: (...args: unknown[]) => groupPluginToggle(...args),
}));

jest.mock('@/components/ui', () => ({
  GlassCard: ({ children, ...rest }: any) => <div {...rest}>{children}</div>,
  Badge: ({ children, ...rest }: any) => <span {...rest}>{children}</span>,
  EmptyState: ({ title, description, ...rest }: any) => (
    <div {...rest}>
      <span>{title}</span>
      {description ? <span>{description}</span> : null}
    </div>
  ),
  SkeletonLoader: () => <div data-testid="skeleton" />,
  Toggle: ({ checked, onChange, disabled, label }: any) => (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  ),
}));

import { GroupPluginsTab } from '@/components/ai-groups/GroupPluginsTab';
import type { GroupPluginListResponse } from '@/lib/backend/modules/groupPlugins';
import { toast } from 'sonner';

function makeListResponse(
  overrides: Partial<GroupPluginListResponse> = {},
): GroupPluginListResponse {
  return {
    level: overrides.level ?? 'verified',
    maxGatedPlugins: overrides.maxGatedPlugins ?? 3,
    plugins: overrides.plugins ?? [
      { id: 'stitch-totp', name: 'TOTP', version: '1.0.0', audience: 'public', granted: true },
      { id: 'stitch-mail', name: 'Mail', version: '2.1.0', audience: 'group', granted: false },
    ],
  };
}

describe('GroupPluginsTab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    groupPluginList.mockResolvedValue(makeListResponse());
    groupPluginToggle.mockResolvedValue({ success: true });
  });

  it('renders skeleton while loading', () => {
    groupPluginList.mockReturnValue(new Promise(() => {}));
    render(<GroupPluginsTab groupId="g-1" isOwner={true} />);
    expect(screen.getByTestId('skeleton')).toBeTruthy();
  });

  it('renders the load error with the backend message', async () => {
    groupPluginList.mockRejectedValue(
      new Error('Only the group owner or an admin can manage group plugins'),
    );
    render(<GroupPluginsTab groupId="g-1" isOwner={false} />);
    await waitFor(() => {
      expect(screen.getByText('ai.groups.detailLoadFailed')).toBeTruthy();
    });
    expect(
      screen.getByText('Only the group owner or an admin can manage group plugins'),
    ).toBeTruthy();
  });

  it('renders empty state when the manifest has no plugins', async () => {
    groupPluginList.mockResolvedValue(makeListResponse({ plugins: [] }));
    render(<GroupPluginsTab groupId="g-1" isOwner={true} />);
    await waitFor(() => {
      expect(screen.getByText('ai.groups.plugins.empty')).toBeTruthy();
    });
  });

  it('owner sees toggles and the level/cap badges', async () => {
    render(<GroupPluginsTab groupId="g-1" isOwner={true} />);
    await waitFor(() => {
      expect(screen.getByText('TOTP')).toBeTruthy();
    });
    expect(screen.getByText('ai.groups.plugins.level.verified')).toBeTruthy();
    expect(screen.getByText('ai.groups.plugins.cap')).toBeTruthy();
    expect(screen.getByText('ai.groups.plugins.audience.public')).toBeTruthy();
    expect(screen.getByText('ai.groups.plugins.audience.group')).toBeTruthy();

    const switches = screen.getAllByRole('switch');
    expect(switches).toHaveLength(2);
    expect(switches[0].getAttribute('aria-checked')).toBe('true');
    expect(switches[1].getAttribute('aria-checked')).toBe('false');
  });

  it('owner toggle is optimistic, calls the backend and refetches', async () => {
    render(<GroupPluginsTab groupId="g-1" isOwner={true} />);
    await waitFor(() => {
      expect(screen.getByText('Mail')).toBeTruthy();
    });

    const grantSwitch = screen.getAllByRole('switch')[1];
    fireEvent.click(grantSwitch);

    expect(grantSwitch.getAttribute('aria-checked')).toBe('true');

    await waitFor(() => {
      expect(groupPluginToggle).toHaveBeenCalledWith({
        groupId: 'g-1',
        pluginId: 'stitch-mail',
        granted: true,
      });
    });
    await waitFor(() => {
      expect(groupPluginList).toHaveBeenCalledTimes(2);
    });
    expect(toast.success).toHaveBeenCalledWith('ai.groups.plugins.updated');
  });

  it('refused toggle rolls back and toasts the backend error', async () => {
    groupPluginToggle.mockRejectedValue(new Error('group plugin cap reached (3)'));
    render(<GroupPluginsTab groupId="g-1" isOwner={true} />);
    await waitFor(() => {
      expect(screen.getByText('Mail')).toBeTruthy();
    });

    const grantSwitch = screen.getAllByRole('switch')[1];
    fireEvent.click(grantSwitch);
    expect(grantSwitch.getAttribute('aria-checked')).toBe('true');

    await waitFor(() => {
      expect(grantSwitch.getAttribute('aria-checked')).toBe('false');
    });
    expect(toast.error).toHaveBeenCalledWith('group plugin cap reached (3)');
    expect(groupPluginList).toHaveBeenCalledTimes(1);
  });

  it('member sees read-only badges and the readonly hint', async () => {
    render(<GroupPluginsTab groupId="g-1" isOwner={false} />);
    await waitFor(() => {
      expect(screen.getByText('TOTP')).toBeTruthy();
    });
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.getAllByText('ai.groups.plugins.granted')).toHaveLength(1);
    expect(screen.getAllByText('ai.groups.plugins.notGranted')).toHaveLength(1);
    expect(screen.getByText('ai.groups.plugins.memberReadonly')).toBeTruthy();
  });
});
