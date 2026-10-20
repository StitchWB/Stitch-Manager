/**
 * runDevboxAction — the single funnel every devbox control action goes
 * through. Locks the contract that a plugin rejection (accepted: false +
 * reason) surfaces as an error toast instead of a silent revert.
 *
 * Mocks: sonner. i18n runs REAL.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';

jest.mock('sonner', () => ({
  toast: { success: jest.fn(), error: jest.fn(), info: jest.fn(), warning: jest.fn() },
}));

import { toast } from 'sonner';
import { runDevboxAction } from '@/components/devbox/runAction';
import type { DevboxAccepted } from '@/lib/backend/modules/devbox';

describe('runDevboxAction rejection surfacing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('toasts the plugin reason when the action is rejected', async () => {
    const rejected = Promise.resolve<DevboxAccepted>({
      accepted: false,
      reason: 'watchdog cannot run while the devbox stack is down',
    });
    const onAccepted = jest.fn(() => undefined);
    const onStale = jest.fn(() => undefined);

    const ok = await runDevboxAction(rejected, onAccepted, onStale);

    expect(ok).toBe(false);
    expect(toast.error).toHaveBeenCalledWith(
      'watchdog cannot run while the devbox stack is down',
    );
    expect(toast.info).not.toHaveBeenCalled();
    expect(onAccepted).not.toHaveBeenCalled();
    expect(onStale).not.toHaveBeenCalled();
  });

  it('toasts a stale permission rejection as info, fires onStale and returns false', async () => {
    const stale = Promise.resolve<DevboxAccepted>({
      accepted: false,
      reason: "no pending permission matches 'p1'",
    });
    const onAccepted = jest.fn(() => undefined);
    const onStale = jest.fn(() => undefined);

    const ok = await runDevboxAction(stale, onAccepted, onStale);

    expect(ok).toBe(false);
    expect(toast.info).toHaveBeenCalledWith(
      'Permission request is no longer pending: the agent withdrew it or the job ended',
    );
    expect(toast.error).not.toHaveBeenCalled();
    expect(onAccepted).not.toHaveBeenCalled();
    expect(onStale).toHaveBeenCalledTimes(1);
  });

  it('falls back to the generic failure message when the reason is empty', async () => {
    const rejected = Promise.resolve<DevboxAccepted>({ accepted: false });

    await runDevboxAction(rejected);

    expect(toast.error).toHaveBeenCalledWith('Action failed');
  });

  it('toasts queued and reloads when the action is accepted', async () => {
    const accepted = Promise.resolve<DevboxAccepted>({
      accepted: true,
      actionId: 'act-1',
    });
    const onAccepted = jest.fn(() => undefined);

    const ok = await runDevboxAction(accepted, onAccepted);

    expect(ok).toBe(true);
    expect(toast.info).toHaveBeenCalledWith('Command accepted into the queue');
    expect(onAccepted).toHaveBeenCalledTimes(1);
  });

  it('toasts the error message when the invoke throws', async () => {
    const failed = Promise.reject(new Error('plugin not running'));

    const ok = await runDevboxAction(failed);

    expect(ok).toBe(false);
    expect(toast.error).toHaveBeenCalledWith('plugin not running');
  });
});
