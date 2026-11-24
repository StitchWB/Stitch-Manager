import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, fireEvent, act } from '@testing-library/react';

jest.mock('@/lib/backend/core/invoke', () => ({
  safeInvoke: jest.fn(),
  safeInvokeWithRetry: jest.fn(),
  batchInvoke: jest.fn(),
  BackendError: class extends Error {},
}));

import { safeInvoke } from '@/lib/backend/core/invoke';
import { t } from '@/lib/i18n';
import type { DevboxEventRow } from '@/lib/backend/modules/devbox';
import { DevboxLogs } from '@/components/devbox/DevboxLogs';
import { devboxRouter, pageRoutes } from './devboxTestKit';

const invokeMock = safeInvoke as jest.Mock;

const events: DevboxEventRow[] = [
  { ts: 1791536980, kind: 'tool_call', tool: 'bash', status: 'ok' },
  { ts: 1791536981, kind: 'tool_call', tool: 'git', status: 'failed' },
  { ts: 1791536982, kind: 'mcp_request', tool: 'bash', status: 'awaiting_permission' },
];

function renderLogs() {
  render(<DevboxLogs events={events} recent={null} error={null} onRetry={jest.fn()} />);
}

beforeEach(() => {
  jest.clearAllMocks();
  invokeMock.mockImplementation(
    devboxRouter(
      pageRoutes({
        logs: {
          sources: [
            {
              name: 'runner',
              lines: ['runner started', 'ERROR connection refused', 'warn: slow disk'],
            },
          ],
        },
      }),
    ),
  );
});

describe('DevboxLogs', () => {
  it('keeps the console toolbar filters and search', () => {
    renderLogs();

    expect(screen.getByTestId('devbox-logs-stat-total').textContent).toContain('3');
    expect(screen.getByTestId('devbox-logs-stat-errors').textContent).toContain('1');
    expect(screen.getByTestId('devbox-logs-stat-warnings').textContent).toContain('1');
    expect(screen.getByTestId('devbox-console-tabs')).toBeTruthy();
    expect(screen.getByText(t('devboxPage.consoleFilterAll'))).toBeTruthy();
    expect(screen.getByText(t('devboxPage.consoleFilterErrors'))).toBeTruthy();
    expect(screen.getByTestId('devbox-console-search')).toBeTruthy();
    expect(screen.getByTestId('devbox-console-clear')).toBeTruthy();
  });

  it('keeps the live log source chips inside a bounded console region', async () => {
    renderLogs();

    await act(async () => {
      fireEvent.click(screen.getByTestId('devbox-console-tab-logs'));
    });

    expect(await screen.findByTestId('devbox-logs-source-runner')).toBeTruthy();
    fireEvent.click(screen.getByText(t('devboxPage.consoleFilterErrors')));

    const source = screen.getByTestId('devbox-logs-source-runner');
    expect(source.textContent).toContain('ERROR connection refused');
    expect(source.textContent).not.toContain('runner started');
    expect(source.className).toContain('max-h-64');
  });
});