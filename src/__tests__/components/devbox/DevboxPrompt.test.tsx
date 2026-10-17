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

import { toast } from 'sonner';
import { safeInvoke } from '@/lib/backend/core/invoke';
import { t } from '@/lib/i18n';
import type { DevboxAccepted } from '@/lib/backend/modules/devbox';
import { DevboxPrompt, type DevboxPromptProps } from '@/components/devbox/DevboxPrompt';
import {
  devboxRouter,
  devboxCallArgs,
  pageRoutes,
  profilesFixture,
  overviewFixture,
  idleActionStatus,
  maskedAgentPromptFixture,
  revealedAgentPromptFixture,
  agentPromptNoReadyFixture,
  agentPromptRoute,
  promptWithClient,
  rotatedTokensStatus,
  type DevboxRoutes,
} from './devboxTestKit';

const invokeMock = safeInvoke as jest.Mock;
let writeText: jest.Mock;
let onAction: jest.Mock;

function promptRoutes(overrides: DevboxRoutes = {}) {
  return devboxRouter(pageRoutes(overrides));
}

function renderPrompt(props: Partial<DevboxPromptProps> = {}) {
  return render(
    <DevboxPrompt
      profiles={profilesFixture}
      overviewCards={overviewFixture.cards}
      actionStatus={idleActionStatus}
      onAction={onAction as (action: Promise<DevboxAccepted>) => void}
      {...props}
    />,
  );
}

async function chipsReady() {
  await screen.findByTestId('devbox-prompt-chips');
}

beforeEach(() => {
  jest.clearAllMocks();
  invokeMock.mockImplementation(promptRoutes());
  onAction = jest.fn();
  writeText = jest.fn(async () => undefined);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
});

afterEach(() => {
  jest.useRealTimers();
});

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('DevboxPrompt prerequisite chips', () => {
  it('blocks the CTA while a blocking prereq is down and chip CTAs fire the right actions', async () => {
    const blocked = {
      ...maskedAgentPromptFixture,
      ready: { profile: true, bridge: false, ingress: false, runner: true },
    };
    invokeMock.mockImplementation(
      promptRoutes({ agent_prompt: agentPromptRoute(blocked, blocked) }),
    );
    renderPrompt();
    await chipsReady();

    const copy = screen.getByTestId('devbox-prompt-copy') as HTMLButtonElement;
    expect(copy.disabled).toBe(true);

    fireEvent.click(screen.getByTestId('devbox-prompt-chip-bridge'));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(devboxCallArgs(invokeMock, 'stack_start')).toEqual([
      { name: 'midsai', preview: false },
    ]);

    fireEvent.click(screen.getByTestId('devbox-prompt-chip-ingress'));
    expect(onAction).toHaveBeenCalledTimes(2);
    expect(devboxCallArgs(invokeMock, 'ingress_control')).toEqual([{ action: 'up' }]);
  });

  it('keeps the CTA enabled and offers a runner restart button when only the runner is down', async () => {
    const runnerDown = {
      ...maskedAgentPromptFixture,
      ready: { profile: true, bridge: true, ingress: true, runner: false },
    };
    invokeMock.mockImplementation(
      promptRoutes({ agent_prompt: agentPromptRoute(runnerDown, runnerDown) }),
    );
    renderPrompt();
    await chipsReady();

    const copy = screen.getByTestId('devbox-prompt-copy') as HTMLButtonElement;
    expect(copy.disabled).toBe(false);

    expect(screen.queryByTestId('devbox-prompt-chip-runner')).toBeNull();
    const restart = screen.getByTestId('devbox-prompt-runner-restart');
    expect(restart.tagName).toBe('BUTTON');
    expect(restart.textContent).toBe(t('devboxPage.restart'));

    fireEvent.click(restart);
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(devboxCallArgs(invokeMock, 'stack_start')).toEqual([
      { name: 'midsai', preview: false },
    ]);
    expect(copy.disabled).toBe(false);
  });

  it('renders the runner success badge when the runner is up', async () => {
    renderPrompt();
    await chipsReady();

    expect(screen.getByTestId('devbox-prompt-chip-runner').className).toContain(
      'text-emerald-300',
    );
    expect(screen.queryByTestId('devbox-prompt-runner-restart')).toBeNull();
  });

  it('project badge is non-clickable and fires no action', async () => {
    renderPrompt();
    await chipsReady();

    const profile = screen.getByTestId('devbox-prompt-chip-profile');
    expect(profile.tagName).toBe('SPAN');
    expect(profile.className).not.toContain('cursor-pointer');

    fireEvent.click(profile);
    expect(onAction).not.toHaveBeenCalled();
  });

  it('derives chips from overview cards when the payload has no ready field', async () => {
    invokeMock.mockImplementation(
      promptRoutes({
        agent_prompt: agentPromptRoute(agentPromptNoReadyFixture, agentPromptNoReadyFixture),
      }),
    );
    renderPrompt();
    await chipsReady();

    expect(screen.getByTestId('devbox-prompt-chip-profile').className).toContain(
      'text-emerald-300',
    );
    expect(screen.getByTestId('devbox-prompt-chip-ingress').className).toContain(
      'text-emerald-300',
    );
    const bridgeChip = screen.getByTestId('devbox-prompt-chip-bridge');
    expect(bridgeChip.className).toContain('text-red-300');
    expect(bridgeChip.textContent).toBe(t('devboxPage.promptChipStackStart'));
    expect(screen.getByTestId('devbox-prompt-runner-restart')).toBeTruthy();
    expect(
      (screen.getByTestId('devbox-prompt-copy') as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

describe('DevboxPrompt copy flow', () => {
  it('copies the backend-composed prompt verbatim on CTA click and on Ctrl+Enter', async () => {
    renderPrompt();
    await chipsReady();

    const task = 'почини падающий логин';
    fireEvent.change(screen.getByTestId('devbox-prompt-task'), { target: { value: task } });
    fireEvent.click(screen.getByTestId('devbox-prompt-copy'));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(promptWithClient(revealedAgentPromptFixture));
    });
    expect(devboxCallArgs(invokeMock, 'agent_prompt')).toContainEqual({
      task,
      reveal: true,
      client: 'universal',
    });
    expect(toast.success).toHaveBeenCalled();

    fireEvent.keyDown(screen.getByTestId('devbox-prompt-task'), {
      key: 'Enter',
      ctrlKey: true,
    });
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(2);
    });
  });

  it('sends acceptance in invoke args only when the field is filled', async () => {
    renderPrompt();
    await chipsReady();

    fireEvent.click(screen.getByTestId('devbox-prompt-acceptance-toggle'));
    const acceptance = screen.getByTestId('devbox-prompt-acceptance');

    fireEvent.click(screen.getByTestId('devbox-prompt-copy'));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(1);
    });
    expect(devboxCallArgs(invokeMock, 'agent_prompt')).toContainEqual({
      reveal: true,
      client: 'universal',
    });

    fireEvent.change(acceptance, { target: { value: 'тесты зелёные' } });
    fireEvent.click(screen.getByTestId('devbox-prompt-copy'));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(2);
    });
    expect(devboxCallArgs(invokeMock, 'agent_prompt')).toContainEqual({
      acceptance: 'тесты зелёные',
      reveal: true,
      client: 'universal',
    });
  });

  it('warns about a stale copy after tokens were rotated', async () => {
    const future = Math.floor(Date.now() / 1000) + 60;
    renderPrompt({ actionStatus: rotatedTokensStatus(future) });
    await chipsReady();

    expect(screen.queryByTestId('devbox-prompt-stale')).toBeNull();

    fireEvent.click(screen.getByTestId('devbox-prompt-copy'));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.getByTestId('devbox-prompt-stale').textContent).toBe(
        t('devboxPage.promptStale'),
      );
    });
  });

  it('on clipboard reject shows an error toast and a revealed manual-copy preview', async () => {
    writeText = jest.fn(async () => {
      throw new Error('denied');
    });
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    renderPrompt();
    await chipsReady();

    fireEvent.click(screen.getByTestId('devbox-prompt-copy'));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.getByTestId('devbox-prompt-preview').textContent).toBe(
        promptWithClient(revealedAgentPromptFixture),
      );
    });
    expect(screen.getByTestId('devbox-prompt-manual-copy').textContent).toBe(
      t('devboxPage.promptManualCopy'),
    );
    expect(screen.queryByTestId('devbox-prompt-preview-locked')).toBeNull();
  });
});

describe('DevboxPrompt preview and errors', () => {
  it('keeps the prompt tab hidden by default and switches to it via the tabs only', async () => {
    renderPrompt();
    await chipsReady();

    expect(screen.queryByTestId('devbox-prompt-preview')).toBeNull();
    expect(screen.queryByTestId('devbox-prompt-preview-toggle')).toBeNull();

    fireEvent.click(screen.getByText(t('devboxPage.promptTabPrompt')));
    expect(screen.getByTestId('devbox-prompt-preview').textContent).toBe(
      promptWithClient(maskedAgentPromptFixture),
    );
    expect(screen.getByTestId('devbox-prompt-preview-locked').textContent).toBe(
      t('devboxPage.promptPreviewLocked'),
    );
    expect(screen.queryByTestId('devbox-prompt-task')).toBeNull();

    fireEvent.click(screen.getByText(t('devboxPage.promptTabEditor')));
    expect(screen.getByTestId('devbox-prompt-task')).toBeTruthy();
    expect(screen.queryByTestId('devbox-prompt-preview')).toBeNull();
  });

  it('eye toggle refetches with the flipped reveal flag', async () => {
    renderPrompt();
    await chipsReady();
    expect(devboxCallArgs(invokeMock, 'agent_prompt')).toEqual([
      { reveal: false, client: 'universal' },
    ]);

    fireEvent.click(screen.getByTestId('devbox-prompt-reveal'));
    await waitFor(() => {
      expect(devboxCallArgs(invokeMock, 'agent_prompt')).toContainEqual({
        reveal: true,
        client: 'universal',
      });
    });

    fireEvent.click(screen.getByTestId('devbox-prompt-reveal'));
    await waitFor(() => {
      expect(devboxCallArgs(invokeMock, 'agent_prompt').filter(a => a.reveal === false)).toHaveLength(2);
    });
  });

  it('shows the stale-plugin hint and hides the body on -32601', async () => {
    invokeMock.mockImplementation(
      promptRoutes({
        agent_prompt: () => {
          throw new Error('Method not found: plugin.stitch-devbox.agent_prompt (-32601)');
        },
      }),
    );
    renderPrompt();

    const error = await screen.findByTestId('devbox-prompt-error');
    expect(error.textContent).toContain(t('devboxPage.handoffErrorStale'));
    expect(error.textContent).not.toContain('-32601');
    expect(screen.queryByTestId('devbox-prompt-chips')).toBeNull();
    expect(screen.queryByTestId('devbox-prompt-copy')).toBeNull();
    expect(screen.queryByTestId('devbox-prompt-task')).toBeNull();
  });

  it('renders a section error with retry for other failures', async () => {
    invokeMock.mockImplementation(
      promptRoutes({
        agent_prompt: () => {
          throw new Error('agent_prompt exploded');
        },
      }),
    );
    renderPrompt();

    const error = await screen.findByTestId('devbox-prompt-error');
    expect(error.textContent).toContain('agent_prompt exploded');
    expect(screen.queryByTestId('devbox-prompt-copy')).toBeNull();

    invokeMock.mockImplementation(promptRoutes());
    fireEvent.click(screen.getByText('Retry'));
    await waitFor(() => {
      expect(screen.getByTestId('devbox-prompt-copy')).toBeTruthy();
    });
  });
});

describe('DevboxPrompt agent client selector', () => {
  it('renders 13 client options with universal selected by default', async () => {
    renderPrompt();
    await chipsReady();

    const select = screen.getByTestId('devbox-prompt-client') as HTMLSelectElement;
    const options = Array.from(select.querySelectorAll('option'));
    expect(options.map(option => option.value)).toEqual([
      'universal',
      'claude-code',
      'opencode',
      'codex',
      'cursor',
      'vscode',
      'cline',
      'roo',
      'gemini',
      'zed',
      'factory',
      'kiro',
      'windsurf',
    ]);
    expect(options[0].textContent).toBe(t('devboxPage.promptClientUniversal'));
    expect(select.value).toBe('universal');
  });

  it('sends client=universal on the default masked load without interaction', async () => {
    renderPrompt();
    await chipsReady();

    expect(devboxCallArgs(invokeMock, 'agent_prompt')).toEqual([
      { reveal: false, client: 'universal' },
    ]);
  });

  it('refetches the masked preview with the chosen client on selection change', async () => {
    renderPrompt();
    await chipsReady();

    fireEvent.change(screen.getByTestId('devbox-prompt-client'), {
      target: { value: 'opencode' },
    });
    await waitFor(() => {
      expect(devboxCallArgs(invokeMock, 'agent_prompt')).toContainEqual({
        reveal: false,
        client: 'opencode',
      });
    });

    fireEvent.click(screen.getByText(t('devboxPage.promptTabPrompt')));
    await waitFor(() => {
      expect(screen.getByTestId('devbox-prompt-preview').textContent).toBe(
        promptWithClient(maskedAgentPromptFixture, 'opencode'),
      );
    });
  });

  it('passes the current client in the reveal=true copy fetch', async () => {
    renderPrompt();
    await chipsReady();

    fireEvent.change(screen.getByTestId('devbox-prompt-client'), {
      target: { value: 'cursor' },
    });
    fireEvent.click(screen.getByTestId('devbox-prompt-copy'));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        promptWithClient(revealedAgentPromptFixture, 'cursor'),
      );
    });
    expect(devboxCallArgs(invokeMock, 'agent_prompt')).toContainEqual({
      reveal: true,
      client: 'cursor',
    });
  });
});

describe('DevboxPrompt copy feedback', () => {
  it('flashes the copied label on the CTA for 2s then reverts', async () => {
    jest.useFakeTimers();
    renderPrompt();
    await flushMicrotasks();
    expect(screen.getByTestId('devbox-prompt-chips')).toBeTruthy();

    fireEvent.click(screen.getByTestId('devbox-prompt-copy'));
    await flushMicrotasks();

    expect(writeText).toHaveBeenCalled();
    expect(screen.getByTestId('devbox-prompt-copy').textContent).toBe(
      t('devboxPage.promptCopied'),
    );

    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(screen.getByTestId('devbox-prompt-copy').textContent).toBe(
      t('devboxPage.promptCopy'),
    );
  });

  it('flashes the same footer CTA on the prompt tab', async () => {
    jest.useFakeTimers();
    renderPrompt();
    await flushMicrotasks();

    fireEvent.click(screen.getByText(t('devboxPage.promptTabPrompt')));
    fireEvent.click(screen.getByTestId('devbox-prompt-copy'));
    await flushMicrotasks();

    expect(screen.getByTestId('devbox-prompt-copy').textContent).toBe(
      t('devboxPage.promptCopied'),
    );
  });
});

describe('DevboxPrompt action footer', () => {
  it('renders one footer with criteria+tokens toolbar and a single copy CTA on both tabs', async () => {
    renderPrompt();
    await chipsReady();

    const footer = screen.getByTestId('devbox-prompt-footer');
    expect(screen.getAllByTestId('devbox-prompt-copy')).toHaveLength(1);
    expect(footer.contains(screen.getByTestId('devbox-prompt-acceptance-toggle'))).toBe(true);
    expect(footer.contains(screen.getByTestId('devbox-prompt-reveal'))).toBe(true);
    expect(screen.queryByTestId('devbox-prompt-preview-toggle')).toBeNull();

    fireEvent.click(screen.getByText(t('devboxPage.promptTabPrompt')));
    expect(screen.getByTestId('devbox-prompt-footer')).toBe(footer);
    expect(screen.getAllByTestId('devbox-prompt-copy')).toHaveLength(1);
    expect(screen.getByTestId('devbox-prompt-preview')).toBeTruthy();
  });

  it('places the dim hint caption directly under the copy CTA', async () => {
    renderPrompt();
    await chipsReady();

    const hint = screen.getByTestId('devbox-prompt-hint');
    expect(hint.className).toContain('text-2xs');
    expect(hint.className).toContain('text-slate-500');
    const column = hint.parentElement;
    expect(column?.contains(screen.getByTestId('devbox-prompt-copy'))).toBe(true);
    expect(column?.lastElementChild).toBe(hint);
  });
});

describe('DevboxPrompt hint and warning lines', () => {
  it('shows the universal hint by default and a client hint after selection', async () => {
    renderPrompt();
    await chipsReady();

    expect(screen.getByTestId('devbox-prompt-hint').textContent).toBe(
      t('devboxPage.promptHintUniversal'),
    );

    fireEvent.change(screen.getByTestId('devbox-prompt-client'), {
      target: { value: 'opencode' },
    });
    await waitFor(() => {
      expect(screen.getByTestId('devbox-prompt-hint').textContent).toBe(
        t('devboxPage.promptHintClient', { client: 'OpenCode' }),
      );
    });
  });

  it('renders the amber stack alert plate while copy is blocked by prereqs', async () => {
    const blocked = {
      ...maskedAgentPromptFixture,
      ready: { profile: true, bridge: false, ingress: false, runner: true },
    };
    invokeMock.mockImplementation(
      promptRoutes({ agent_prompt: agentPromptRoute(blocked, blocked) }),
    );
    renderPrompt();
    await chipsReady();

    const warning = screen.getByTestId('devbox-prompt-stack-warning');
    expect(warning.textContent).toBe(t('devboxPage.promptStackDownWarning'));
    expect(warning.className).toContain('border-amber-500/40');
    expect(warning.className).toContain('bg-amber-500/10');
    expect(warning.className).toContain('text-amber-200');
    expect(screen.queryByTestId('devbox-prompt-runner-warning')).toBeNull();
  });

  it('renders the runner micro-alert plate when copy is enabled but the runner is down', async () => {
    const runnerDown = {
      ...maskedAgentPromptFixture,
      ready: { profile: true, bridge: true, ingress: true, runner: false },
    };
    invokeMock.mockImplementation(
      promptRoutes({ agent_prompt: agentPromptRoute(runnerDown, runnerDown) }),
    );
    renderPrompt();
    await chipsReady();

    expect(screen.queryByTestId('devbox-prompt-stack-warning')).toBeNull();
    const warning = screen.getByTestId('devbox-prompt-runner-warning');
    expect(warning.textContent).toBe(t('devboxPage.promptRunnerDownHint'));
    expect(warning.className).toContain('border-amber-500/40');
    expect(warning.className).toContain('bg-amber-500/10');
    expect(warning.className).toContain('text-amber-200');
    expect(warning.className).toContain('text-2xs');

    const task = screen.getByTestId('devbox-prompt-task');
    expect(
      task.compareDocumentPosition(warning) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe('DevboxPrompt editor layout', () => {
  it('opens the acceptance accordion as a bordered panel with rows=3 and closes it', async () => {
    renderPrompt();
    await chipsReady();

    expect(screen.queryByTestId('devbox-prompt-acceptance-panel')).toBeNull();

    fireEvent.click(screen.getByTestId('devbox-prompt-acceptance-toggle'));
    expect(screen.getByTestId('devbox-prompt-acceptance-panel')).toBeTruthy();
    const acceptance = screen.getByTestId('devbox-prompt-acceptance') as HTMLTextAreaElement;
    expect(acceptance.rows).toBe(3);

    fireEvent.click(screen.getByTestId('devbox-prompt-acceptance-toggle'));
    expect(screen.queryByTestId('devbox-prompt-acceptance-panel')).toBeNull();
  });

  it('syncs the task textarea height on input instead of stretching the column', async () => {
    renderPrompt();
    await chipsReady();

    const task = screen.getByTestId('devbox-prompt-task') as HTMLTextAreaElement;
    expect(task.className).toContain('max-h-[40vh]');
    fireEvent.change(task, { target: { value: 'x'.repeat(400) } });
    expect(task.style.height).toBe('160px');
  });
});
