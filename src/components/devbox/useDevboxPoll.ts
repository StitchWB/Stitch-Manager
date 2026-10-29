import { useCallback, useEffect, useState } from 'react';

export interface DevboxPollState<T> {
  data: T | null;
  error: string | null;
  reload: () => void;
}

export function useDevboxPoll<T>(
  fetcher: () => Promise<T>,
  refreshMs: number,
): DevboxPollState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick(x => x + 1), []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const load = () => {
      fetcher()
        .then(result => {
          if (cancelled) return;
          setData(result);
          setError(null);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setError(err instanceof Error ? err.message : String(err));
        });
    };
    const stop = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
    const start = () => {
      if (refreshMs > 0 && timer === null) timer = setInterval(load, refreshMs);
    };
    const wake = () => {
      if (document.hidden) {
        stop();
        return;
      }
      stop();
      load();
      start();
    };

    if (refreshMs <= 0 || !document.hidden) {
      load();
      start();
    }
    if (refreshMs > 0) {
      document.addEventListener('visibilitychange', wake);
      window.addEventListener('focus', wake);
    }

    return () => {
      cancelled = true;
      stop();
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', wake);
    };
  }, [fetcher, refreshMs, tick]);

  return { data, error, reload };
}
