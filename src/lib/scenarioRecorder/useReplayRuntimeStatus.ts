import { useCallback, useEffect, useState } from 'react';
import { checkBrowserRuntimeOnce } from './runtimeCheck';

type UseReplayRuntimeStatusParams = {
  isOpen: boolean;
};

export function useReplayRuntimeStatus({ isOpen }: UseReplayRuntimeStatusParams) {
  const [runtimeInstalled, setRuntimeInstalled] = useState<boolean | null>(null);
  const [runtimeCheckError, setRuntimeCheckError] = useState<string | null>(null);
  const [runtimeChecking, setRuntimeChecking] = useState(false);

  const refreshRuntime = useCallback(async () => {
    setRuntimeChecking(true);
    setRuntimeCheckError(null);
    try {
      const result = await checkBrowserRuntimeOnce();
      setRuntimeInstalled(result.installed);
      setRuntimeCheckError(result.error);
    } catch (error) {
      setRuntimeInstalled(null);
      setRuntimeCheckError(error instanceof Error ? error.message : String(error));
    } finally {
      setRuntimeChecking(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
      queueMicrotask(() => {
    void refreshRuntime();
      });
  }, [isOpen, refreshRuntime]);

  return {
    runtimeInstalled,
    runtimeCheckError,
    runtimeChecking,
    refreshRuntime,
  };
}
