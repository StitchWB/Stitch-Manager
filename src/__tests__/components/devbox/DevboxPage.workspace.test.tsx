import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { toast } from 'sonner';

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
  overviewFixture,
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
        env_get: { entries: [] },
        env_set: { valid: true, errors: [], restart: [] },
        connection_check: { ok: false, error: 'unavailable' },
        handoff_block: { block: '', masked: true },
        profile_get: { json: '{"mode":"standard"}', valid: true, errors: [] },
        profile_put: { valid: true, errors: [] },
        watchdog_control: accepted,
        cockpit_open: accepted,
        ingress_control: accepted,
        run_doctor: accepted,
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

function panel(id: string): HTMLElement {
  return screen.getByTestId(`devbox-panel-${id}`);
}

function clickTab(id: string): void {
  fireEvent.click(screen.getByTestId(`devbox-tab-${id}`));
}

async function openTab(id: string): Promise<void> {
  fireEvent.click(await screen.findByTestId(`devbox-tab-${id}`));
}

function isHidden(element: HTMLElement): boolean {
  return element.classList.contains('hidden');
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

  it('feeds agent, service cards and console from one poll per cycle', async () => {
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

    clickTab('agent');
    expect(screen.getByTestId('devbox-agent-job-j1').textContent).toContain('bash');
    expect(screen.getByText('rm -rf build/')).toBeTruthy();

    clickTab('services');
    expect(screen.getByTestId('devbox-service-value-ingress').textContent).toBe('running');

    clickTab('logs');
    expect(screen.getByTestId('devbox-events-river').textContent).toContain('bash');

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
    await openTab('logs');

    const matches = await screen.findAllByText('sidecar exploded');
    expect(matches.length).toBeGreaterThan(0);
    expect(screen.getAllByText('Retry').length).toBeGreaterThan(0);
  });
});

describe('Devbox page permission cards', () => {
  it('dismisses the card with an info toast when the reply comes back stale', async () => {
    mockRoutes({
      poll: devboxPollBundle({ permissions: [pendingPermissionFixture()] }),
      permission_reply: { accepted: false, reason: "no pending permission matches 'p1'" },
    });
    render(<DevboxPage />);
    await openTab('agent');

    expect(await screen.findByTestId('devbox-agent-permission-p1')).toBeTruthy();
    fireEvent.click(screen.getByTestId('devbox-permission-approve-p1'));

    await waitFor(() => {
      expect(toast.info).toHaveBeenCalledWith(
        'Permission request is no longer pending: the agent withdrew it or the job ended',
      );
    });
    expect(toast.error).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByTestId('devbox-agent-permission-p1')).toBeNull();
    });
  });
});

describe('Devbox page header control bar', () => {
  it('renders the six tabs in the required order', async () => {
    render(<DevboxPage />);
    const tabs = await screen.findByTestId('devbox-tabs');

    expect(Array.from(tabs.querySelectorAll('button')).map(button => button.textContent)).toEqual([
      'Overview',
      'Connect',
      'Agent',
      'Services',
      'Projects',
      'Logs',
    ]);
  });

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

  it('keeps the composite at Stack: OK when only the gateway is down', async () => {
    mockRoutes({
      poll: devboxPollBundle({
        overview: {
          cards: [
            { id: 'ingress', title: 'Ingress', value: 'up', tone: 'ok' },
            { id: 'bridge', title: 'Bridge', value: 'up', tone: 'ok' },
            { id: 'runner', title: 'Runner', value: 'up', tone: 'ok' },
          ],
          gateway: { enabled: true, up: false, port: null, exposed_mcps: [] },
        },
      }),
    });
    render(<DevboxPage />);

    await waitFor(() => {
      expect(screen.getByTestId('devbox-stack-badge').textContent).toBe('Stack: OK');
    });
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

  it('offers compact profile labels and add/manage action options', async () => {
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
    expect(options[0].textContent).toBe('midsai · standard');
    expect(options[1].textContent).toBe('example-simple · readonly');
    expect(options[2].textContent).toBe('+ New project');
    expect(options[3].textContent).toBe('Project settings');
    expect(select.closest('[class*="sm:w-56"]')).toBeTruthy();
  });

  it('renders the title without the Devbox prefix', async () => {
    render(<DevboxPage />);
    expect(await screen.findByText('A coding agent on your machine')).toBeTruthy();
  });

  it('moves Doctor and ingress into the More menu and keeps Cockpit out of the header', async () => {
    render(<DevboxPage />);
    await screen.findByTestId('devbox-stack-badge');

    expect(screen.queryByTestId('devbox-control-doctor')).toBeNull();
    expect(screen.queryByTestId('devbox-control-cockpit')).toBeNull();

    fireEvent.click(screen.getByTestId('devbox-more-toggle'));

    const doctor = screen.getByTestId('devbox-control-doctor');
    expect(doctor.textContent).toBe('Diagnostics');
    expect(doctor.querySelector('svg')).toBeTruthy();
    expect(doctor.querySelector('span.hidden')).toBeNull();
    expect(screen.getByTestId('devbox-control-ingress')).toBeTruthy();
    expect(screen.queryByTestId('devbox-control-cockpit')).toBeNull();
    expect(screen.queryByTestId('devbox-control-tokens')).toBeNull();
  });

  it('select __add switches to Projects and opens the inline editor in add mode', async () => {
    render(<DevboxPage />);
    await screen.findByTestId('devbox-stack-badge');
    const select = screen.getByTestId('devbox-profile-select') as HTMLSelectElement;

    fireEvent.change(select, { target: { value: '__add' } });

    expect(isHidden(panel('overview'))).toBe(true);
    expect(await screen.findByTestId('devbox-panel-projects')).toBeTruthy();
    expect(await screen.findByTestId('devbox-profiles')).toBeTruthy();
    expect(await screen.findByTestId('devbox-profile-new-name')).toBeTruthy();
    await waitFor(() => {
      expect(select.value).toBe('midsai');
    });
    expect(askConfirmMock).not.toHaveBeenCalled();
    expect(devboxCalls(invokeMock, 'profile_use')).toHaveLength(0);
  });

  it('select __manage opens the inline Projects tab without the add editor', async () => {
    render(<DevboxPage />);
    await screen.findByTestId('devbox-stack-badge');
    const select = screen.getByTestId('devbox-profile-select') as HTMLSelectElement;

    fireEvent.change(select, { target: { value: '__manage' } });

    expect(isHidden(panel('overview'))).toBe(true);
    expect(await screen.findByTestId('devbox-profiles')).toBeTruthy();
    expect(screen.queryByTestId('devbox-profile-new-name')).toBeNull();
    await waitFor(() => {
      expect(select.value).toBe('midsai');
    });
    expect(askConfirmMock).not.toHaveBeenCalled();
  });

  it('busy header: disabled button, no caption, progress in title and tooltip', async () => {
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

    expect(screen.queryByTestId('devbox-progress')).toBeNull();
    expect(screen.getByTestId('header-actions').textContent).not.toContain('Running:');
    expect(start.getAttribute('title')).toContain('Running: stack_start');

    fireEvent.mouseEnter(start.parentElement as HTMLElement);
    await waitFor(() => {
      expect(document.body.textContent).toContain('Running: stack_start');
    });
  });

  it('busy header shows the diagnostics chip for run_doctor', async () => {
    mockRoutes({
      poll: devboxPollBundle({
        action_status: {
          busy: true,
          current: { id: 'act-11', cmd: 'run_doctor', startedAt: 1791536987.76 },
          recent: [],
        },
      }),
    });
    render(<DevboxPage />);

    const start = await screen.findByTestId('devbox-stack-start');
    await waitFor(() => {
      expect(start).toBeDisabled();
    });
    expect(screen.getByTestId('devbox-stack-badge').textContent).toBe('Stack: diagnostics...');
    expect(start.getAttribute('title')).toContain('Running: run_doctor');
  });

  it('toasts once when a newer finished run_doctor arrives', async () => {
    mockRoutes({
      poll: devboxPollBundle({
        action_status: {
          busy: false,
          current: null,
          recent: [
            { id: 'd1', cmd: 'run_doctor', status: 'finished', startedAt: 1, finishedAt: 2, exit: 1 },
          ],
        },
      }),
    });
    render(<DevboxPage />);
    await screen.findByTestId('devbox-stack-badge');
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.warning).not.toHaveBeenCalled();

    mockRoutes({
      poll: devboxPollBundle({
        action_status: {
          busy: false,
          current: null,
          recent: [
            { id: 'd1', cmd: 'run_doctor', status: 'finished', startedAt: 1, finishedAt: 2, exit: 1 },
            { id: 'd2', cmd: 'run_doctor', status: 'finished', startedAt: 3, finishedAt: 4, exit: 0 },
          ],
        },
      }),
    });
    fireEvent.click(screen.getByTestId('devbox-refresh'));
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByTestId('devbox-refresh'));
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledTimes(1);
    });
  });

  it('toasts with an open action when a newer cockpit_open finishes', async () => {
    mockRoutes({
      poll: devboxPollBundle({
        action_status: {
          busy: false,
          current: null,
          recent: [
            {
              id: 'c1',
              cmd: 'cockpit_open',
              status: 'finished',
              startedAt: 1,
              finishedAt: 2,
              exit: 0,
              payload: { url: 'http://127.0.0.1:8793/?t=x' },
            },
          ],
        },
      }),
    });
    render(<DevboxPage />);
    await screen.findByTestId('devbox-stack-badge');
    expect(toast.success).not.toHaveBeenCalled();

    mockRoutes({
      poll: devboxPollBundle({
        action_status: {
          busy: false,
          current: null,
          recent: [
            {
              id: 'c1',
              cmd: 'cockpit_open',
              status: 'finished',
              startedAt: 1,
              finishedAt: 2,
              exit: 0,
              payload: { url: 'http://127.0.0.1:8793/?t=x' },
            },
            {
              id: 'c2',
              cmd: 'cockpit_open',
              status: 'finished',
              startedAt: 3,
              finishedAt: 4,
              exit: 0,
              payload: { url: 'http://127.0.0.1:8793/?t=y' },
            },
          ],
        },
      }),
    });
    fireEvent.click(screen.getByTestId('devbox-refresh'));
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(
        expect.stringContaining('Cockpit'),
        expect.objectContaining({ action: expect.objectContaining({ label: expect.any(String) }) }),
      );
    });
  });

  it('busy header labels stop commands with the stopping chip', async () => {
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
    expect(screen.getByTestId('devbox-stack-badge').textContent).toBe('Stack: stopping...');
  });

  it('new-project button switches to the Projects tab and opens the inline add editor', async () => {
    render(<DevboxPage />);
    await screen.findByTestId('devbox-stack-badge');

    expect(isHidden(panel('overview'))).toBe(false);
    fireEvent.click(screen.getByTestId('devbox-new-project'));

    expect(isHidden(panel('overview'))).toBe(true);
    expect(isHidden(panel('projects'))).toBe(false);
    expect(await screen.findByTestId('devbox-profiles')).toBeTruthy();
    expect(await screen.findByTestId('devbox-profile-new-name')).toBeTruthy();
  });

  it('projects tab renders the profile table without the add editor', async () => {
    render(<DevboxPage />);
    await openTab('projects');

    expect(await screen.findByTestId('devbox-profiles')).toBeTruthy();
    expect(screen.getByTestId('devbox-projects-create')).toBeTruthy();
    expect(screen.queryByTestId('devbox-profile-new-name')).toBeNull();
  });

  it('services panel renders focus rows, capabilities and infrastructure in order', async () => {
    render(<DevboxPage />);
    await openTab('services');

    const servicesPanel = await screen.findByTestId('devbox-panel-services');
    const focus = screen.getByTestId('devbox-services-focus');
    const gateway = screen.getByTestId('devbox-services-gateway');
    const manifest = screen.getByTestId('devbox-services-manifest');
    const infraCards = screen.getByTestId('devbox-services');
    const ports = screen.getByTestId('devbox-services-ports');

    expect(focus.compareDocumentPosition(gateway) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(gateway.compareDocumentPosition(manifest) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(manifest.compareDocumentPosition(infraCards) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(infraCards.compareDocumentPosition(ports) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const node of [focus, gateway, infraCards, ports]) {
      expect(servicesPanel.contains(node)).toBe(true);
    }
  });

  it('logs panel renders the console', async () => {
    render(<DevboxPage />);
    await openTab('logs');

    const logsPanel = await screen.findByTestId('devbox-panel-logs');
    expect(logsPanel.contains(screen.getByTestId('devbox-console-tabs'))).toBe(true);
  });

  it('feeds the gateway to the prompt — the warning plate appears when the gateway is down', async () => {
    mockRoutes({
      poll: devboxPollBundle({
        overview: {
          cards: [
            { id: 'profile', title: 'Profile', value: 'midsai', tone: 'ok' },
            { id: 'ingress', title: 'Ingress', value: 'up', tone: 'ok' },
            { id: 'bridge', title: 'Bridge', value: 'up', tone: 'ok' },
            { id: 'runner', title: 'Runner', value: 'up', tone: 'ok' },
          ],
          gateway: {
            enabled: true,
            up: false,
            port: 8765,
            exposed_mcps: [{ name: 'context7', mode: 'readonly', tools: ['resolve-library-id'] }],
          },
        },
      }),
    });
    render(<DevboxPage />);
    await openTab('agent');

    expect(await screen.findByTestId('devbox-prompt-gateway-warning')).toBeTruthy();
    expect(screen.queryByTestId('devbox-prompt-stack-warning')).toBeNull();
  });

  it('gateway inline editor and the JSON escape hatch open the seeded editor', async () => {
    mockRoutes({
      poll: devboxPollBundle({
        overview: {
          ...overviewFixture,
          gateway: { enabled: true, up: true, port: null, exposed_mcps: [] },
        },
      }),
      mcp_candidates: {
        profile: 'midsai',
        error: null,
        candidates: [
          {
            name: 'context7',
            type: 'local',
            enabled: true,
            source: 'opencode.json',
            valid: true,
            error: null,
            command: ['python', '-m', 'context7'],
          },
        ],
      },
      profile_get: {
        json: '{"project_dir": "d:/work/midsai", "mode": "standard"}',
        valid: true,
        errors: [],
      },
    });
    render(<DevboxPage />);
    await openTab('services');

    expect(await screen.findByTestId('devbox-services-gateway-context7')).toBeTruthy();
    expect(devboxCallArgs(invokeMock, 'mcp_candidates')).toEqual([{ name: 'midsai' }]);

    fireEvent.click(screen.getByTestId('devbox-services-gateway-advanced'));

    expect(await screen.findByTestId('devbox-profiles')).toBeTruthy();
    const editor = (await screen.findByTestId('devbox-profile-editor')) as HTMLTextAreaElement;
    await waitFor(() => {
      expect(JSON.parse(editor.value)).toEqual({
        project_dir: 'd:/work/midsai',
        mode: 'standard',
        exposed_mcps: [{ name: 'context7', mode: 'readonly', tool_allow: [] }],
      });
    });
    expect(devboxCallArgs(invokeMock, 'profile_get').length).toBeGreaterThanOrEqual(2);
  });

  it('danger zone entries are confirm-gated and tokens stay out of the header', async () => {
    render(<DevboxPage />);
    await screen.findByTestId('devbox-stack-badge');

    fireEvent.click(screen.getByTestId('devbox-more-toggle'));

    expect(screen.queryByTestId('devbox-control-tokens')).toBeNull();
    expect(screen.queryByTestId('devbox-control-cockpit')).toBeNull();
    expect(screen.getByTestId('devbox-control-ingress')).toBeTruthy();

    const stopAll = screen.getByTestId('devbox-control-stop-all');
    fireEvent.click(stopAll);
    await waitFor(() => {
      expect(devboxCalls(invokeMock, 'stack_full_down')).toHaveLength(1);
    });
    expect(askConfirmMock).toHaveBeenCalled();
  });

  it('shows the onboarding strip when no project is active', async () => {
    mockRoutes({ profiles_list: [] });
    render(<DevboxPage />);

    const banner = await screen.findByTestId('devbox-onboard-project');
    expect(banner.textContent).toContain('Create a project first');
    expect(banner.textContent).toContain('A project is a folder on this machine');

    fireEvent.click(screen.getByTestId('devbox-onboard-new-project'));
    expect(await screen.findByTestId('devbox-profiles')).toBeTruthy();
    expect(await screen.findByTestId('devbox-profile-new-name')).toBeTruthy();
  });

  it('hides the onboarding strip when a project is active', async () => {
    render(<DevboxPage />);
    await screen.findByTestId('devbox-stack-badge');

    expect(screen.queryByTestId('devbox-onboard-project')).toBeNull();
  });

  it('tabs lazy-mount panels and keep them mounted when hidden', async () => {
    render(<DevboxPage />);
    await screen.findByTestId('devbox-stack-badge');

    expect(isHidden(panel('overview'))).toBe(false);
    expect(screen.queryByTestId('devbox-panel-agent')).toBeNull();

    clickTab('agent');
    expect(isHidden(panel('overview'))).toBe(true);
    expect(isHidden(panel('agent'))).toBe(false);
    expect(screen.getByTestId('devbox-prompt')).toBeTruthy();

    clickTab('overview');
    expect(isHidden(panel('overview'))).toBe(false);
    expect(isHidden(panel('agent'))).toBe(true);
    expect(screen.getByTestId('devbox-prompt')).toBeTruthy();
  });
});

describe('Devbox page card normalization', () => {
  it('renders legacy overview rows defensively in the service badges', async () => {
    mockRoutes({
      poll: devboxPollBundle({ overview: [{ title: 'Bridge', value: 'up' }] }),
    });
    render(<DevboxPage />);
    await openTab('services');

    const bridge = await screen.findByTestId('devbox-service-value-bridge');
    expect(bridge.textContent).toBe('running');
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
      await openTab('services');

      expect(await screen.findByText('Ingress tunnel')).toBeTruthy();
      expect(screen.getByText('stitch-devbox.card.missing')).toBeTruthy();
    } finally {
      unregisterPluginBundles('stitch-devbox');
    }
  });
});
