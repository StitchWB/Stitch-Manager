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

  it('renders author, version, category and badge chips on the card', async () => {
    jest.spyOn(catalogModule, 'getCatalog').mockResolvedValue([
      mk({
        id: 'rich',
        name: 'Rich Plugin',
        version: '2026.10.10',
        author: 'WhiteBite',
        category: 'ai-tools',
        status: 'stable',
        badges: ['recommended'],
      }),
      mk({ id: 'uncat', name: 'Uncat Plugin', category: 'weird-cat' }),
    ]);

    render(
      <MemoryRouter>
        <CatalogPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Rich Plugin')).toBeTruthy();
    });
    expect(screen.getByText('v2026.10.10')).toBeTruthy();
    expect(screen.getByText('Author: WhiteBite')).toBeTruthy();
    expect(screen.getByText('AI tools')).toBeTruthy();
    expect(screen.getByText('Recommended')).toBeTruthy();
    expect(screen.getByText('weird-cat')).toBeTruthy();
  });

  it('renders homepage/repository anchors in a new tab only when present', async () => {
    jest.spyOn(catalogModule, 'getCatalog').mockResolvedValue([
      mk({
        id: 'linked',
        name: 'Linked Plugin',
        homepage: 'https://example.com/home',
        repository: 'https://github.com/org/repo',
      }),
      mk({ id: 'plain', name: 'Plain Plugin' }),
    ]);

    render(
      <MemoryRouter>
        <CatalogPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Linked Plugin')).toBeTruthy();
    });

    const homepage = screen.getByRole('link', { name: 'Homepage' });
    expect(homepage.getAttribute('href')).toBe('https://example.com/home');
    expect(homepage.getAttribute('target')).toBe('_blank');
    expect(homepage.getAttribute('rel')).toBe('noreferrer');

    const repository = screen.getByRole('link', { name: 'Repository' });
    expect(repository.getAttribute('href')).toBe('https://github.com/org/repo');
    expect(repository.getAttribute('target')).toBe('_blank');

    expect(screen.getAllByRole('link', { name: 'Homepage' })).toHaveLength(1);
    expect(screen.getAllByRole('link', { name: 'Repository' })).toHaveLength(1);
  });

  it('details toggle expands features and the latest changelog entry', async () => {
    const user = userEvent.setup();
    jest.spyOn(catalogModule, 'getCatalog').mockResolvedValue([
      mk({
        id: 'detailed',
        name: 'Detailed Plugin',
        version: '1.0.0',
        features: [
          { title: { en: 'Feature One', ru: 'Фича один' }, status: 'stable' },
          { title: 'Plain feature', status: 'planned' },
        ],
        changelog: [
          {
            version: '1.1.0',
            date: '2026-10-01',
            changes: ['Change A', 'Change B', 'Change C', 'Change D', 'Change E'],
          },
          { version: '1.0.0', date: '2026-09-01', changes: ['Initial release'] },
        ],
      }),
    ]);

    render(
      <MemoryRouter>
        <CatalogPage />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Detailed Plugin')).toBeTruthy();
    });
    expect(screen.getByText('Updated: 2026-10-01')).toBeTruthy();
    expect(screen.queryByText('Feature One')).toBeNull();
    expect(screen.queryByText('Change A')).toBeNull();

    const toggle = screen.getByRole('button', { name: /details/i });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    await user.click(toggle);

    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Feature One')).toBeTruthy();
    expect(screen.getByText('Plain feature')).toBeTruthy();
    expect(screen.getByText('Latest changes')).toBeTruthy();
    expect(screen.getByText('1.1.0')).toBeTruthy();
    expect(screen.getByText('Change A')).toBeTruthy();
    expect(screen.getByText('Change D')).toBeTruthy();
    expect(screen.queryByText('Change E')).toBeNull();
    expect(screen.queryByText('Initial release')).toBeNull();

    await user.click(toggle);
    expect(screen.queryByText('Feature One')).toBeNull();
    expect(screen.queryByText('Change A')).toBeNull();
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
