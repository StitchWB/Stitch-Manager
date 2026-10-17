/**
 * Devbox workspace page — header control bar (project selector with confirmed
 * switch, new-project signal, composite stack badge, stack start, danger zone),
 * tab shell, the single 4s poll contract feeding rail/services/console, and
 * card normalization defenses.
 *
 * Mocks: safeInvoke (core invoke, routed by command name through the real
 * devbox contract module), sonner, Header (pulls proxy-status stores),
 * app store. i18n runs REAL.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
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

jest.mock('@/components/layout/Header', () => ({
  __esModule: true,
  default: ({ title, actions }: { title: string; actions?: React.ReactNode }) => (
    <div data-testid="header-stub">
      <span>{title}</span>
      <div data-testid="header-actions">{actions}</div>
    </div>
  ),
}));

jest.mock('@/stores/app', () => ({
  useAppStore: (selector?: (s: any) => any) =>
    selector ? selector({ language: 'en' }) : { language: 'en' },
}));

jest.mock('@/components/ui/ConfirmDialogHost', () => ({
  askConfirm: jest.fn(() => Promise.resolve(true)),
}));

import { safeInvoke } from '@/lib/backend/core/invoke';
import { askConfirm } from '@/components/ui/ConfirmDialogHost';
import { DevboxPage } from '@/components/devbox/DevboxPage';
import {
  registerPluginBundles,
  unregisterPluginBundles,
} from '@/lib/i18nPluginBundles';
import {
  devboxRouter,
  devboxCalls,
  devboxCallArgs,
  devboxPollBundle,
  pageRoutes,
  pendingPermissionFixture,
  runningJobFixture,
} from './devboxTestKit';

const invokeMock = safeInvoke as jest.Mock;
const askConfirmMock = askConfirm as jest.Mock;
const accepted = { accepted: true, actionId: 'act-1' };

function mockRoutes(overrides = {}) {
  invokeMock.mockImplementation(
    devboxRouter(
      pageRoutes({
        profile_use: accepted,
        stack_start: accepted,
        stack_full_down: accepted,
        stack_down: accepted,
        issue_tokens: accepted,
        ...overrides,
      }),
    ),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  mockRoutes();
});

afterEach(() => {
  jest.useRealTimers();
});

function taskGrid(): HTMLElement {
  return screen.getByTestId('devbox-panel-task');
}

describe('Devbox page poll contract', () => {
  it('polls the batched bundle on a 4000ms interval', async () => {
    jest.useFakeTimers();
    render(<DevboxPage />);

    await act(async () => {
      await Promise.resolve();
    });
    const initial = devboxCalls(invokeMock, 'poll').length;
    expect(initial).toBeGreaterThanOrEqual(1);

    await act(async () => {
      jest.advanceTimersByTime(3999);
      await Promise.resolve();
    });
    expect(devboxCalls(invokeMock, 'poll').length).toBe(initial);

    await act(async () => {
      jest.advanceTimersByTime(1);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(devboxCalls(invokeMock, 'poll').length).toBeGreaterThan(initial);
    });
  });

  it('feeds rail, service cards and console from one poll per cycle', async () => {
    jest.useFakeTimers();
    mockRoutes({
      poll: devboxPollBundle({
        jobs: [runningJobFixture(1791536987.76)],
        permissions: [pendingPermissionFixture()],
        events: [{ ts: 1791536987.76, kind: 'tool_call', tool: 'bash', status: 'ok' }],
      }),
    });
    render(<DevboxPage />);

    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(devboxCalls(invokeMock, 'poll')).toHaveLength(1);
    expect(screen.getByTestId('devbox-rail-active-job').textContent).toContain('bash');
    expect(screen.getByText('rm -rf build/')).toBeTruthy();
    expect(screen.getByTestId('devbox-events-river').textContent).toContain('tool_call');
    expect(screen.getByTestId('devbox-service-value-ingress').textContent).toBe('up');
    for (const cmd of ['overview', 'action_status', 'jobs_live', 'permissions_pending', 'events_tail']) {
      expect(devboxCalls(invokeMock, cmd)).toHaveLength(0);
    }

    await act(async () => {
      jest.advanceTimersByTime(4000);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(devboxCalls(invokeMock, 'poll')).toHaveLength(2);
    });
  });

  it('surfaces a poll error with retry', async () => {
    mockRoutes({
      poll: () => {
        throw new Error('sidecar exploded');
      },
    });
    render(<DevboxPage />);

    const matches = await screen.findAllByText('sidecar exploded');
    expect(matches.length).toBeGreaterThan(0);
    expect(screen.getAllByText('Retry').length).toBeGreaterThan(0);
  });
});

describe('Devbox page header control bar', () => {
  it('derives the composite stack badge from the poll cards', async () => {
    render(<DevboxPage />);
    expect(await screen.findByTestId('devbox-stack-badge')).toBeTruthy();
    expect(screen.getByTestId('devbox-stack-badge').textContent).toBe('Stack: degraded');
  });

  it('shows Stack: OK when ingress, bridge and runner are up', async () => {
    mockRoutes({
      poll: devboxPollBundle({
        overview: {
          cards: [
            { id: 'ingress', title: 'Ingress', value: 'up', tone: 'ok' },
            { id: 'bridge', title: 'Bridge', value: 'up', tone: 'ok' },
            { id: 'runner', title: 'Runner', value: 'up', tone: 'ok' },
          ],
        },
      }),
    });
    render(<DevboxPage />);

    await waitFor(() => {
      expect(screen.getByTestId('devbox-stack-badge').textContent).toBe('Stack: OK');
    });
    expect(screen.getByTestId('devbox-stack-start').textContent).toBe('Restart');
  });

  it('shows Stack: stopped when every stack service is down', async () => {
    mockRoutes({
      poll: devboxPollBundle({
        overview: {
          cards: [
            { id: 'ingress', title: 'Ingress', value: 'down', tone: 'down' },
            { id: 'bridge', title: 'Bridge', value: 'down', tone: 'down' },
            { id: 'runner', title: 'Runner', value: 'down', tone: 'down' },
          ],
        },
      }),
    });
    render(<DevboxPage />);

    await waitFor(() => {
      expect(screen.getByTestId('devbox-stack-badge').textContent).toBe('Stack: stopped');
    });
  });

  it('shows the neutral badge when the overview has no cards', async () => {
    mockRoutes({ poll: devboxPollBundle({ overview: { cards: [] } }) });
    render(<DevboxPage />);

    await waitFor(() => {
      expect(screen.getByTestId('devbox-stack-badge').textContent).toBe('Stack: —');
    });
  });

  it('stack start fires stack_start for the active profile', async () => {
    render(<DevboxPage />);
    const start = await screen.findByTestId('devbox-stack-start');
    await waitFor(() => {
      expect(start).not.toBeDisabled();
    });

    fireEvent.click(start);
    await waitFor(() => {
      expect(devboxCallArgs(invokeMock, 'stack_start')).toEqual([{ name: 'midsai', preview: false }]);
    });
  });

  it('has no separate switch button — the select itself is confirm-gated', async () => {
    render(<DevboxPage />);
    await screen.findByTestId('devbox-stack-badge');

    expect(screen.queryByTestId('devbox-profile-switch')).toBeNull();
  });

  it('select change asks for confirmation and fires profile_use on accept', async () => {
    render(<DevboxPage />);
    await screen.findByTestId('devbox-stack-badge');
    const select = screen.getByTestId('devbox-profile-select') as HTMLSelectElement;

    fireEvent.change(select, { target: { value: 'example-simple' } });

    await waitFor(() => {
      expect(askConfirmMock).toHaveBeenCalledTimes(1);
    });
    expect(askConfirmMock.mock.calls[0][0].title).toContain('example-simple');
    await waitFor(() => {
      expect(devboxCallArgs(invokeMock, 'profile_use')).toEqual([{ name: 'example-simple' }]);
    });
  });

  it('select change reverts without firing profile_use on cancel', async () => {
    askConfirmMock.mockResolvedValueOnce(false);
    render(<DevboxPage />);
    await screen.findByTestId('devbox-stack-badge');
    const select = screen.getByTestId('devbox-profile-select') as HTMLSelectElement;

    fireEvent.change(select, { target: { value: 'example-simple' } });

    await waitFor(() => {
      expect(askConfirmMock).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(select.value).toBe('midsai');
    });
    expect(devboxCalls(invokeMock, 'profile_use')).toHaveLength(0);
  });

  it('selecting the already active profile does not ask for confirmation', async () => {
    render(<DevboxPage />);
    await screen.findByTestId('devbox-stack-badge');

    fireEvent.change(screen.getByTestId('devbox-profile-select'), {
      target: { value: 'midsai' },
    });

    expect(askConfirmMock).not.toHaveBeenCalled();
    expect(devboxCalls(invokeMock, 'profile_use')).toHaveLength(0);
  });

  it('offers add/manage action options after the profile list', async () => {
    render(<DevboxPage />);
    await screen.findByTestId('devbox-stack-badge');
    const select = screen.getByTestId('devbox-profile-select') as HTMLSelectElement;

    const options = Array.from(select.querySelectorAll('option'));
    expect(options.map(option => option.value)).toEqual([
      'midsai',
      'example-simple',
      '__add',
      '__manage',
    ]);
    expect(options[2].textContent).toBe('+ Add project / pick a folder...');
    expect(options[3].textContent).toBe('Project settings');
  });

  it('select __add switches to infra, opens the projects modal in add mode and snaps back', async () => {
    render(<DevboxPage />);
    await screen.findByTestId('devbox-stack-badge');
    const select = screen.getByTestId('devbox-profile-select') as HTMLSelectElement;

    fireEvent.change(select, { target: { value: '__add' } });

    expect(taskGrid().classList.contains('hidden')).toBe(true);
    expect(await screen.findByTestId('devbox-profiles')).toBeTruthy();
    expect(await screen.findByTestId('devbox-profile-new-name')).toBeTruthy();
    await waitFor(() => {
      expect(select.value).toBe('midsai');
    });
    expect(askConfirmMock).not.toHaveBeenCalled();
    expect(devboxCalls(invokeMock, 'profile_use')).toHaveLength(0);
  });

  it('select __manage opens the projects modal without the add editor and snaps back', async () => {
    render(<DevboxPage />);
    await screen.findByTestId('devbox-stack-badge');
    const select = screen.getByTestId('devbox-profile-select') as HTMLSelectElement;

    fireEvent.change(select, { target: { value: '__manage' } });

    expect(await screen.findByTestId('devbox-profiles')).toBeTruthy();
    expect(screen.queryByTestId('devbox-profile-new-name')).toBeNull();
    expect(taskGrid().classList.contains('hidden')).toBe(false);
    await waitFor(() => {
      expect(select.value).toBe('midsai');
    });
    expect(askConfirmMock).not.toHaveBeenCalled();
  });

  it('busy header: disabled button with a cmd label, neutral chip and caption under the button', async () => {
    mockRoutes({
      poll: devboxPollBundle({
        action_status: {
          busy: true,
          current: { id: 'act-9', cmd: 'stack_start', startedAt: 1791536987.76 },
          recent: [],
        },
      }),
    });
    render(<DevboxPage />);

    const start = await screen.findByTestId('devbox-stack-start');
    await waitFor(() => {
      expect(start).toBeDisabled();
    });
    expect(start.textContent).toBe('Starting...');
    expect(screen.getByTestId('devbox-stack-badge').textContent).toBe('Stack: restarting...');

    const caption = screen.getByTestId('devbox-progress');
    expect(caption.textContent).toContain('stack_start');
    expect(caption.parentElement?.contains(start)).toBe(true);
  });

  it('busy header labels stop commands with the stopping label', async () => {
    mockRoutes({
      poll: devboxPollBundle({
        action_status: {
          busy: true,
          current: { id: 'act-10', cmd: 'stack_full_down', startedAt: 1791536987.76 },
          recent: [],
        },
      }),
    });
    render(<DevboxPage />);

    const start = await screen.findByTestId('devbox-stack-start');
    await waitFor(() => {
      expect(start.textContent).toBe('Stopping...');
    });
    expect(screen.getByTestId('devbox-stack-badge').textContent).toBe('Stack: restarting...');
  });

  it('new-project button switches to the infra tab and opens the projects modal in add mode', async () => {
    render(<DevboxPage />);
    await screen.findByTestId('devbox-stack-badge');

    expect(taskGrid().classList.contains('hidden')).toBe(false);
    fireEvent.click(screen.getByTestId('devbox-new-project'));

    expect(taskGrid().classList.contains('hidden')).toBe(true);
    expect(screen.getByTestId('devbox-panel-infra').classList.contains('hidden')).toBe(false);
    expect(await screen.findByTestId('devbox-profiles')).toBeTruthy();
    expect(await screen.findByTestId('devbox-profile-new-name')).toBeTruthy();
  });

  it('projects button opens the modal with the table and without the add editor', async () => {
    render(<DevboxPage />);
    await screen.findByTestId('devbox-project-strip');

    fireEvent.click(screen.getByTestId('devbox-project-strip-open'));

    expect(await screen.findByTestId('devbox-profiles')).toBeTruthy();
    expect(screen.getByTestId('devbox-profile-add')).toBeTruthy();
    expect(screen.queryByTestId('devbox-profile-new-name')).toBeNull();
  });

  it('infra panel stacks service cards, project strip and console in order', async () => {
    render(<DevboxPage />);
    const panel = await screen.findByTestId('devbox-panel-infra');
    await screen.findByTestId('devbox-project-strip');

    const order = ['devbox-services', 'devbox-project-strip', 'devbox-console-tabs'].map(
      id => screen.getByTestId(id),
    );
    for (let i = 1; i < order.length; i += 1) {
      expect(
        order[i - 1].compareDocumentPosition(order[i]) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
    expect(panel.contains(order[0])).toBe(true);
    expect(panel.contains(order[2])).toBe(true);
  });

  it('danger zone entries are confirm-gated', async () => {
    render(<DevboxPage />);
    await screen.findByTestId('devbox-stack-badge');

    expect(screen.queryByTestId('devbox-danger-menu')).toBeNull();
    fireEvent.click(screen.getByTestId('devbox-danger-toggle'));

    const stopAll = screen.getByTestId('devbox-control-stop-all');
    fireEvent.click(stopAll);
    expect(devboxCalls(invokeMock, 'stack_full_down')).toHaveLength(0);
    fireEvent.click(stopAll);
    await waitFor(() => {
      expect(devboxCalls(invokeMock, 'stack_full_down')).toHaveLength(1);
    });

    const tokens = screen.getByTestId('devbox-control-tokens');
    fireEvent.click(tokens);
    fireEvent.click(tokens);
    await waitFor(() => {
      expect(devboxCalls(invokeMock, 'issue_tokens')).toHaveLength(1);
    });
  });

  it('tabs toggle between task and infra without unmounting the prompt', async () => {
    render(<DevboxPage />);
    await screen.findByTestId('devbox-stack-badge');

    fireEvent.click(screen.getByTestId('devbox-tab-infra'));
    expect(taskGrid().classList.contains('hidden')).toBe(true);
    expect(screen.getByTestId('devbox-prompt')).toBeTruthy();

    fireEvent.click(screen.getByTestId('devbox-tab-task'));
    expect(taskGrid().classList.contains('hidden')).toBe(false);
  });
});

describe('Devbox page card normalization', () => {
  it('renders legacy overview rows defensively in the service badges', async () => {
    mockRoutes({
      poll: devboxPollBundle({ overview: [{ title: 'Bridge', value: 'up' }] }),
    });
    render(<DevboxPage />);

    const bridge = await screen.findByTestId('devbox-service-value-bridge');
    expect(bridge.textContent).toBe('up');
  });

  it('resolves plugin i18n keys in service badge titles via the plugin bundle', async () => {
    registerPluginBundles('stitch-devbox', {
      en: {
        'stitch-devbox': {
          card: { ingress: 'Ingress tunnel' },
        },
      },
    });
    try {
      mockRoutes({
        poll: devboxPollBundle({
          overview: {
            cards: [
              { id: 'ingress', title: 'stitch-devbox.card.ingress', value: 'up', tone: 'ok' },
              { id: 'bridge', title: 'stitch-devbox.card.missing', value: 'down', tone: 'down' },
            ],
          },
        }),
      });
      render(<DevboxPage />);

      expect(await screen.findByText('Ingress tunnel')).toBeTruthy();
      expect(screen.getByText('stitch-devbox.card.missing')).toBeTruthy();
    } finally {
      unregisterPluginBundles('stitch-devbox');
    }
  });
});
