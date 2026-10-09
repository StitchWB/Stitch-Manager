/**
 * Devbox controls cluster — confirm gates on danger controls, action progress,
 * ingress toggle direction, and payload surfaces from finished actions
 * (AMENDMENT A1: action_status recent[] carries payload).
 *
 * Mocks: safeInvoke (routed by command name), sonner. i18n runs REAL.
 */

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
import { DevboxControls } from '@/components/devbox/DevboxControls';
import type {
  DevboxAccepted,
  DevboxActionCurrent,
  DevboxActionStatus,
  DevboxRecentAction,
  DevboxVitalCard,
} from '@/lib/backend/modules/devbox';
import {
  devboxRouter,
  devboxCalls,
  devboxCallArgs,
  overviewFixture,
  profilesFixture,
  pageRoutes,
} from './devboxTestKit';

const invokeMock = safeInvoke as jest.Mock;
const accepted: DevboxAccepted = { accepted: true, actionId: 'act-1' };

function renderControls(opts: {
  busy?: boolean;
  recent?: DevboxRecentAction[];
  current?: DevboxActionCurrent | null;
  cards?: DevboxVitalCard[];
} = {}) {
  const onAction = jest.fn(() => undefined);
  const actionStatus: DevboxActionStatus = {
    busy: opts.busy ?? false,
    current: opts.current ?? null,
    recent: opts.recent ?? [],
  };
  render(
    <DevboxControls
      profiles={profilesFixture}
      overviewCards={opts.cards ?? overviewFixture.cards}
      actionStatus={actionStatus}
      busy={opts.busy ?? false}
      onAction={onAction as unknown as (action: Promise<DevboxAccepted>) => void}
    />,
  );
  return onAction;
}

beforeEach(() => {
  jest.clearAllMocks();
  invokeMock.mockImplementation(
    devboxRouter(pageRoutes({ stack_full_down: accepted, stack_down: accepted, issue_tokens: accepted })),
  );
});

describe('Devbox controls confirm gates', () => {
  it('stack_full_down requires a second (armed) click', async () => {
    renderControls();
    const stopAll = screen.getByTestId('devbox-control-stop-all');

    fireEvent.click(stopAll);
    expect(devboxCalls(invokeMock, 'stack_full_down')).toHaveLength(0);
    expect(stopAll.textContent).toBe('Sure?');

    fireEvent.click(stopAll);
    await waitFor(() => {
      expect(devboxCalls(invokeMock, 'stack_full_down')).toHaveLength(1);
    });
  });

  it('stack_down requires a second (armed) click', async () => {
    renderControls();
    const stopServices = screen.getByTestId('devbox-control-stop-services');

    fireEvent.click(stopServices);
    expect(devboxCalls(invokeMock, 'stack_down')).toHaveLength(0);

    fireEvent.click(stopServices);
    await waitFor(() => {
      expect(devboxCalls(invokeMock, 'stack_down')).toHaveLength(1);
    });
  });

  it('issue_tokens requires a second (armed) click', async () => {
    renderControls();
    const tokens = screen.getByTestId('devbox-control-tokens');

    fireEvent.click(tokens);
    expect(devboxCalls(invokeMock, 'issue_tokens')).toHaveLength(0);

    fireEvent.click(tokens);
    await waitFor(() => {
      expect(devboxCalls(invokeMock, 'issue_tokens')).toHaveLength(1);
    });
  });

  it('per-profile stack_start is confirm-gated and sends {name, preview}', async () => {
    renderControls();
    const start = screen.getByTestId('devbox-profile-start-example-simple');

    fireEvent.click(start);
    expect(devboxCalls(invokeMock, 'stack_start')).toHaveLength(0);

    fireEvent.click(start);
    await waitFor(() => {
      expect(devboxCallArgs(invokeMock, 'stack_start')).toEqual([
        { name: 'example-simple', preview: false },
      ]);
    });
  });

  it('disables every control while an action is busy', () => {
    renderControls({
      busy: true,
      current: { id: 'a9', cmd: 'stack_start', startedAt: 1791536987.76 },
    });

    expect(screen.getByTestId('devbox-control-stop-all')).toBeDisabled();
    expect(screen.getByTestId('devbox-control-tokens')).toBeDisabled();
    expect(screen.getByTestId('devbox-control-doctor')).toBeDisabled();
    expect(screen.getByTestId('devbox-control-ingress')).toBeDisabled();
    expect(screen.getByTestId('devbox-control-cockpit')).toBeDisabled();
    expect(screen.getByTestId('devbox-progress')).toBeTruthy();
    expect(screen.getByText(/stack_start/)).toBeTruthy();
  });
});

describe('Devbox controls ingress toggle', () => {
  it('sends down when overview reports ingress up, and vice versa', async () => {
    renderControls();
    const ingress = screen.getByTestId('devbox-control-ingress');
    expect(ingress.textContent).toBe('Ingress: on');

    fireEvent.click(ingress);
    await waitFor(() => {
      expect(devboxCallArgs(invokeMock, 'ingress_control')).toEqual([{ action: 'down' }]);
    });
  });

  it('sends up when ingress is down', async () => {
    const cards = overviewFixture.cards.map(c =>
      c.id === 'ingress' ? { ...c, value: 'down', tone: 'down' as const } : c,
    );
    renderControls({ cards });
    const ingress = screen.getByTestId('devbox-control-ingress');
    expect(ingress.textContent).toBe('Ingress: off');

    fireEvent.click(ingress);
    await waitFor(() => {
      expect(devboxCallArgs(invokeMock, 'ingress_control')).toEqual([{ action: 'up' }]);
    });
  });
});

describe('Devbox controls payload surfaces (A1)', () => {
  it('renders a copyable chatBlock from a finished issue_tokens payload', async () => {
    const chatBlock = 'INGRESS=https://x.trycloudflare.com\nMCP_TOKEN=abc123';
    const writeText = jest.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    renderControls({
      recent: [
        {
          id: 'a1',
          cmd: 'issue_tokens',
          status: 'finished',
          startedAt: 1791536987.76,
          finishedAt: 1791536990.1,
          exit: 0,
          payload: { chatBlock },
        },
      ],
    });

    const block = screen.getByTestId('devbox-chat-block');
    expect(block).toBeTruthy();
    const textarea = screen.getByTestId('devbox-chat-block-text') as HTMLTextAreaElement;
    expect(textarea.value).toBe(chatBlock);

    fireEvent.click(screen.getByTestId('devbox-chat-block-copy'));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(chatBlock);
    });
  });

  it('renders the doctor report from a finished run_doctor payload in a scrollable pre', () => {
    renderControls({
      recent: [
        {
          id: 'a2',
          cmd: 'run_doctor',
          status: 'finished',
          startedAt: 1791536987.76,
          finishedAt: 1791536990.1,
          exit: 0,
          payload: { report: 'PASS tunnel\nFAIL watchdog' },
        },
      ],
    });

    const report = screen.getByTestId('devbox-doctor-report');
    expect(report.tagName).toBe('PRE');
    expect(report.textContent).toBe('PASS tunnel\nFAIL watchdog');
    expect(report.className).toContain('overflow-auto');
  });

  it('renders the cockpit url from a finished cockpit_open payload as a clickable link', () => {
    const openSpy = jest.spyOn(window, 'open').mockImplementation(() => null);
    renderControls({
      recent: [
        {
          id: 'a3',
          cmd: 'cockpit_open',
          status: 'finished',
          startedAt: 1791536987.76,
          finishedAt: 1791536988.0,
          exit: 0,
          payload: { url: 'http://127.0.0.1:8790/?token=one' },
        },
      ],
    });

    const link = screen.getByTestId('devbox-cockpit-url');
    expect(link.textContent).toContain('http://127.0.0.1:8790/?token=one');
    fireEvent.click(link);
    expect(openSpy).toHaveBeenCalledWith(
      'http://127.0.0.1:8790/?token=one',
      '_blank',
      'noopener,noreferrer',
    );
    openSpy.mockRestore();
  });

  it('ignores payloads of failed actions', () => {
    renderControls({
      recent: [
        {
          id: 'a4',
          cmd: 'issue_tokens',
          status: 'finished',
          startedAt: 1791536987.76,
          finishedAt: 1791536990.1,
          exit: 1,
          payload: { chatBlock: 'SECRET' },
        },
      ],
    });

    expect(screen.queryByTestId('devbox-chat-block')).toBeNull();
  });
});
