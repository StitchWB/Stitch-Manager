/**
 * Devbox unified console — inner tab switching (events/logs/actions),
 * client-side search filtering, autoscroll toggle state, logs fetch-on-open
 * with source filter and limit preserved, clear-buffer semantics, and the
 * actions table with payload expansion plus doctor/cockpit payload surfaces.
 *
 * Mocks: safeInvoke (routed by command name), sonner. i18n runs REAL.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';

jest.mock('@/lib/backend/core/invoke', () => ({
  safeInvoke: jest.fn(),
  safeInvokeWithRetry: jest.fn(),
  batchInvoke: jest.fn(),
  BackendError: class extends Error {},
}));

jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn(), info: jest.fn(), warning: jest.fn() },
}));

import { safeInvoke } from '@/lib/backend/core/invoke';
import type { DevboxEventRow, DevboxRecentAction } from '@/lib/backend/modules/devbox';
import { DevboxConsole, type DevboxConsoleProps } from '@/components/devbox/DevboxConsole';
import { devboxRouter, devboxCallArgs, pageRoutes } from './devboxTestKit';

const invokeMock = safeInvoke as jest.Mock;

const eventsFixture: DevboxEventRow[] = [
  { ts: 1791536987.76, kind: 'tool_call', tool: 'bash', status: 'ok' },
  { ts: 1791536990.1, kind: 'permission_request', tool: 'shell', status: 'pending' },
];

const recentFixture: DevboxRecentAction[] = [
  {
    id: 'a2',
    cmd: 'run_doctor',
    status: 'finished',
    startedAt: 1791536987.76,
    finishedAt: 1791536990.1,
    exit: 0,
    payload: { report: 'PASS tunnel\nFAIL watchdog' },
  },
  {
    id: 'a3',
    cmd: 'cockpit_open',
    status: 'finished',
    startedAt: 1791536987.76,
    finishedAt: 1791536988.0,
    exit: 0,
    payload: { url: 'http://127.0.0.1:8790/?token=one' },
  },
];

const logsFixture = {
  sources: [
    { name: 'bridge', lines: ['bridge up', 'tool call read'] },
    { name: 'ingress', lines: ['route /p/8787'] },
  ],
};

function renderConsole(props: Partial<DevboxConsoleProps> = {}) {
  const onRetry = jest.fn(() => undefined);
  render(
    <DevboxConsole
      events={eventsFixture}
      recent={recentFixture}
      error={null}
      onRetry={onRetry}
      {...props}
    />,
  );
  return onRetry;
}

beforeEach(() => {
  jest.clearAllMocks();
  invokeMock.mockImplementation(devboxRouter(pageRoutes({ logs: logsFixture })));
});

describe('DevboxConsole tabs', () => {
  it('renders events by default and does not fetch logs until the tab opens', async () => {
    renderConsole();

    const river = screen.getByTestId('devbox-events-river');
    expect(river.children).toHaveLength(2);
    expect(devboxCallArgs(invokeMock, 'logs')).toHaveLength(0);

    await act(async () => {
      fireEvent.click(screen.getByTestId('devbox-console-tab-logs'));
    });

    await waitFor(() => {
      expect(devboxCallArgs(invokeMock, 'logs')).toEqual([
        { source: undefined, filter: undefined, limit: 200 },
      ]);
    });
    expect(await screen.findByTestId('devbox-logs-source-bridge')).toBeTruthy();
    expect(screen.getByTestId('devbox-logs-source-bridge').textContent).toContain('bridge up');
  });

  it('switching to actions renders the table with exit codes and payload expansion', async () => {
    renderConsole();

    fireEvent.click(screen.getByTestId('devbox-console-tab-actions'));

    expect(screen.getByText('run_doctor')).toBeTruthy();
    const report = screen.getByTestId('devbox-doctor-report');
    expect(report.textContent).toBe('PASS tunnel\nFAIL watchdog');
    const cockpit = screen.getByTestId('devbox-cockpit-url');
    expect(cockpit.textContent).toContain('http://127.0.0.1:8790/?token=one');

    fireEvent.click(screen.getByTestId('devbox-action-payload-a2'));
    expect(screen.getByText(/"report"/)).toBeTruthy();
  });

  it('selecting a log source refetches with the source param', async () => {
    renderConsole();
    await act(async () => {
      fireEvent.click(screen.getByTestId('devbox-console-tab-logs'));
    });
    await screen.findByTestId('devbox-logs-source-bridge');

    await act(async () => {
      fireEvent.click(screen.getAllByText('ingress')[0]);
    });

    await waitFor(() => {
      const args = devboxCallArgs(invokeMock, 'logs');
      expect(args[args.length - 1]).toEqual({ source: 'ingress', filter: undefined, limit: 200 });
    });
  });

  it('renders the gateway source chip from the RPC payload and its lines when selected', async () => {
    invokeMock.mockImplementation(
      devboxRouter(
        pageRoutes({
          logs: {
            sources: [
              { name: 'host', lines: ['host boot'] },
              { name: 'gateway', lines: ['gateway listening on 8765', 'route ok'] },
            ],
          },
        }),
      ),
    );
    renderConsole();
    await act(async () => {
      fireEvent.click(screen.getByTestId('devbox-console-tab-logs'));
    });
    await screen.findByTestId('devbox-logs-source-gateway');
    expect(screen.getAllByText('gateway')[0]).toBeTruthy();
    expect(screen.getByTestId('devbox-logs-source-gateway').textContent).toContain(
      'gateway listening on 8765',
    );

    await act(async () => {
      fireEvent.click(screen.getAllByText('gateway')[0]);
    });

    await waitFor(() => {
      const args = devboxCallArgs(invokeMock, 'logs');
      expect(args[args.length - 1]).toEqual({ source: 'gateway', filter: undefined, limit: 200 });
    });
    expect(screen.queryByTestId('devbox-logs-source-host')).toBeNull();
    expect(screen.getByTestId('devbox-logs-source-gateway').textContent).toContain('route ok');
  });

  it('refresh refetches logs on the logs tab and reloads the poll elsewhere', async () => {
    const onRetry = renderConsole();

    fireEvent.click(screen.getByTestId('devbox-console-refresh'));
    expect(onRetry).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(screen.getByTestId('devbox-console-tab-logs'));
    });
    await screen.findByTestId('devbox-logs-source-bridge');
    const before = devboxCallArgs(invokeMock, 'logs').length;

    await act(async () => {
      fireEvent.click(screen.getByTestId('devbox-console-refresh'));
    });
    await waitFor(() => {
      expect(devboxCallArgs(invokeMock, 'logs').length).toBe(before + 1);
    });
  });
});

describe('DevboxConsole toolbar', () => {
  it('search filters event rows client-side', () => {
    renderConsole();

    fireEvent.change(screen.getByTestId('devbox-console-search'), {
      target: { value: 'permission_request' },
    });

    const river = screen.getByTestId('devbox-events-river');
    expect(river.children).toHaveLength(1);
    expect(river.children[0].textContent).toContain('shell');
  });

  it('search filters log lines client-side', async () => {
    renderConsole();
    await act(async () => {
      fireEvent.click(screen.getByTestId('devbox-console-tab-logs'));
    });
    await screen.findByTestId('devbox-logs-source-bridge');

    fireEvent.change(screen.getByTestId('devbox-console-search'), {
      target: { value: 'route' },
    });

    expect(screen.getByTestId('devbox-logs-source-ingress').textContent).toContain('route /p/8787');
    expect(screen.getByTestId('devbox-logs-source-bridge').textContent).toBe('');
  });

  it('autoscroll toggle starts on and flips', () => {
    renderConsole();

    const toggle = screen.getByRole('checkbox') as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    fireEvent.click(toggle);
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
  });

  it('clear empties the local events buffer', () => {
    renderConsole();

    fireEvent.click(screen.getByTestId('devbox-console-clear'));

    expect(screen.queryByTestId('devbox-events-river')).toBeNull();
    expect(screen.getByTestId('devbox-console-empty').textContent).toBe('Nothing found');
  });

  it('copy button writes the visible events to the clipboard', async () => {
    const writeText = jest.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    renderConsole();

    await act(async () => {
      fireEvent.click(screen.getByTestId('devbox-console-copy'));
    });

    expect(writeText).toHaveBeenCalledTimes(1);
    const copiedText = writeText.mock.calls[0][0] as string;
    expect(copiedText.split('\n')).toHaveLength(2);
    expect(copiedText).toContain('bash');
    expect((await screen.findByTestId('devbox-console-copy')).textContent).toContain('Copied');
  });

  it('copy button is disabled when the visible buffer is empty', () => {
    renderConsole({ events: [] });

    expect((screen.getByTestId('devbox-console-copy') as HTMLButtonElement).disabled).toBe(true);
  });

  it('renders the poll error with retry outside the logs tab', () => {
    const onRetry = renderConsole({ error: 'poll exploded' });

    const error = screen.getByTestId('devbox-console-error');
    expect(error.textContent).toContain('poll exploded');
    fireEvent.click(error.querySelector('button')!);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('DevboxConsole error filter', () => {
  const mixedEvents: DevboxEventRow[] = [
    { ts: 1791536980, kind: 'tool_call', tool: 'bash', status: 'ok' },
    { ts: 1791536981, kind: 'tool_call', tool: 'git', status: 'failed' },
    { ts: 1791536982, kind: 'tool_call', tool: 'npm', status: 'error' },
  ];

  const mixedActions: DevboxRecentAction[] = [
    {
      id: 'b1',
      cmd: 'stack_start',
      status: 'finished',
      startedAt: 1791536980,
      finishedAt: 1791536981,
      exit: 0,
      payload: null,
    },
    {
      id: 'b2',
      cmd: 'profile_put',
      status: 'failed',
      startedAt: 1791536980,
      finishedAt: 1791536981,
      exit: 1,
      payload: null,
    },
    {
      id: 'b3',
      cmd: 'ingress_control',
      status: 'running',
      startedAt: 1791536980,
      finishedAt: null,
      exit: null,
      payload: null,
    },
  ];

  it('events tab keeps only failed/error rows and restores on All', () => {
    renderConsole({ events: mixedEvents });

    fireEvent.click(screen.getByText('Errors only'));
    const river = screen.getByTestId('devbox-events-river');
    expect(river.children).toHaveLength(2);
    expect(river.textContent).toContain('git');
    expect(river.textContent).toContain('npm');
    expect(river.textContent).not.toContain('bash');

    fireEvent.click(screen.getByText('All'));
    expect(screen.getByTestId('devbox-events-river').children).toHaveLength(3);
  });

  it('events tab shows the filtered-empty hint when nothing failed', () => {
    renderConsole();

    fireEvent.click(screen.getByText('Errors only'));
    expect(screen.queryByTestId('devbox-events-river')).toBeNull();
    expect(screen.getByTestId('devbox-console-empty').textContent).toBe('Nothing found');
  });

  it('actions tab keeps only rows with a non-zero exit code', () => {
    renderConsole({ recent: mixedActions });

    fireEvent.click(screen.getByTestId('devbox-console-tab-actions'));
    expect(screen.getByText('stack_start')).toBeTruthy();

    fireEvent.click(screen.getByText('Errors only'));
    expect(screen.getByText('profile_put')).toBeTruthy();
    expect(screen.queryByText('stack_start')).toBeNull();
    expect(screen.queryByText('ingress_control')).toBeNull();
  });

  it('logs tab filters lines client-side by the error regex', async () => {
    invokeMock.mockImplementation(
      devboxRouter(
        pageRoutes({
          logs: {
            sources: [
              {
                name: 'runner',
                lines: [
                  'runner started',
                  'ERROR connection refused',
                  'Traceback (most recent call last):',
                  'warn: slow disk',
                  'all good here',
                ],
              },
            ],
          },
        }),
      ),
    );
    renderConsole();
    await act(async () => {
      fireEvent.click(screen.getByTestId('devbox-console-tab-logs'));
    });
    await screen.findByTestId('devbox-logs-source-runner');

    fireEvent.click(screen.getByText('Errors only'));
    const pre = screen.getByTestId('devbox-logs-source-runner');
    expect(pre.textContent).toContain('ERROR connection refused');
    expect(pre.textContent).toContain('Traceback (most recent call last):');
    expect(pre.textContent).toContain('warn: slow disk');
    expect(pre.textContent).not.toContain('runner started');
    expect(pre.textContent).not.toContain('all good here');
  });
});
