/**
 * Monitoring page — service-plugin host health section tests (todo 25).
 *
 * Verifies:
 *   (a) Running host row renders id, version, uptime, restarts and a
 *       success status badge from get_service_plugin_health data.
 *   (b) Errored host (status="error" / restarts>0) renders the danger
 *       badge and surfaces last_error.
 *   (c) Health command failure (403/older backend) hides the section
 *       without breaking the rest of the page.
 *
 * Mocks: invoke (safeInvoke), modules/monitoring (getMonitoring), i18n
 * (t = identity), Header, sonner, app store.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import Monitoring from '../../pages/Monitoring';
import type { MonitoringSnapshot } from '@/lib/backend/modules/monitoring';
import { safeInvoke } from '@/lib/backend/core/invoke';

// ── Module mocks ────────────────────────────────────────────────────────────

jest.mock('../../lib/backend/core/invoke', () => ({
  setAuthExpiredHandler: jest.fn(),
  safeInvoke: jest.fn(),
  BackendError: class extends Error {},
}));

jest.mock('../../lib/backend/modules/monitoring', () => ({
  getMonitoring: jest.fn(),
  ackMonitoringAlerts: jest.fn(),
}));

jest.mock('@/lib/i18n', () => ({
  t: (key: string) => key,
}));

jest.mock('../../components/layout/Header', () => ({
  __esModule: true,
  default: ({ title }: { title: string }) => <div data-testid="header">{title}</div>,
}));

jest.mock('../../stores/app', () => ({
  useAppStore: (selector?: (s: { language: string }) => unknown) =>
    selector ? selector({ language: 'en' }) : { language: 'en' },
}));

jest.mock('sonner', () => ({
  toast: {
    error: jest.fn(),
    success: jest.fn(),
  },
}));

// ── Fixtures ─────────────────────────────────────────────────────────────────

const snapshot: MonitoringSnapshot = {
  generated_at: '2026-08-22T10:00:00Z',
  server: { status: 'up', uptime_s: 100, db_ok: true },
  web: { status: 'up', latency_ms: 12, last_check: '2026-08-22T10:00:00Z', detail: null },
  external: {
    status: 'up',
    latency_ms: 34,
    last_check: '2026-08-22T10:00:00Z',
    url: 'https://api.telegram.org/',
    detail: null,
  },
  bot: {
    status: 'up',
    last_heartbeat: '2026-08-22T09:59:50Z',
    age_s: 10,
    route: 'long_polling',
    candidates: [],
    polling_errors: 0,
    uptime_s: 500,
  },
  proxies: [],
  alerts: [],
  silenced_until: null,
};

const runningHost = {
  plugin_id: 'echo',
  status: 'running',
  pid: 42,
  uptimeSeconds: 30,
  restarts: 0,
  stopping: false,
  source: 'local',
  version: '1.2.3',
  last_error: null,
  stderr_tail: [],
};

const errorHost = {
  plugin_id: 'broken',
  status: 'error',
  pid: null,
  uptimeSeconds: null,
  restarts: 2,
  stopping: false,
  source: 'local',
  version: '0.1.0',
  last_error: 'process exited with code 1',
  stderr_tail: ['Traceback (most recent call last):'],
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Monitoring page — service plugins section', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    const { getMonitoring } = require('../../lib/backend/modules/monitoring') as {
      getMonitoring: jest.Mock;
    };
    getMonitoring.mockResolvedValue(snapshot);
  });

  it('(a) renders running host row with id, version, uptime, restarts, success badge', async () => {
    (safeInvoke as jest.Mock).mockImplementation((cmd: string) => {
      if (cmd === 'get_service_plugin_health') return Promise.resolve([runningHost]);
      return Promise.resolve([]);
    });

    render(<Monitoring />);

    // Section title + host id.
    expect(await screen.findByText('monitoring.servicePlugins.title')).toBeTruthy();
    const row = screen.getByText('echo').closest('tr') as HTMLTableRowElement;
    expect(row).toBeTruthy();

    // Version in its cell.
    expect(row.textContent).toContain('1.2.3');

    // Running badge label (t = identity).
    expect(row.textContent).toContain('monitoring.servicePlugins.statusRunning');

    // Cells: plugin | status | uptime | restarts | version.
    const cells = row.querySelectorAll('td');
    expect(cells[2].textContent).toBe('30s');
    expect(cells[3].textContent).toBe('0');

    // Fetched via the admin health command.
    expect(safeInvoke).toHaveBeenCalledWith('get_service_plugin_health');
  });

  it('(b) errored host shows danger badge and last_error', async () => {
    (safeInvoke as jest.Mock).mockImplementation((cmd: string) => {
      if (cmd === 'get_service_plugin_health') return Promise.resolve([errorHost]);
      return Promise.resolve([]);
    });

    render(<Monitoring />);

    expect(await screen.findByText('broken')).toBeTruthy();
    const row = screen.getByText('broken').closest('tr') as HTMLTableRowElement;
    // Error badge label.
    expect(row.textContent).toContain('monitoring.servicePlugins.statusError');
    // last_error surfaced under the plugin id.
    expect(row.textContent).toContain('process exited with code 1');
    // Restarts value (2 > 0 also drives the danger variant).
    const cells = row.querySelectorAll('td');
    expect(cells[3].textContent).toBe('2');
  });

  it('(c) health command failure hides the section, page still renders', async () => {
    (safeInvoke as jest.Mock).mockImplementation((cmd: string) => {
      if (cmd === 'get_service_plugin_health') {
        return Promise.reject(new Error('403 Forbidden'));
      }
      return Promise.resolve([]);
    });

    render(<Monitoring />);

    // The rest of the page renders from the snapshot.
    expect(await screen.findByText('monitoring.sections.server')).toBeTruthy();
    // Section is hidden (null hosts).
    expect(screen.queryByText('monitoring.servicePlugins.title')).toBeNull();
  });

  it('shows empty state when no service plugins installed', async () => {
    (safeInvoke as jest.Mock).mockImplementation((cmd: string) => {
      if (cmd === 'get_service_plugin_health') return Promise.resolve([]);
      return Promise.resolve([]);
    });

    render(<Monitoring />);

    expect(await screen.findByText('monitoring.servicePlugins.title')).toBeTruthy();
    expect(screen.getByText('monitoring.servicePlugins.empty')).toBeTruthy();
  });
});
