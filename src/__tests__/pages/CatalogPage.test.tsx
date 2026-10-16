/**
 * CatalogPage render tests.
 *
 * The public /catalog page renders the distribution server's public feed
 * as a card grid; empty and failed feeds surface their states, and the
 * logged-out card CTA opens the login surface.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import CatalogPage from '../../pages/CatalogPage';
import * as catalogModule from '@/lib/backend/modules/catalog';
import type { CatalogEntry } from '@/lib/backend/modules/catalog';

jest.mock('../../stores/app', () => ({
  useAppStore: (selector?: (s: { language: string }) => unknown) =>
    selector ? selector({ language: 'en' }) : { language: 'en' },
}));

const setAuthView = jest.fn();

jest.mock('../../stores/auth', () => ({
  useAuthStore: (selector: (s: unknown) => unknown) =>
    selector({ user: null, setAuthView }),
}));

const mk = (overrides: Partial<CatalogEntry> = {}): CatalogEntry => ({
  id: 'plugin-x',
  name: 'Plugin X',
  version: '1.0.0',
  description: 'Does X.',
  author: '',
  description_i18n: null,
  category: null,
  status: null,
  icon: null,
  features: null,
  changelog: null,
  homepage: null,
  repository: null,
  ...overrides,
});

describe('CatalogPage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders plugin cards from the catalog feed', async () => {
    jest.spyOn(catalogModule, 'getCatalog').mockResolvedValue([
      mk({ id: 'official', name: 'Official Plugin', description: 'Official description.' }),
      mk({
        id: 'community',
        name: 'Community Plugin',
        description: 'Fallback description.',
        description_i18n: { en: 'Localized community description.', ru: 'Локализованное описание.' },
        source: { type: 'release', url: 'https://example.com/pkg.tar.gz', sha256: 'abc' },
        status: 'beta',
        icon: '🧩',
      }),
    ]);

    render(
      <MemoryRouter>
        <CatalogPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Official Plugin')).toBeTruthy();
    });
    expect(screen.getByText('Official description.')).toBeTruthy();
    expect(screen.getByText('Community Plugin')).toBeTruthy();
    expect(screen.getByText('Localized community description.')).toBeTruthy();
    // "Official"/"Community" appear twice: source-filter chip + card badge.
    expect(screen.getAllByText('Official').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Community').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Beta')).toBeTruthy();
    expect(screen.getByText('Plugins: 2')).toBeTruthy();
  });

  it('filters cards by search query and source', async () => {
    const user = userEvent.setup();
    jest.spyOn(catalogModule, 'getCatalog').mockResolvedValue([
      mk({ id: 'official', name: 'Official Plugin', description: 'Official description.' }),
      mk({
        id: 'community',
        name: 'Community Plugin',
        description: 'Community description.',
        source: { type: 'release', url: 'https://example.com/pkg.tar.gz', sha256: 'abc' },
      }),
    ]);

    render(
      <MemoryRouter>
        <CatalogPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Official Plugin')).toBeTruthy();
    });

    await user.type(screen.getByRole('textbox', { name: /search by name/i }), 'community');
    expect(screen.queryByText('Official Plugin')).toBeNull();
    expect(screen.getByText('Community Plugin')).toBeTruthy();
    expect(screen.getByText('Plugins: 1')).toBeTruthy();

    await user.clear(screen.getByRole('textbox', { name: /search by name/i }));
    await user.click(screen.getByRole('button', { name: 'Official' }));
    expect(screen.getByText('Official Plugin')).toBeTruthy();
    expect(screen.queryByText('Community Plugin')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getByText('Official Plugin')).toBeTruthy();
    expect(screen.getByText('Community Plugin')).toBeTruthy();
  });

  it('shows a no-results state when filters exclude everything', async () => {
    const user = userEvent.setup();
    jest.spyOn(catalogModule, 'getCatalog').mockResolvedValue([mk()]);

    render(
      <MemoryRouter>
        <CatalogPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Plugin X')).toBeTruthy();
    });

    await user.type(screen.getByRole('textbox', { name: /search by name/i }), 'zzz');
    expect(screen.getByText('Nothing found')).toBeTruthy();
    expect(screen.queryByText('Plugin X')).toBeNull();
  });

  it('shows the empty state when the feed has no plugins', async () => {
    jest.spyOn(catalogModule, 'getCatalog').mockResolvedValue([]);

    render(
      <MemoryRouter>
        <CatalogPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('No plugins yet')).toBeTruthy();
    });
  });

  it('shows the error state with retry when the feed fails', async () => {
    jest
      .spyOn(catalogModule, 'getCatalog')
      .mockRejectedValue(new Error('Distribution server unreachable'));

    render(
      <MemoryRouter>
        <CatalogPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Couldn't load the catalog")).toBeTruthy();
    });
    expect(screen.getByText('Distribution server unreachable')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });

  it('logged-out card CTA opens the login surface', async () => {
    const user = userEvent.setup();
    jest.spyOn(catalogModule, 'getCatalog').mockResolvedValue([mk()]);

    render(
      <MemoryRouter>
        <CatalogPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Plugin X')).toBeTruthy();
    });
    await user.click(screen.getByRole('button', { name: /log in to install/i }));
    expect(setAuthView).toHaveBeenCalledWith('login');
  });
});
