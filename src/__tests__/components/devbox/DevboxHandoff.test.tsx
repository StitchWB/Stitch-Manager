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

import { safeInvoke } from '@/lib/backend/core/invoke';
import { t } from '@/lib/i18n';
import { DevboxHandoff } from '@/components/devbox/DevboxHandoff';
import {
  devboxRouter,
  devboxCallArgs,
  pageRoutes,
  maskedHandoffFixture,
  revealedHandoffFixture,
} from './devboxTestKit';

const invokeMock = safeInvoke as jest.Mock;
let writeText: jest.Mock;

function handoffRoutes(overrides = {}) {
  return devboxRouter(
    pageRoutes({
      handoff_block: (p: Record<string, unknown>) =>
        p.reveal === true ? revealedHandoffFixture : maskedHandoffFixture,
      ...overrides,
    }),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  invokeMock.mockImplementation(handoffRoutes());
  writeText = jest.fn(async () => undefined);
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
});

describe('DevboxHandoff block display', () => {
  it('loads the masked block on mount and shows the masked badge', async () => {
    render(<DevboxHandoff />);

    const pre = await screen.findByTestId('devbox-handoff-block');
    await waitFor(() => {
      expect(pre.textContent).toBe(maskedHandoffFixture.block);
    });
    expect(screen.getByTestId('devbox-handoff-masked')).toBeTruthy();
    expect(devboxCallArgs(invokeMock, 'handoff_block')).toEqual([{ reveal: false }]);
  });

  it('reveal re-invokes with reveal=true and shows the unmasked text', async () => {
    render(<DevboxHandoff />);
    await screen.findByTestId('devbox-handoff-block');

    fireEvent.click(screen.getByTestId('devbox-handoff-reveal'));

    await waitFor(() => {
      expect(screen.getByTestId('devbox-handoff-block').textContent).toBe(
        revealedHandoffFixture.block,
      );
    });
    expect(screen.queryByTestId('devbox-handoff-masked')).toBeNull();
    expect(devboxCallArgs(invokeMock, 'handoff_block')).toContainEqual({ reveal: true });
  });

  it('refetches with the current reveal flag when reloadTick increments', async () => {
    const { rerender } = render(<DevboxHandoff reloadTick={0} />);
    await screen.findByTestId('devbox-handoff-block');
    expect(devboxCallArgs(invokeMock, 'handoff_block')).toEqual([{ reveal: false }]);

    rerender(<DevboxHandoff reloadTick={1} />);
    await waitFor(() => {
      expect(devboxCallArgs(invokeMock, 'handoff_block')).toHaveLength(2);
    });
    expect(devboxCallArgs(invokeMock, 'handoff_block')[1]).toEqual({ reveal: false });

    fireEvent.click(screen.getByTestId('devbox-handoff-reveal'));
    await waitFor(() => {
      expect(devboxCallArgs(invokeMock, 'handoff_block')).toHaveLength(3);
    });

    rerender(<DevboxHandoff reloadTick={2} />);
    await waitFor(() => {
      expect(devboxCallArgs(invokeMock, 'handoff_block')).toHaveLength(4);
    });
    expect(devboxCallArgs(invokeMock, 'handoff_block')[3]).toEqual({ reveal: true });
  });

  it('renders the section error with retry and no body when the command fails', async () => {
    invokeMock.mockImplementation(
      handoffRoutes({
        handoff_block: () => {
          throw new Error('handoff_block unavailable');
        },
      }),
    );
    render(<DevboxHandoff />);

    const error = await screen.findByTestId('devbox-handoff-error');
    expect(error.textContent).toContain('handoff_block unavailable');
    expect(screen.queryByTestId('devbox-handoff-block')).toBeNull();
    expect(screen.queryByTestId('devbox-handoff-copy')).toBeNull();
    expect(screen.queryByTestId('devbox-handoff-task')).toBeNull();
    expect(screen.queryByTestId('devbox-handoff-reveal')).toBeNull();

    fireEvent.click(screen.getByText('Retry'));
    await waitFor(() => {
      expect(devboxCallArgs(invokeMock, 'handoff_block').length).toBeGreaterThanOrEqual(2);
    });
  });

  it('shows the stale-plugin hint instead of the raw JSON-RPC error', async () => {
    invokeMock.mockImplementation(
      handoffRoutes({
        handoff_block: () => {
          throw new Error('Method not found: plugin.stitch-devbox.handoff_block (-32601)');
        },
      }),
    );
    render(<DevboxHandoff />);

    const error = await screen.findByTestId('devbox-handoff-error');
    expect(error.textContent).toContain(t('devboxPage.handoffErrorStale'));
    expect(error.textContent).not.toContain('-32601');
  });
});

describe('DevboxHandoff clipboard', () => {
  it('copy with empty task fetches the full block and writes intro + block + no-task closer', async () => {
    render(<DevboxHandoff />);
    await screen.findByTestId('devbox-handoff-block');
    expect(devboxCallArgs(invokeMock, 'handoff_block')).toEqual([{ reveal: false }]);

    fireEvent.click(screen.getByTestId('devbox-handoff-copy'));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        `${t('devboxPage.handoffPromptIntro')}\n\n${revealedHandoffFixture.block}\n\n${t('devboxPage.handoffNoTask')}`,
      );
    });
    expect(devboxCallArgs(invokeMock, 'handoff_block')).toEqual([
      { reveal: false },
      { reveal: true },
    ]);
    expect(screen.getByTestId('devbox-handoff-masked')).toBeTruthy();
    expect(screen.getByTestId('devbox-handoff-block').textContent).toBe(
      maskedHandoffFixture.block,
    );
  });

  it('copy with a task writes intro + full block + task header + task', async () => {
    render(<DevboxHandoff />);
    await screen.findByTestId('devbox-handoff-block');

    const task = 'Fix the ingress tunnel';
    fireEvent.change(screen.getByTestId('devbox-handoff-task'), { target: { value: task } });
    fireEvent.click(screen.getByTestId('devbox-handoff-copy'));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(
        `${t('devboxPage.handoffPromptIntro')}\n\n${revealedHandoffFixture.block}\n\n${t('devboxPage.handoffTaskHeader')}\n${task}`,
      );
    });
  });

  it('reveal fills the full block so copy does not refetch', async () => {
    render(<DevboxHandoff />);
    await screen.findByTestId('devbox-handoff-block');

    fireEvent.click(screen.getByTestId('devbox-handoff-reveal'));
    await waitFor(() => {
      expect(screen.getByTestId('devbox-handoff-block').textContent).toBe(
        revealedHandoffFixture.block,
      );
    });

    fireEvent.click(screen.getByTestId('devbox-handoff-copy'));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalled();
    });
    expect(devboxCallArgs(invokeMock, 'handoff_block')).toEqual([
      { reveal: false },
      { reveal: true },
    ]);
    expect(writeText.mock.calls[0][0]).toContain(revealedHandoffFixture.block);
  });

  it('template button inserts the task brief skeleton', async () => {
    render(<DevboxHandoff />);
    await screen.findByTestId('devbox-handoff-block');

    fireEvent.click(screen.getByTestId('devbox-handoff-template'));
    const textarea = screen.getByTestId('devbox-handoff-task') as HTMLTextAreaElement;
    expect(textarea.value).toBe(t('devboxPage.handoffTaskTemplate'));
    expect(textarea.value).toContain('Goal:');
    expect(textarea.value).toContain('Report:');
  });
});
