/**
 * Devbox project strip — compact active-project line under the service cards
 * with restart and projects-modal entry points.
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
import type { DevboxAccepted } from '@/lib/backend/modules/devbox';
import {
  DevboxProjectStrip,
  type DevboxProjectStripProps,
} from '@/components/devbox/DevboxProjectStrip';
import { devboxRouter, devboxCallArgs, pageRoutes, profilesFixture } from './devboxTestKit';

const invokeMock = safeInvoke as jest.Mock;

function renderStrip(props: Partial<DevboxProjectStripProps> = {}) {
  const onAction = jest.fn((_action: Promise<DevboxAccepted>) => undefined);
  const onOpenProjects = jest.fn(() => undefined);
  render(
    <DevboxProjectStrip
      activeProfile={profilesFixture[0]}
      busy={false}
      onAction={onAction as unknown as (action: Promise<DevboxAccepted>) => void}
      onOpenProjects={onOpenProjects}
      {...props}
    />,
  );
  return { onAction, onOpenProjects };
}

beforeEach(() => {
  jest.clearAllMocks();
  invokeMock.mockImplementation(devboxRouter(pageRoutes()));
});

describe('DevboxProjectStrip', () => {
  it('renders the active project name, dir and human mode', () => {
    renderStrip();

    expect(screen.getByTestId('devbox-project-strip')).toBeTruthy();
    expect(screen.getByTestId('devbox-project-strip-name').textContent).toBe('midsai');
    expect(screen.getByTestId('devbox-project-strip-dir').textContent).toBe('d:/work/midsai');
    expect(screen.getByTestId('devbox-project-strip-mode').textContent).toBe('Standard');
  });

  it('restart fires stack_start for the active profile through onAction', async () => {
    const { onAction } = renderStrip();

    fireEvent.click(screen.getByTestId('devbox-project-strip-restart'));
    expect(onAction).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(devboxCallArgs(invokeMock, 'stack_start')).toEqual([
        { name: 'midsai', preview: false },
      ]);
    });
  });

  it('restart is disabled while busy', () => {
    renderStrip({ busy: true });

    expect(screen.getByTestId('devbox-project-strip-restart')).toBeDisabled();
  });

  it('projects button invokes onOpenProjects', () => {
    const { onOpenProjects } = renderStrip();

    fireEvent.click(screen.getByTestId('devbox-project-strip-open'));
    expect(onOpenProjects).toHaveBeenCalledTimes(1);
  });

  it('without an active profile shows the empty line and no restart', () => {
    renderStrip({ activeProfile: null });

    expect(screen.getByTestId('devbox-project-strip-empty').textContent).toBe(
      'No project selected',
    );
    expect(screen.queryByTestId('devbox-project-strip-restart')).toBeNull();
    expect(screen.getByTestId('devbox-project-strip-open')).toBeTruthy();
  });
});
