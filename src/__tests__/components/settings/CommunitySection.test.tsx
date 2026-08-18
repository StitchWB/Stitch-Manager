/**
 * Smoke test for CommunitySection — verifies catalog cards render from
 * mocked safeInvoke responses and that clicking Install calls the
 * install_community_plugin backend command.
 */

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { CommunitySection } from '../../../components/settings/CommunitySection';

const originalFetch = globalThis.fetch;

function mockFetchMulti(implementations: Record<string, unknown>): jest.Mock {
  const fn = jest.fn(async (url: string, _init?: RequestInit) => {
    const command = String(url).replace(/^.*\/api\//, '');
    const data = implementations[command] ?? {};
    return {
      ok: true,
      status: 200,
      json: () => Promise.resolve(data),
    };
  });
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

function countCalls(mockFn: jest.Mock, command: string): number {
  return mockFn.mock.calls.filter(
    ([u]: unknown[]) => typeof u === 'string' && u.includes(`/api/${command}`),
  ).length;
}

describe('CommunitySection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('renders catalog cards and calls install_community_plugin on click', async () => {
    const mockFn = mockFetchMulti({
      get_settings: { community_enabled: 'true' },
      get_community_catalog: {
        plugins: [
          {
            id: 'demo-plugin',
            name: 'Demo Plugin',
            version: '1.2.0',
            author: 'alice',
            description: 'A demonstration community plugin.',
            path: '/plugins/demo',
            services: ['kiro', 'windsurf'],
            sha256: 'abc',
          },
        ],
      },
      list_installed_community: { packages: [] },
      list_local_packages: { packages: [] },
      install_community_plugin: { success: true },
    });

    render(<CommunitySection />);

    // Cards render from mocked safeInvoke
    await waitFor(() => {
      expect(screen.getByText('Demo Plugin')).toBeInTheDocument();
    });
    expect(screen.getByText('1.2.0')).toBeInTheDocument();
    expect(screen.getByText('alice')).toBeInTheDocument();
    expect(screen.getByText('kiro')).toBeInTheDocument();
    expect(screen.getByText('windsurf')).toBeInTheDocument();

    // Install button is visible (plugin not installed)
    const installBtn = screen.getByText('Install');
    expect(installBtn).toBeInTheDocument();

    // Click install → calls install_community_plugin command
    fireEvent.click(installBtn);

    await waitFor(() => {
      expect(countCalls(mockFn, 'install_community_plugin')).toBeGreaterThanOrEqual(1);
    });

    // Verify the install call carried the correct body shape
    const installCalls = mockFn.mock.calls.filter(
      ([u]: unknown[]) =>
        typeof u === 'string' && u.includes('/api/install_community_plugin'),
    );
    const body = JSON.parse(
      (installCalls[installCalls.length - 1][1] as RequestInit).body as string,
    );
    expect(body).toEqual({ id: 'demo-plugin', version: '1.2.0' });
  });

  it('shows empty state when catalog is empty', async () => {
    mockFetchMulti({
      get_settings: { community_enabled: 'true' },
      get_community_catalog: { plugins: [] },
      list_installed_community: { packages: [] },
      list_local_packages: { packages: [] },
    });

    render(<CommunitySection />);

    await waitFor(() => {
      expect(screen.getByText('No community plugins')).toBeInTheDocument();
    });
  });
});
