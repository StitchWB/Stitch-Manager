import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, fireEvent } from '@testing-library/react';
import { MarketplaceFilterBar } from '@/components/marketplace/MarketplaceFilterBar';
import type { MarketplaceCategory } from '@/lib/backend/modules/marketplace';

jest.mock('@/lib/i18n', () => ({
  t: (key: string) => key,
}));

const onQueryChange = jest.fn();
const onToggleBadge = jest.fn();
const onClearBadges = jest.fn();
const onToggleCategory = jest.fn();
const onClearCategories = jest.fn();

function renderBar(overrides: Record<string, unknown> = {}) {
  return render(
    <MarketplaceFilterBar
      query=""
      onQueryChange={onQueryChange}
      badgeFilter={[]}
      onToggleBadge={onToggleBadge}
      onClearBadges={onClearBadges}
      categoryFilter={[]}
      onToggleCategory={onToggleCategory}
      onClearCategories={onClearCategories}
      categoryCounts={
        new Map<MarketplaceCategory, number>([
          ['engine', 5],
          ['autoreg', 3],
        ])
      }
      {...overrides}
    />,
  );
}

function openPopover() {
  fireEvent.click(screen.getByTestId('marketplace-filters-trigger'));
  return screen.getByTestId('marketplace-filters-popover');
}

describe('MarketplaceFilterBar filters popover', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders no chip rows and a closed popover by default', () => {
    renderBar();
    expect(screen.queryByTestId('marketplace-filters-popover')).toBeNull();
    expect(screen.queryByText('marketplace.badgeRecommended')).toBeNull();
    expect(screen.queryByText('marketplace.categories.engine')).toBeNull();
  });

  it('opens the popover on trigger click', () => {
    renderBar();
    openPopover();
    expect(screen.getByText('marketplace.badgeRecommended')).toBeTruthy();
    expect(screen.getByText('marketplace.categories.engine')).toBeTruthy();
  });

  it('closes on Escape', () => {
    renderBar();
    openPopover();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('marketplace-filters-popover')).toBeNull();
  });

  it('closes on outside mousedown', () => {
    renderBar();
    openPopover();
    fireEvent.mouseDown(screen.getByPlaceholderText('marketplace.searchPlaceholder'));
    expect(screen.queryByTestId('marketplace-filters-popover')).toBeNull();
  });

  it('badge row calls onToggleBadge with the badge key', () => {
    renderBar();
    openPopover();
    fireEvent.click(screen.getByRole('button', { name: 'marketplace.badgeRecommended' }));
    expect(onToggleBadge).toHaveBeenCalledWith('recommended');
  });

  it('category row calls onToggleCategory with the category', () => {
    renderBar();
    openPopover();
    fireEvent.click(screen.getByRole('button', { name: 'marketplace.categories.engine 5' }));
    expect(onToggleCategory).toHaveBeenCalledWith('engine');
  });

  it('badge All row calls onClearBadges, category All row calls onClearCategories', () => {
    renderBar();
    openPopover();
    fireEvent.click(screen.getByRole('button', { name: 'marketplace.badgeFilterAll' }));
    fireEvent.click(screen.getByRole('button', { name: 'marketplace.categoryFilterAll' }));
    expect(onClearBadges).toHaveBeenCalledTimes(1);
    expect(onClearCategories).toHaveBeenCalledTimes(1);
  });

  it('reset button clears both filters', () => {
    renderBar();
    openPopover();
    fireEvent.click(screen.getByRole('button', { name: 'marketplace.filtersReset' }));
    expect(onClearBadges).toHaveBeenCalledTimes(1);
    expect(onClearCategories).toHaveBeenCalledTimes(1);
  });

  it('active count indicator reflects two active filters', () => {
    renderBar({ badgeFilter: ['recommended'], categoryFilter: ['engine'] as MarketplaceCategory[] });
    expect(screen.getByTestId('filters-active-count').textContent).toBe('2');
  });

  it('no count indicator without active filters', () => {
    renderBar();
    expect(screen.queryByTestId('filters-active-count')).toBeNull();
  });
});
