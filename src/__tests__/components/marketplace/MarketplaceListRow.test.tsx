/**
 * MarketplaceListRow update-semantics tests.
 *
 * The update badge and the Update button follow hasPluginUpdate (server
 * flag with semver fallback, "newer" not "different") and are suppressed
 * for plugins-local dev copies, which render a titled GitBranch marker.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { MarketplaceListRow } from '@/components/marketplace/MarketplaceListRow';
import { useServicePlugins } from '@/hooks/useServicePlugins';
import type { MarketplaceItem } from '@/lib/backend/modules/marketplace';
import type { ServicePluginInfo } from '@/lib/backend/modules/servicePlugins';

jest.mock('@/lib/backend/core/invoke', () => ({
  setAuthExpiredHandler: jest.fn(),
  safeInvoke: jest.fn(),
  BackendError: class extends Error {},
}));

jest.mock('@/lib/i18n', () => ({
  t: (key: string, params?: Record<string, string>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

jest.mock('@/hooks/useServicePlugins', () => ({
  useServicePlugins: jest.fn(),
}));

jest.mock('@/stores/app', () => ({
  useAppStore: (selector?: (s: { language: string }) => unknown) =>
    selector ? selector({ language: 'en' }) : { language: 'en' },
}));

jest.mock('sonner', () => ({
  toast: {
    error: jest.fn(),
    success: jest.fn(),
  },
}));

function mkItem(overrides: Partial<MarketplaceItem> = {}): MarketplaceItem {
  return {
    id: 'stitch-totp',
    name: 'Stitch TOTP',
    description: null,
    author: null,
    version: '1.0.0',
    source: 'official',
    entitled: true,
    installed: true,
    installed_version: '1.0.0',
    can_download: true,
    ...overrides,
  };
}

const onSelect = jest.fn();
const onInstall = jest.fn();
const onLockedClick = jest.fn();

function renderRow(item: MarketplaceItem, selected = false) {
  return render(
    <MarketplaceListRow
      item={item}
      selected={selected}
      busy={false}
      isGuest={false}
      onSelect={onSelect}
      onInstall={onInstall}
      onLockedClick={onLockedClick}
    />,
  );
}

describe('MarketplaceListRow update semantics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useServicePlugins as jest.Mock).mockReturnValue([]);

    if (!('scrollIntoView' in HTMLElement.prototype)) {
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
        configurable: true,
        writable: true,
        value: jest.fn(),
      });
    }
  });

  it('newer installed version without flags: no update badge or button', () => {
    renderRow(mkItem({ installed_version: '2.0.0', version: '1.5.0' }));

    expect(screen.queryByText('marketplace.updateAvailable')).toBeNull();
    expect(screen.queryByRole('button', { name: 'marketplace.update' })).toBeNull();
    expect(screen.getByText('marketplace.installed')).toBeTruthy();
  });

  it('older installed version without flags: badge and Update button via fallback', () => {
    renderRow(mkItem({ installed_version: '1.0.0', version: '1.1.0' }));

    expect(screen.getByText('marketplace.updateAvailable')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'marketplace.update' })).toBeTruthy();
  });

  it('update_available=false overrides differing versions', () => {
    renderRow(
      mkItem({ installed_version: '1.0.0', version: '1.1.0', update_available: false }),
    );

    expect(screen.queryByText('marketplace.updateAvailable')).toBeNull();
    expect(screen.queryByRole('button', { name: 'marketplace.update' })).toBeNull();
  });

  it('update_available=true shows the badge and Update button', () => {
    renderRow(
      mkItem({ installed_version: '1.0.0', version: '1.0.1', update_available: true }),
    );

    expect(screen.getByText('marketplace.updateAvailable')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'marketplace.update' })).toBeTruthy();
  });

  it('dev_shadow: titled GitBranch marker, no update badge or Update button', () => {
    renderRow(
      mkItem({
        installed_version: '1.0.0',
        version: '1.1.0',
        update_available: true,
        dev_shadow: true,
      }),
    );

    expect(screen.getByText('marketplace.devCopy')).toBeTruthy();
    expect(screen.queryByText('marketplace.updateAvailable')).toBeNull();
    expect(screen.queryByRole('button', { name: 'marketplace.update' })).toBeNull();
    expect(screen.getByText('marketplace.installed')).toBeTruthy();
  });
});

describe('MarketplaceListRow card cleanup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (useServicePlugins as jest.Mock).mockReturnValue([]);

    if (!('scrollIntoView' in HTMLElement.prototype)) {
      Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
        configurable: true,
        writable: true,
        value: jest.fn(),
      });
    }
  });

  it('installed-no-update status is not a button element', () => {
    renderRow(mkItem());

    const status = screen.getByText('marketplace.installed');
    expect(status.tagName).toBe('SPAN');
    expect(status.closest('button')).toBeNull();
    expect(status.className).toContain('sr-only');
    expect(
      screen.queryByRole('button', { name: 'marketplace.installed' }),
    ).toBeNull();
  });

  it('dev marker renders with an sr-only label and the branch glyph', () => {
    renderRow(mkItem({ dev_shadow: true }));

    const marker = screen.getByText('marketplace.devCopy');
    expect(marker.tagName).toBe('SPAN');
    expect(marker.className).toContain('sr-only');
    expect(marker.parentElement!.querySelector('svg')).toBeTruthy();
  });

  it('selected row has accent border and scrolls into view', () => {
    const scrollSpy = jest
      .spyOn(HTMLElement.prototype, 'scrollIntoView')
      .mockImplementation(() => undefined);

    const { rerender } = render(
      <MarketplaceListRow
        item={mkItem()}
        selected={false}
        busy={false}
        isGuest={false}
        onSelect={onSelect}
        onInstall={onInstall}
        onLockedClick={onLockedClick}
      />,
    );
    expect(scrollSpy).not.toHaveBeenCalled();

    rerender(
      <MarketplaceListRow
        item={mkItem()}
        selected
        busy={false}
        isGuest={false}
        onSelect={onSelect}
        onInstall={onInstall}
        onLockedClick={onLockedClick}
      />,
    );

    const row = screen.getByRole('button', { pressed: true });
    expect(row.className).toContain('border-l-[3px]');
    expect(row.className).toContain('border-l-vsc-blue');
    expect(row.className).toContain('bg-white/[0.05]');
    expect(scrollSpy).toHaveBeenCalledWith({ block: 'nearest' });
  });

  it('unselected row keeps a transparent 3px left border so selection never shifts layout', () => {
    renderRow(mkItem());

    const row = screen.getByRole('button', { pressed: false });
    expect(row.className).toContain('border-l-[3px]');
    expect(row.className).toContain('border-l-transparent');
    expect(row.className).not.toContain('bg-white/[0.05]');
  });

  it('runtime-disabled plugin: dimmed row with a Disabled badge', () => {
    const disabledPlugin: ServicePluginInfo = {
      id: 'stitch-totp',
      version: '1.0.0',
      enabled: false,
      status: {
        status: 'stopped',
        port: null,
        pid: null,
        uptimeSeconds: null,
        error: null,
        plugin_id: 'stitch-totp',
        restarts: 0,
        stopping: false,
      },
    };
    (useServicePlugins as jest.Mock).mockReturnValue([disabledPlugin]);

    renderRow(mkItem());

    const row = screen.getByRole('button', { pressed: false });
    expect(row.className).toContain('opacity-50');
    expect(row.className).toContain('saturate-50');
    expect(screen.getByText('marketplace.disabledBadge')).toBeTruthy();
  });

  it('enabled plugin: no dimming and no Disabled badge', () => {
    const enabledPlugin: ServicePluginInfo = {
      id: 'stitch-totp',
      version: '1.0.0',
      enabled: true,
      status: {
        status: 'running',
        port: null,
        pid: 1,
        uptimeSeconds: 1,
        error: null,
        plugin_id: 'stitch-totp',
        restarts: 0,
        stopping: false,
      },
    };
    (useServicePlugins as jest.Mock).mockReturnValue([enabledPlugin]);

    renderRow(mkItem());

    const row = screen.getByRole('button', { pressed: false });
    expect(row.className).not.toContain('opacity-50');
    expect(screen.queryByText('marketplace.disabledBadge')).toBeNull();
  });

  it('installed up-to-date row shows a version chip, not a bare checkmark', () => {
    renderRow(mkItem({ version: '0.1.1', installed_version: '0.1.1' }));

    expect(screen.getByText('v0.1.1')).toBeTruthy();
    expect(screen.getByText('marketplace.installed')).toBeTruthy();
  });
});

describe('MarketplaceListRow bundled plugins', () => {
  it('bundled provider plugin without marketplace install shows the in-build marker, not an install button', () => {
    renderRow(mkItem({ id: 'kiro-autoreg', installed: false, installed_version: null }));

    expect(screen.getByText('marketplace.bundled')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'marketplace.install' })).toBeNull();
  });

  it('non-bundled available plugin keeps the install icon button', () => {
    renderRow(mkItem({ id: 'stitch-mail', installed: false, installed_version: null }));

    expect(screen.queryByText('marketplace.bundled')).toBeNull();
    expect(screen.getByRole('button', { name: 'marketplace.install' })).toBeTruthy();
  });
});
