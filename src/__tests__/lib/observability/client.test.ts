/**
 * Unit tests for lib/observability/client.ts — batching + flush behavior.
 *
 * Mocks safeInvoke (HTTP boundary) to assert batch shape and timing without
 * touching the network. Uses fake timers for the interval/threshold flush.
 *
 * Style follows src/__tests__/lib/backend/modules/apiKeys.test.ts.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

jest.mock('@/lib/backend/core', () => ({
  safeInvoke: jest.fn(),
}));

import { safeInvoke } from '@/lib/backend/core';
import { reportObsEvent, __resetForTests } from '../../../lib/observability/client';
import type { ObsEventInput } from '../../../lib/observability/types';

const safeInvokeMock = jest.mocked(safeInvoke);

function makeEvent(n: number, overrides: Partial<ObsEventInput> = {}): ObsEventInput {
  return {
    level: 'info',
    source: 'frontend',
    subsystem: 'test',
    name: `test.event.${n}`,
    message: `event ${n}`,
    ...overrides,
  };
}

function setHidden(): void {
  Object.defineProperty(document, 'visibilityState', {
    value: 'hidden',
    configurable: true,
  });
}

function setVisible(): void {
  Object.defineProperty(document, 'visibilityState', {
    value: 'visible',
    configurable: true,
  });
}

describe('lib/observability/client', () => {
  beforeEach(() => {
    __resetForTests();
    jest.clearAllMocks();
    jest.useFakeTimers();
    safeInvokeMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    setVisible();
  });

  describe('threshold flush', () => {
    it('flushes a single batch when the queue reaches 20 events', async () => {
      for (let i = 0; i < 20; i++) reportObsEvent(makeEvent(i));

      // The 20th push triggers flush synchronously; settle the send microtask.
      await Promise.resolve();

      expect(safeInvokeMock).toHaveBeenCalledTimes(1);
      expect(safeInvokeMock).toHaveBeenCalledWith(
        'obs_ingest',
        expect.objectContaining({ events: expect.any(Array) })
      );
      const args = safeInvokeMock.mock.calls[0][1] as { events: ObsEventInput[] };
      expect(args.events).toHaveLength(20);
      expect(args.events[0].name).toBe('test.event.0');
      expect(args.events[19].name).toBe('test.event.19');
    });

    it('does not flush before the threshold or interval elapses', () => {
      for (let i = 0; i < 19; i++) reportObsEvent(makeEvent(i));

      expect(safeInvokeMock).not.toHaveBeenCalled();
    });
  });

  describe('interval flush', () => {
    it('flushes after 20s even when below threshold', async () => {
      reportObsEvent(makeEvent(0));
      expect(safeInvokeMock).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(20_000);

      expect(safeInvokeMock).toHaveBeenCalledTimes(1);
      const args = safeInvokeMock.mock.calls[0][1] as { events: ObsEventInput[] };
      expect(args.events).toHaveLength(1);
    });

    it('does not flush before 20s have elapsed', async () => {
      reportObsEvent(makeEvent(0));

      await jest.advanceTimersByTimeAsync(19_999);

      expect(safeInvokeMock).not.toHaveBeenCalled();
    });
  });

  describe('pagehide flush', () => {
    it('flushes on pagehide', async () => {
      for (let i = 0; i < 5; i++) reportObsEvent(makeEvent(i));
      expect(safeInvokeMock).not.toHaveBeenCalled();

      window.dispatchEvent(new Event('pagehide'));
      await Promise.resolve();

      expect(safeInvokeMock).toHaveBeenCalledTimes(1);
      const args = safeInvokeMock.mock.calls[0][1] as { events: ObsEventInput[] };
      expect(args.events).toHaveLength(5);
    });

    it('flushes on visibilitychange→hidden', async () => {
      for (let i = 0; i < 3; i++) reportObsEvent(makeEvent(i));

      setHidden();
      window.dispatchEvent(new Event('visibilitychange'));
      await Promise.resolve();

      expect(safeInvokeMock).toHaveBeenCalledTimes(1);
      const args = safeInvokeMock.mock.calls[0][1] as { events: ObsEventInput[] };
      expect(args.events).toHaveLength(3);
    });

    it('does not flush on visibilitychange→visible', () => {
      for (let i = 0; i < 3; i++) reportObsEvent(makeEvent(i));

      setVisible();
      window.dispatchEvent(new Event('visibilitychange'));

      expect(safeInvokeMock).not.toHaveBeenCalled();
    });

    it('does not double-flush when both pagehide and visibilitychange fire', async () => {
      for (let i = 0; i < 4; i++) reportObsEvent(makeEvent(i));

      setHidden();
      window.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('pagehide'));
      await Promise.resolve();

      expect(safeInvokeMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('failure handling', () => {
    it('re-queues the batch once on failure, then drops on a second failure', async () => {
      safeInvokeMock.mockRejectedValue(new Error('backend down'));

      for (let i = 0; i < 5; i++) reportObsEvent(makeEvent(i));

      // First interval flush: fails, re-queues all 5 (each gets one retry).
      await jest.advanceTimersByTimeAsync(20_000);
      expect(safeInvokeMock).toHaveBeenCalledTimes(1);
      expect(safeInvokeMock.mock.calls[0][1]).toMatchObject({
        events: expect.arrayContaining([expect.objectContaining({ name: 'test.event.0' })]),
      });

      // Second interval flush: fails again, drops (already retried once).
      await jest.advanceTimersByTimeAsync(20_000);
      expect(safeInvokeMock).toHaveBeenCalledTimes(2);

      // A brand-new event still flushes normally after the backend recovers.
      safeInvokeMock.mockResolvedValue(undefined);
      reportObsEvent(makeEvent(99));
      await jest.advanceTimersByTimeAsync(20_000);

      expect(safeInvokeMock).toHaveBeenCalledTimes(3);
      const args = safeInvokeMock.mock.calls[2][1] as { events: ObsEventInput[] };
      expect(args.events).toHaveLength(1);
      expect(args.events[0].name).toBe('test.event.99');
    });
  });

  describe('queue cap', () => {
    it('caps the queue at 200 (dropping oldest) while a flush is in flight', async () => {
      // Hold the first flush open so subsequent events accumulate in the queue.
      let resolveFirst: () => void = () => {};
      safeInvokeMock.mockImplementation(
        () => new Promise<void>(res => { resolveFirst = res; })
      );

      // 20 events → threshold flush drains them; safeInvoke stays pending (inFlight).
      for (let i = 0; i < 20; i++) reportObsEvent(makeEvent(i));
      expect(safeInvokeMock).toHaveBeenCalledTimes(1);

      // Push 230 more while in flight; queue should cap at 200 (oldest dropped).
      for (let i = 20; i < 250; i++) reportObsEvent(makeEvent(i));

      // Release the pending flush → finally triggers a second flush (queue ≥ threshold).
      resolveFirst();
      safeInvokeMock.mockResolvedValue(undefined);
      await jest.runAllTimersAsync();

      expect(safeInvokeMock).toHaveBeenCalledTimes(2);
      const args = safeInvokeMock.mock.calls[1][1] as { events: ObsEventInput[] };
      expect(args.events).toHaveLength(200);
    });
  });

  describe('forwarded events', () => {
    it('skips forwarded events and never sends them', async () => {
      reportObsEvent(makeEvent(0, { origin: 'forwarded' }));
      reportObsEvent(makeEvent(1, { source: 'rust-forwarded' }));

      await jest.advanceTimersByTimeAsync(20_000);

      // All drained events were forwarded → batch empty → no call.
      expect(safeInvokeMock).not.toHaveBeenCalled();
    });
  });
});
