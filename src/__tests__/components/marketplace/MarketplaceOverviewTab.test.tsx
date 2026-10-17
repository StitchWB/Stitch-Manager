import { describe, it, expect, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { MarketplaceOverviewTab } from '@/components/marketplace/MarketplaceOverviewTab';
import type { MarketplaceItem } from '@/lib/backend/modules/marketplace';

jest.mock('@/lib/i18n', () => ({
  t: (key: string) => key,
}));

function mkItem(overrides: Partial<MarketplaceItem> = {}): MarketplaceItem {
  return {
    id: 'stitch-demo',
    name: 'Demo',
    description: null,
    author: null,
    version: '1.0.0',
    source: 'official',
    entitled: true,
    installed: false,
    installed_version: null,
    can_download: true,
    ...overrides,
  };
}

function renderTab(item: MarketplaceItem) {
  return render(<MarketplaceOverviewTab item={item} language="en" />);
}

describe('MarketplaceOverviewTab feature status dots', () => {
  it('stable feature renders an emerald dot with status title and sr-only label', () => {
    renderTab(mkItem({ features: [{ title: 'Relay checks', status: 'stable' }] }));

    const cell = screen.getByTitle('marketplace.status.stable');
    const dot = cell.querySelector('span[aria-hidden="true"]');
    expect(dot).toBeTruthy();
    expect(dot!.className).toContain('h-2');
    expect(dot!.className).toContain('w-2');
    expect(dot!.className).toContain('rounded-full');
    expect(dot!.className).toContain('bg-emerald-400');
    expect(cell.querySelector('.sr-only')!.textContent).toBe('marketplace.status.stable');
  });

  it('beta feature renders an amber dot', () => {
    renderTab(mkItem({ features: [{ title: 'TOTP', status: 'beta' }] }));

    const cell = screen.getByTitle('marketplace.status.beta');
    expect(cell.querySelector('span[aria-hidden="true"]')!.className).toContain('bg-amber-400');
  });

  it('planned feature renders a hollow slate dot', () => {
    renderTab(mkItem({ features: [{ title: 'Cloud sync', status: 'planned' }] }));

    const cell = screen.getByTitle('marketplace.status.planned');
    const dot = cell.querySelector('span[aria-hidden="true"]')!;
    expect(dot.className).toContain('bg-transparent');
    expect(dot.className).toContain('border');
    expect(dot.className).toContain('border-slate-500');
  });

  it('feature rows render no badge chips: status text exists only as sr-only', () => {
    renderTab(
      mkItem({
        features: [
          { title: 'Relay checks', status: 'stable' },
          { title: 'TOTP', status: 'beta' },
        ],
      }),
    );

    for (const key of ['marketplace.status.stable', 'marketplace.status.beta']) {
      const matches = screen.getAllByText(key);
      expect(matches.length).toBeGreaterThan(0);
      for (const node of matches) {
        expect(node.className).toContain('sr-only');
      }
    }
  });

  it('feature list spans full width with row dividers', () => {
    const { container } = renderTab(
      mkItem({ features: [{ title: 'Relay checks', status: 'stable' }] }),
    );

    const list = container.querySelector('ul')!;
    expect(list.className).toContain('w-full');
    expect(list.className).toContain('divide-y');
    expect(list.className).toContain('divide-white/5');
    expect(list.querySelector('li')!.className).toContain('w-full');
  });
});
