import { useEffect, useMemo, useState } from 'react';
import { listScenarioRuns, type ScenarioRunItem } from '@/lib/backend/modules/pythonJobs';

export type ReplayRunStatusFilter = 'all' | 'errors';

type UseReplayRecentRunsParams = {
  alias: string | null;
  scenarioPath: string;
  isOpen: boolean;
  limit?: number;
};

export function useReplayRecentRuns({
  alias,
  scenarioPath,
  isOpen,
  limit = 80,
}: UseReplayRecentRunsParams) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState<ScenarioRunItem[]>([]);

  useEffect(() => {
    if (!isOpen || !alias) {
      setRuns([]);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const next = await listScenarioRuns({ alias, limit });
        if (cancelled) return;
        setRuns(next);
      } catch (e) {
        if (!cancelled) {
          setRuns([]);
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [alias, isOpen, limit]);

  const pathKey = scenarioPath.trim();

  const scenarioRuns = useMemo(() => {
    if (!pathKey) return [];
    return runs
      .filter(run => run.scenarioPath === pathKey)
      .sort((a, b) => {
        const aTs = a.startedAt ?? 0;
        const bTs = b.startedAt ?? 0;
        return bTs - aTs;
      });
  }, [pathKey, runs]);

  const lastSuccess = useMemo(() => {
    const successStatuses = new Set(['succeeded', 'done', 'success']);
    return scenarioRuns.find(run => successStatuses.has((run.status || '').toLowerCase())) ?? null;
  }, [scenarioRuns]);

  const lastSuccessOverall = useMemo(() => {
    const successStatuses = new Set(['succeeded', 'done', 'success']);
    return runs.find(run => successStatuses.has((run.status || '').toLowerCase())) ?? null;
  }, [runs]);

  const hasScenarioPath = pathKey.length > 0;

  return {
    loading,
    error,
    hasScenarioPath,
    scenarioRuns,
    lastSuccess,
    lastSuccessOverall,
  };
}

export function isScenarioRunFailure(status: string): boolean {
  const normalized = (status || '').toLowerCase();
  return (
    normalized === 'failed' ||
    normalized === 'error' ||
    normalized === 'cancelled' ||
    normalized === 'timedout'
  );
}
