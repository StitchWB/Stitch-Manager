/**
 * Dashboard page — command center tests.
 *
 * Verifies:
 *   (a) Health chip renders from the insights health report.
 *   (b) Action queue shows a danger row for a near-limit account.
 *   (c) Fleet row shows active/target derived from settings.fleetTargets.
 *   (d) Pinning a fleet row persists in useUIPreferencesStore and reorders rows.
 *
 * Mocks: invoke (safeInvoke), events (listen/emit), Header, sonner.
 * Real stores are used and seeded via setState; real i18n (en) is used so
 * assertions run against actual localized strings.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import Dashboard from '../../pages/Dashboard';
import { safeInvoke } from '@/lib/backend/core/invoke';
import { _resetForTests } from '@/lib/backend/modules/servicePlugins';
import type { Account } from '@/types/generated';
import { useAccountsStore } from '../../stores/accounts';
import { useSettingsStore } from '../../stores/settings';
import { useAppStore } from '../../stores/app';
import { useLogsStore } from '../../stores/logs';
import { useUIPreferencesStore } from '../../stores/uiPreferences';

jest.mock('../../lib/backend/core/invoke', () => ({
  setAuthExpiredHandler: jest.fn(),
  safeInvoke: jest.fn(),
  BackendError: class extends Error {},
}));

jest.mock('@/lib/events', () => ({
  listen: jest.fn(async () => jest.fn()),
  emit: jest.fn(async () => undefined),
}));

jest.mock('../../components/layout/Header', () => ({
  __esModule: true,
  default: ({ title, actions }: { title: string; actions?: React.ReactNode }) => (
    <div data-testid="header">
      {title}
      {actions}
    </div>
  ),
}));

jest.mock('sonner', () => ({
  toast: {
    error: jest.fn(),
    success: jest.fn(),
    info: jest.fn(),
    warning: jest.fn(),
  },
}));

function makeAccount(overrides: Partial<Account>): Account {
  return {
    id: 1,
    provider: 'kiro',
    email: 'test@example.com',
    token: null,
    refreshToken: null,
    quota: { used: 0, limit: 0 },
    status: 'active',
    expiresAt: null,
    lastUsedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: null,
    metadata: null,
    providerType: null,
    providerSubtype: null,
    providerMetadata: null,
    machineId: null,
    patchConfig: null,
    patchAppliedAt: null,
    registrationPassword: null,
    registrationDate: null,
    registrationMethod: null,
    registrationMetadata: null,
    browserProfilePath: null,
    cookies: null,
    sessionData: null,
    useCount: 0,
    lastError: null,
    errorCount: 0,
    successRate: 0,
    notes: null,
    tags: null,
    lastLoginAt: null,
    loginCount: 0,
    accountRegion: null,
    proxyId: null,
    ...overrides,
  };
}

const runningPlugin = {
  id: 'echo',
  version: '1.0.0',
  status: {
    status: 'running',
    port: null,
    pid: 7,
    uptimeSeconds: 120,
    error: null,
    plugin_id: 'echo',
    restarts: 0,
    stopping: false,
  },
};

function seedStores() {
  useAppStore.setState({
    providers: [
      { id: 'kiro', name: 'Kiro', version: 'v2', activeCount: 0, status: 'active', color: 'from-purple-500 to-indigo-600' },
      { id: 'windsurf', name: 'Windsurf', version: 'v1', activeCount: 0, status: 'active', color: 'from-cyan-400 to-blue-500' },
    ],
  });
  useAccountsStore.setState({
    accounts: [
      makeAccount({ id: 1, provider: 'kiro', status: 'active', quota: { used: 95, limit: 100 } }),
      makeAccount({ id: 2, provider: 'kiro', status: 'active', quota: { used: 10, limit: 100 } }),
      makeAccount({ id: 3, provider: 'kiro', status: 'banned', quota: { used: 0, limit: 0 } }),
      makeAccount({ id: 4, provider: 'windsurf', status: 'active', quota: { used: 5, limit: 100 } }),
    ],
  });
  useSettingsStore.setState({
    settings: { fleetTargets: { kiro: 5, windsurf: 1 } },
  });
  useLogsStore.setState({ logs: [] });
  useUIPreferencesStore.setState({
    dashboard: { pinnedProviders: [], collapsedSections: [] },
  });
}

function mockInvokeDefaults() {
  (safeInvoke as jest.Mock).mockImplementation((cmd: string, args?: Record<string, unknown>) => {
    switch (cmd) {
      case 'get_registration_jobs':
        return Promise.resolve([]);
      case 'list_service_plugins':
        return Promise.resolve([runningPlugin]);
      case 'get_scheduled_tasks':
        return Promise.resolve([]);
      case 'get_scheduler_status':
        return Promise.resolve(false);
      case 'get_proxy_status':
        return Promise.resolve({ running: false, port: null });
      case 'get_marketplace':
        return Promise.resolve({ items: [], activated: false, feeds: null });
      case 'email_inbox_list_profiles':
        return Promise.resolve([]);
      case 'list_totp_keys':
        return Promise.resolve([]);
      case 'get_friends':
        return Promise.resolve({ items: [] });
      case 'get_radar_stats':
        return Promise.resolve({ services: 0, offers: 0, active: 0, dead: 0, by_type: {} });
      case 'get_settings':
        return Promise.resolve(useSettingsStore.getState().settings ?? {});
      case 'update_settings':
        return Promise.resolve(args?.settings ?? {});
      default:
        return Promise.resolve([]);
    }
  });
}

function renderDashboard() {
  return render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>,
  );
}

describe('Dashboard command center', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _resetForTests();
    mockInvokeDefaults();
    seedStores();
  });

  it('(a) renders the health chip', async () => {
    renderDashboard();
    expect(await screen.findByTestId('health-chip')).toBeTruthy();
  });

  it('(b) shows an action queue row for the near-limit account', async () => {
    renderDashboard();
    const queue = await screen.findByTestId('action-queue');
    expect(await within(queue).findByText('1 accounts near quota limit')).toBeTruthy();
  });

  it('(c) fleet row shows active/target from fleetTargets', async () => {
    renderDashboard();
    const row = await screen.findByTestId('fleet-row-kiro');
    expect(await within(row).findByText('/5')).toBeTruthy();
    expect(within(row).getByText('2')).toBeTruthy();
  });

  it('(d) pinning a fleet row persists and reorders rows', async () => {
    renderDashboard();
    await screen.findByTestId('fleet-row-kiro');

    fireEvent.click(screen.getByTestId('pin-windsurf'));

    expect(useUIPreferencesStore.getState().dashboard.pinnedProviders).toEqual(['windsurf']);

    const section = screen.getByTestId('ops-section-fleet');
    const rows = within(section).getAllByTestId(/^fleet-row-/);
    expect(rows[0].getAttribute('data-testid')).toBe('fleet-row-windsurf');
  });
});
