import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

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

  it('keeps the CTA enabled with an amber non-blocking chip when only the runner is down', async () => {
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

    const runnerChip = screen.getByTestId('devbox-prompt-chip-runner');
    expect(runnerChip.className).toContain('text-amber-300');
    expect(runnerChip.textContent).toBe(t('devboxPage.restart'));

    fireEvent.click(runnerChip);
    expect(devboxCallArgs(invokeMock, 'stack_start')).toEqual([
      { name: 'midsai', preview: false },
    ]);
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
    expect(screen.getByTestId('devbox-prompt-chip-runner').className).toContain(
      'text-amber-300',
    );
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
      expect(writeText).toHaveBeenCalledWith(revealedAgentPromptFixture.prompt);
    });
    expect(devboxCallArgs(invokeMock, 'agent_prompt')).toContainEqual({
      task,
      reveal: true,
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
    expect(devboxCallArgs(invokeMock, 'agent_prompt')).toContainEqual({ reveal: true });

    fireEvent.change(acceptance, { target: { value: 'тесты зелёные' } });
    fireEvent.click(screen.getByTestId('devbox-prompt-copy'));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(2);
    });
    expect(devboxCallArgs(invokeMock, 'agent_prompt')).toContainEqual({
      acceptance: 'тесты зелёные',
      reveal: true,
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
        revealedAgentPromptFixture.prompt,
      );
    });
    expect(screen.getByTestId('devbox-prompt-manual-copy').textContent).toBe(
      t('devboxPage.promptManualCopy'),
    );
    expect(screen.queryByTestId('devbox-prompt-preview-masked')).toBeNull();
  });
});

describe('DevboxPrompt preview and errors', () => {
  it('keeps the preview collapsed by default and expands to the masked prompt with a badge', async () => {
    renderPrompt();
    await chipsReady();

    expect(screen.queryByTestId('devbox-prompt-preview')).toBeNull();

    fireEvent.click(screen.getByTestId('devbox-prompt-preview-toggle'));
    expect(screen.getByTestId('devbox-prompt-preview').textContent).toBe(
      maskedAgentPromptFixture.prompt,
    );
    expect(screen.getByTestId('devbox-prompt-preview-masked').textContent).toBe(
      t('devboxPage.promptPreviewMasked'),
    );
  });

  it('eye toggle refetches with the flipped reveal flag', async () => {
    renderPrompt();
    await chipsReady();
    expect(devboxCallArgs(invokeMock, 'agent_prompt')).toEqual([{ reveal: false }]);

    fireEvent.click(screen.getByTestId('devbox-prompt-reveal'));
    await waitFor(() => {
      expect(devboxCallArgs(invokeMock, 'agent_prompt')).toContainEqual({ reveal: true });
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
