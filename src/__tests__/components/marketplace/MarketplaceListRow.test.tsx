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
import type { MarketplaceItem } from '@/lib/backend/modules/marketplace';

jest.mock('@/lib/backend/core/invoke', () => ({
  setAuthExpiredHandler: jest.fn(),
  safeInvoke: jest.fn(),
  BackendError: class extends Error {},
}));

jest.mock('@/lib/i18n', () => ({
  t: (key: string) => key,
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

    expect(screen.getByTitle('marketplace.devCopy')).toBeTruthy();
    expect(screen.queryByText('marketplace.updateAvailable')).toBeNull();
    expect(screen.queryByRole('button', { name: 'marketplace.update' })).toBeNull();
    expect(screen.getByText('marketplace.installed')).toBeTruthy();
  });
});

describe('MarketplaceListRow card cleanup', () => {
  beforeEach(() => {
    jest.clearAllMocks();

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

  it('dev marker renders with title from t()', () => {
    renderRow(mkItem({ dev_shadow: true }));

    const marker = screen.getByTitle('marketplace.devCopy');
    expect(marker.tagName).toBe('SPAN');
    expect(marker.querySelector('svg')).toBeTruthy();
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
    expect(row.className).toContain('border-l-2');
    expect(row.className).toContain('border-indigo-400');
    expect(row.className).toContain('bg-indigo-500/[0.12]');
    expect(scrollSpy).toHaveBeenCalledWith({ block: 'nearest' });
  });
});
