/**
 * Smoke test for the Overrides block in CommunitySection — verifies
 * override rows render from mocked list_overrides responses and that
 * clicking Create calls the create_override backend command.
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

describe('CommunitySection — Overrides block', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    // Wait for the safeInvoke response cache (50ms TTL) to expire so
    // mock fetch responses from CommunitySection.test.tsx don't leak in
    // as empty list_overrides responses.
    await new Promise(resolve => setTimeout(resolve, 60));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('renders override rows and calls create_override on click', async () => {
    const mockFn = mockFetchMulti({
      get_settings: { community_enabled: 'true' },
      get_community_catalog: { plugins: [] },
      list_installed_community: { packages: [] },
      list_local_packages: {
        packages: [
          {
            id: 'kiro-autoreg',
            name: 'Kiro Auto-Registration',
            version: '1.0.0',
            services: ['kiro'],
            path: '/tmp/plugins-local/kiro-autoreg',
          },
        ],
      },
      list_overrides: {
        overrides: [
          {
            plugin_id: 'kiro-autoreg',
            has_override: false,
            valid: false,
            path: '/tmp/overrides/kiro-autoreg/scenario.json',
          },
        ],
      },
      create_override: { success: true, path: '/tmp/overrides/kiro-autoreg/scenario.json' },
    });

    render(<CommunitySection />);

    // Override block title + entries render from mocked safeInvoke
    await waitFor(() => {
      expect(screen.getByText('Overrides')).toBeInTheDocument();
    });

    // Wait for override entry to load — "none" badge appears
    const noneBadge = await screen.findByText('none');
    expect(noneBadge).toBeInTheDocument();

    // Plugin name renders in both Author Cabinet and Overrides block
    const nameElements = screen.getAllByText('Kiro Auto-Registration');
    expect(nameElements.length).toBeGreaterThanOrEqual(1);

    // Create button is visible (no override)
    const createBtn = screen.getByText('Create');
    expect(createBtn).toBeInTheDocument();

    // Click create → calls create_override command
    fireEvent.click(createBtn);

    await waitFor(() => {
      expect(countCalls(mockFn, 'create_override')).toBeGreaterThanOrEqual(1);
    });

    // Verify the create call carried the correct body shape
    const createCalls = mockFn.mock.calls.filter(
      ([u]: unknown[]) => typeof u === 'string' && u.includes('/api/create_override'),
    );
    const body = JSON.parse(
      (createCalls[createCalls.length - 1][1] as RequestInit).body as string,
    );
    expect(body).toEqual({ plugin_id: 'kiro-autoreg' });
  });

  it('shows active badge and Validate/Remove/Send patch buttons when override exists', async () => {
    mockFetchMulti({
      get_settings: { community_enabled: 'true' },
      get_community_catalog: { plugins: [] },
      list_installed_community: { packages: [] },
      list_local_packages: {
        packages: [
          {
            id: 'kiro-autoreg',
            name: 'Kiro Auto-Registration',
            version: '1.0.0',
            services: ['kiro'],
            path: '/tmp/plugins-local/kiro-autoreg',
          },
        ],
      },
      list_overrides: {
        overrides: [
          {
            plugin_id: 'kiro-autoreg',
            has_override: true,
            valid: true,
            path: '/tmp/overrides/kiro-autoreg/scenario.json',
          },
        ],
      },
    });

    render(<CommunitySection />);

    await waitFor(() => {
      expect(screen.getByText('Overrides')).toBeInTheDocument();
    });

    // "active" badge renders (valid override) — wait for async load
    const activeBadge = await screen.findByText('active');
    expect(activeBadge).toBeInTheDocument();

    // Validate, Remove, Send patch buttons visible
    expect(screen.getByText('Validate')).toBeInTheDocument();
    expect(screen.getByText('Remove')).toBeInTheDocument();
    expect(screen.getByText('Send patch')).toBeInTheDocument();

    // Create button NOT visible (override already exists)
    expect(screen.queryByText('Create')).not.toBeInTheDocument();
  });

  it('shows empty state when no installed plugins', async () => {
    mockFetchMulti({
      get_settings: { community_enabled: 'true' },
      get_community_catalog: { plugins: [] },
      list_installed_community: { packages: [] },
      list_local_packages: { packages: [] },
      list_overrides: { overrides: [] },
    });

    render(<CommunitySection />);

    await waitFor(() => {
      expect(screen.getByText('Overrides')).toBeInTheDocument();
    });

    // Empty state renders — wait for async load
    const emptyTitle = await screen.findByText('No installed plugins');
    expect(emptyTitle).toBeInTheDocument();
  });
});
