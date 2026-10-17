import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { renderHook, act } from '@testing-library/react';
import { useDevboxPoll } from '@/components/devbox/useDevboxPoll';

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { value: hidden, configurable: true });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
    await Promise.resolve();
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  setHidden(false);
});

afterEach(() => {
  jest.useRealTimers();
  setHidden(false);
});

describe('useDevboxPoll visibility', () => {
  it('does not fetch on mount while hidden', async () => {
    setHidden(true);
    const fetcher = jest.fn(async () => 'payload');
    renderHook(() => useDevboxPoll(fetcher, 4000));

    await flush();
    await advance(12000);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('suspends the interval while hidden and resumes with an immediate fetch on visible', async () => {
    const fetcher = jest.fn(async () => 'payload');
    const { result } = renderHook(() => useDevboxPoll(fetcher, 4000));

    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.current.data).toBe('payload');

    await advance(4000);
    expect(fetcher).toHaveBeenCalledTimes(2);

    setHidden(true);
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await advance(20000);
    expect(fetcher).toHaveBeenCalledTimes(2);

    setHidden(false);
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(3);

    await advance(4000);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('fetches immediately once on window focus and keeps the interval', async () => {
    const fetcher = jest.fn(async () => 'payload');
    renderHook(() => useDevboxPoll(fetcher, 4000));

    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);

    await advance(1000);
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(2);

    await advance(4000);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('ignores focus while hidden', async () => {
    const fetcher = jest.fn(async () => 'payload');
    renderHook(() => useDevboxPoll(fetcher, 4000));
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);

    setHidden(true);
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('still loads once on mount in manual mode (refreshMs=0) regardless of visibility', async () => {
    setHidden(true);
    const fetcher = jest.fn(async () => 'payload');
    renderHook(() => useDevboxPoll(fetcher, 0));

    await flush();
    await advance(60000);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
