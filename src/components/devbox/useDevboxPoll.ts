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
    load();
    if (refreshMs <= 0) {
      return () => {
        cancelled = true;
      };
    }
    const timer = setInterval(load, refreshMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [fetcher, refreshMs, tick]);

  return { data, error, reload };
}
