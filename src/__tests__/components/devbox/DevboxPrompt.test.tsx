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
  gatewayFixture,
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

async function promptReady() {
  await screen.findByTestId('devbox-prompt-copy');
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

describe('DevboxPrompt blocking state', () => {
  it('renders no prereq chip row anymore', async () => {
    renderPrompt();
    await promptReady();

    expect(screen.queryByTestId('devbox-prompt-chips')).toBeNull();
    expect(screen.queryByTestId('devbox-prompt-chip-profile')).toBeNull();
    expect(screen.queryByTestId('devbox-prompt-chip-bridge')).toBeNull();
    expect(screen.queryByTestId('devbox-prompt-chip-ingress')).toBeNull();
    expect(screen.queryByTestId('devbox-prompt-chip-runner')).toBeNull();
    expect(screen.queryByTestId('devbox-prompt-runner-restart')).toBeNull();
  });

  it('blocks the CTA and embeds a single stack fix button when more than one service is down', async () => {
    const blocked = {
      ...maskedAgentPromptFixture,
      ready: { profile: true, bridge: false, ingress: false, runner: true },
    };
    invokeMock.mockImplementation(
      promptRoutes({ agent_prompt: agentPromptRoute(blocked, blocked) }),
    );
    renderPrompt();
    await promptReady();

    const copy = screen.getByTestId('devbox-prompt-copy') as HTMLButtonElement;
    expect(copy.disabled).toBe(true);

    const warning = screen.getByTestId('devbox-prompt-stack-warning');
    const stackButton = screen.getByTestId('devbox-prompt-alert-stack-start');
    expect(stackButton.tagName).toBe('BUTTON');
    expect(warning.contains(stackButton)).toBe(true);
    expect(stackButton.textContent).toBe(t('devboxPage.promptChipStackStart'));
    expect(screen.queryByTestId('devbox-prompt-alert-ingress-up')).toBeNull();
    expect(warning.querySelectorAll('button')).toHaveLength(1);

    fireEvent.click(stackButton);
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(devboxCallArgs(invokeMock, 'stack_start')).toEqual([
      { name: 'midsai', preview: false },
    ]);
  });

  it('shows only the stack fix button when runner and ingress are down', async () => {
    const blocked = {
      ...maskedAgentPromptFixture,
      ready: { profile: true, bridge: true, ingress: false, runner: false },
    };
    invokeMock.mockImplementation(
      promptRoutes({ agent_prompt: agentPromptRoute(blocked, blocked) }),
    );
    renderPrompt();
    await promptReady();

    const warning = screen.getByTestId('devbox-prompt-stack-warning');
    expect(screen.getByTestId('devbox-prompt-alert-stack-start')).toBeTruthy();
    expect(screen.queryByTestId('devbox-prompt-alert-ingress-up')).toBeNull();
    expect(warning.querySelectorAll('button')).toHaveLength(1);
  });

  it('shows only the ingress fix button when ingress is the sole blocker', async () => {
    const blocked = {
      ...maskedAgentPromptFixture,
      ready: { profile: true, bridge: true, ingress: false, runner: true },
    };
    invokeMock.mockImplementation(
      promptRoutes({ agent_prompt: agentPromptRoute(blocked, blocked) }),
    );
    renderPrompt();
    await promptReady();

    expect(
      (screen.getByTestId('devbox-prompt-copy') as HTMLButtonElement).disabled,
    ).toBe(true);
    const warning = screen.getByTestId('devbox-prompt-stack-warning');
    expect(screen.queryByTestId('devbox-prompt-alert-stack-start')).toBeNull();
    const ingressButton = screen.getByTestId('devbox-prompt-alert-ingress-up');
    expect(ingressButton.textContent).toBe(t('devboxPage.promptChipIngressUp'));
    expect(warning.querySelectorAll('button')).toHaveLength(1);

    fireEvent.click(ingressButton);
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(devboxCallArgs(invokeMock, 'ingress_control')).toEqual([{ action: 'up' }]);
  });

  it('keeps the CTA enabled and a text-only runner hint when only the runner is down', async () => {
    const runnerDown = {
      ...maskedAgentPromptFixture,
      ready: { profile: true, bridge: true, ingress: true, runner: false },
    };
    invokeMock.mockImplementation(
      promptRoutes({ agent_prompt: agentPromptRoute(runnerDown, runnerDown) }),
    );
    renderPrompt();
    await promptReady();

    const copy = screen.getByTestId('devbox-prompt-copy') as HTMLButtonElement;
    expect(copy.disabled).toBe(false);

    expect(screen.queryByTestId('devbox-prompt-stack-warning')).toBeNull();
    const warning = screen.getByTestId('devbox-prompt-runner-warning');
    expect(warning.querySelector('button')).toBeNull();
    expect(screen.queryByTestId('devbox-prompt-runner-restart')).toBeNull();
  });

  it('derives the blocking state from overview cards when the payload has no ready field', async () => {
    invokeMock.mockImplementation(
      promptRoutes({
        agent_prompt: agentPromptRoute(agentPromptNoReadyFixture, agentPromptNoReadyFixture),
      }),
    );
    renderPrompt();
    await promptReady();

    expect(
      (screen.getByTestId('devbox-prompt-copy') as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByTestId('devbox-prompt-alert-stack-start')).toBeTruthy();
    expect(screen.queryByTestId('devbox-prompt-alert-ingress-up')).toBeNull();
  });
});

describe('DevboxPrompt copy flow', () => {
  it('copies the backend-composed prompt verbatim on CTA click and on Ctrl+Enter', async () => {
    renderPrompt();
    await promptReady();

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
    await promptReady();

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
    await promptReady();

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
    await promptReady();

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
    await promptReady();

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
    await promptReady();
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
    await promptReady();

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
    await promptReady();

    expect(devboxCallArgs(invokeMock, 'agent_prompt')).toEqual([
      { reveal: false, client: 'universal' },
    ]);
  });

  it('refetches the masked preview with the chosen client on selection change', async () => {
    renderPrompt();
    await promptReady();

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
    await promptReady();

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
    expect(screen.getByTestId('devbox-prompt-tabs')).toBeTruthy();

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
    await promptReady();

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
    await promptReady();

    const hint = screen.getByTestId('devbox-prompt-hint');
    expect(hint.className).toContain('text-xs');
    expect(hint.className).toContain('text-slate-400');
    const column = hint.parentElement;
    expect(column?.contains(screen.getByTestId('devbox-prompt-copy'))).toBe(true);
    expect(column?.lastElementChild).toBe(hint);
  });
});

describe('DevboxPrompt hint and warning lines', () => {
  it('shows the universal hint by default and a client hint after selection', async () => {
    renderPrompt();
    await promptReady();

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
    await promptReady();

    const warning = screen.getByTestId('devbox-prompt-stack-warning');
    expect(warning.textContent).toContain(t('devboxPage.promptStackDownWarning'));
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
    await promptReady();

    expect(screen.queryByTestId('devbox-prompt-stack-warning')).toBeNull();
    const warning = screen.getByTestId('devbox-prompt-runner-warning');
    expect(warning.textContent).toBe(t('devboxPage.promptRunnerDownHint'));
    expect(warning.className).toContain('border-amber-500/40');
    expect(warning.className).toContain('bg-amber-500/10');
    expect(warning.className).toContain('text-amber-200');
    expect(warning.className).toContain('text-xs');

    const task = screen.getByTestId('devbox-prompt-task');
    expect(
      task.compareDocumentPosition(warning) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe('DevboxPrompt gateway warning', () => {
  it('renders the amber gateway plate when the gateway is enabled with exposed servers but down', async () => {
    renderPrompt({ gateway: { ...gatewayFixture, up: false } });
    await promptReady();

    const warning = screen.getByTestId('devbox-prompt-gateway-warning');
    expect(warning.textContent).toBe(t('devboxPage.gatewayWarnChip'));
    expect(warning.className).toContain('border-amber-500/40');
    expect(warning.className).toContain('bg-amber-500/10');
    expect(warning.className).toContain('text-amber-200');
    expect(warning.querySelector('button')).toBeNull();
  });

  it('omits the gateway plate when the gateway is up', async () => {
    renderPrompt({ gateway: gatewayFixture });
    await promptReady();

    expect(screen.queryByTestId('devbox-prompt-gateway-warning')).toBeNull();
  });

  it('omits the gateway plate when no MCP servers are exposed', async () => {
    renderPrompt({ gateway: { ...gatewayFixture, up: false, exposed_mcps: [] } });
    await promptReady();

    expect(screen.queryByTestId('devbox-prompt-gateway-warning')).toBeNull();
  });

  it('omits the gateway plate when the gateway is disabled even if down with servers', async () => {
    renderPrompt({ gateway: { ...gatewayFixture, enabled: false, up: false } });
    await promptReady();

    expect(screen.queryByTestId('devbox-prompt-gateway-warning')).toBeNull();
  });

  it('keeps the copy CTA enabled in the gateway warning state', async () => {
    renderPrompt({ gateway: { ...gatewayFixture, up: false } });
    await promptReady();

    expect(screen.getByTestId('devbox-prompt-gateway-warning')).toBeTruthy();
    expect(screen.queryByTestId('devbox-prompt-stack-warning')).toBeNull();
    expect(
      (screen.getByTestId('devbox-prompt-copy') as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('stacks the gateway plate below the runner hint when both are down', async () => {
    const runnerDown = {
      ...maskedAgentPromptFixture,
      ready: { profile: true, bridge: true, ingress: true, runner: false },
    };
    invokeMock.mockImplementation(
      promptRoutes({ agent_prompt: agentPromptRoute(runnerDown, runnerDown) }),
    );
    renderPrompt({ gateway: { ...gatewayFixture, up: false } });
    await promptReady();

    const runner = screen.getByTestId('devbox-prompt-runner-warning');
    const gatewayWarning = screen.getByTestId('devbox-prompt-gateway-warning');
    expect(
      runner.compareDocumentPosition(gatewayWarning) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      (screen.getByTestId('devbox-prompt-copy') as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});

describe('DevboxPrompt editor layout', () => {
  it('opens the acceptance accordion as a bordered panel with rows=3 and closes it', async () => {
    renderPrompt();
    await promptReady();

    expect(screen.queryByTestId('devbox-prompt-acceptance-panel')).toBeNull();

    fireEvent.click(screen.getByTestId('devbox-prompt-acceptance-toggle'));
    expect(screen.getByTestId('devbox-prompt-acceptance-panel')).toBeTruthy();
    const acceptance = screen.getByTestId('devbox-prompt-acceptance') as HTMLTextAreaElement;
    expect(acceptance.rows).toBe(3);

    fireEvent.click(screen.getByTestId('devbox-prompt-acceptance-toggle'));
    expect(screen.queryByTestId('devbox-prompt-acceptance-panel')).toBeNull();
  });

  it('orders the editor column: task textarea, acceptance, alert plate, footer', async () => {
    const blocked = {
      ...maskedAgentPromptFixture,
      ready: { profile: true, bridge: false, ingress: false, runner: true },
    };
    invokeMock.mockImplementation(
      promptRoutes({ agent_prompt: agentPromptRoute(blocked, blocked) }),
    );
    renderPrompt();
    await promptReady();

    fireEvent.click(screen.getByTestId('devbox-prompt-acceptance-toggle'));

    const task = screen.getByTestId('devbox-prompt-task');
    const acceptance = screen.getByTestId('devbox-prompt-acceptance-panel');
    const alert = screen.getByTestId('devbox-prompt-stack-warning');
    const footer = screen.getByTestId('devbox-prompt-footer');

    expect(
      task.compareDocumentPosition(acceptance) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      acceptance.compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      alert.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('keeps the prompt section at text-xs floor with readable placeholders and labels', async () => {
    renderPrompt();
    await promptReady();

    fireEvent.click(screen.getByTestId('devbox-prompt-acceptance-toggle'));

    const section = screen.getByTestId('devbox-prompt');
    expect(section.innerHTML).not.toContain('text-2xs');

    expect(screen.getByTestId('devbox-prompt-task').className).toContain(
      'placeholder:text-slate-400',
    );
    expect(screen.getByTestId('devbox-prompt-acceptance').className).toContain(
      'placeholder:text-slate-400',
    );

    const header = screen.getByText(t('devboxPage.promptCriteriaHeader'));
    expect(header.className).toContain('text-xs');
    expect(header.className).toContain('font-medium');
    expect(header.className).toContain('text-slate-300');

    const clientLabel = screen.getByText(t('devboxPage.promptClientLabel'));
    expect(clientLabel.className).toContain('text-xs');
    expect(clientLabel.className).toContain('text-slate-300');
  });

  it('acceptance toggle shows the close label, X icon and secondary variant while open', async () => {
    renderPrompt();
    await promptReady();

    const toggle = screen.getByTestId('devbox-prompt-acceptance-toggle');
    expect(toggle.textContent).toBe(t('devboxPage.promptCriteria'));
    expect(toggle.className).toContain('text-slate-400');
    expect(toggle.querySelector('svg.lucide-plus')).toBeTruthy();

    fireEvent.click(toggle);
    expect(toggle.textContent).toBe(t('devboxPage.promptCriteriaClose'));
    expect(toggle.className).toContain('bg-white/5');
    expect(toggle.className).toContain('border-white/10');
    expect(toggle.querySelector('svg.lucide-x')).toBeTruthy();
    expect(toggle.querySelector('svg.lucide-plus')).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.textContent).toBe(t('devboxPage.promptCriteria'));
    expect(toggle.querySelector('svg.lucide-plus')).toBeTruthy();
  });

  it('caps the task textarea height and keeps it resizable', async () => {
    renderPrompt();
    await promptReady();

    const task = screen.getByTestId('devbox-prompt-task') as HTMLTextAreaElement;
    expect(task.className).toContain('min-h-[200px]');
    expect(task.className).toContain('max-h-[420px]');
    expect(task.className).toContain('resize-y');

    fireEvent.change(task, { target: { value: 'x'.repeat(400) } });
    expect(task.style.height).toBe('');
  });
});
