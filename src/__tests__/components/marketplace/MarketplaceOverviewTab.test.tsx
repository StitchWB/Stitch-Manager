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
  return render(
    <MarketplaceOverviewTab item={item} language="en" sourceLabel="Official" />,
  );
}

function statusOf(label: string) {
  const text = screen.getByText(label);
  const dot = text.previousElementSibling as HTMLElement;
  return { text, dot };
}

describe('MarketplaceOverviewTab feature status', () => {
  it('stable feature: muted text plus emerald dot, no pill background', () => {
    renderTab(mkItem({ features: [{ title: 'Relay checks', status: 'stable' }] }));

    const { text, dot } = statusOf('marketplace.featureStatus.stable');
    expect(text.className).toContain('text-slate-500');
    expect(dot.className).toContain('bg-emerald-400');
    expect(text.className).not.toContain('bg-emerald-500/10');
  });

  it('beta feature: amber text plus amber dot', () => {
    renderTab(mkItem({ features: [{ title: 'TOTP', status: 'beta' }] }));

    const { text, dot } = statusOf('marketplace.featureStatus.beta');
    expect(text.className).toContain('text-amber-300');
    expect(dot.className).toContain('bg-amber-400');
  });

  it('planned feature: hollow dot', () => {
    renderTab(mkItem({ features: [{ title: 'Cloud sync', status: 'planned' }] }));

    const { dot } = statusOf('marketplace.featureStatus.planned');
    expect(dot.className).toContain('border-slate-500');
  });

  it('status stays visible text next to the feature title', () => {
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
    const row = screen.getByText('Relay checks').closest('li')!;
    expect(row.className).toContain('justify-between');
  });

  it('feature list spans the reading column with row dividers', () => {
    const { container } = renderTab(
      mkItem({ features: [{ title: 'Relay checks', status: 'stable' }] }),
    );

    const list = container.querySelector('ul')!;
    expect(list.className).toContain('w-full');
    expect(list.className).toContain('divide-y');
    expect(list.className).toContain('divide-white/5');
    expect(list.querySelector('li')!.className).toContain('w-full');
  });

  it('metadata grid renders beside the overview on the same tab', () => {
    renderTab(mkItem());

    expect(screen.getByTestId('plugin-meta-grid')).toBeTruthy();
  });
});
