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

describe('MarketplaceOverviewTab feature status badges', () => {
  it('stable feature renders a readable success badge next to the title', () => {
    renderTab(mkItem({ features: [{ title: 'Relay checks', status: 'stable' }] }));

    const badge = screen.getByText('marketplace.featureStatus.stable');
    expect(badge.className).toContain('bg-emerald-500/10');
    expect(badge.className).toContain('text-emerald-300');

    const row = screen.getByText('Relay checks').closest('li')!;
    expect(row.className).toContain('gap-2.5');
    expect(row.className).not.toContain('justify-between');
  });

  it('beta feature renders a warning badge', () => {
    renderTab(mkItem({ features: [{ title: 'TOTP', status: 'beta' }] }));

    const badge = screen.getByText('marketplace.featureStatus.beta');
    expect(badge.className).toContain('bg-amber-500/10');
    expect(badge.className).toContain('text-amber-300');
  });

  it('deprecated feature renders a danger badge', () => {
    renderTab(mkItem({ features: [{ title: 'Legacy relay', status: 'deprecated' }] }));

    const badge = screen.getByText('marketplace.featureStatus.deprecated');
    expect(badge.className).toContain('bg-red-500/10');
    expect(badge.className).toContain('text-red-300');
  });

  it('planned feature renders a slate badge', () => {
    renderTab(mkItem({ features: [{ title: 'Cloud sync', status: 'planned' }] }));

    const badge = screen.getByText('marketplace.featureStatus.planned');
    expect(badge.className).toContain('bg-slate-500/10');
    expect(badge.className).toContain('text-slate-300');
  });

  it('no bare status dots: every status is visible text', () => {
    renderTab(
      mkItem({
        features: [
          { title: 'Relay checks', status: 'stable' },
          { title: 'TOTP', status: 'beta' },
        ],
      }),
    );

    expect(screen.getByText('marketplace.featureStatus.stable')).toBeTruthy();
    expect(screen.getByText('marketplace.featureStatus.beta')).toBeTruthy();
    expect(screen.queryAllByTitle('marketplace.status.stable')).toHaveLength(0);
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
