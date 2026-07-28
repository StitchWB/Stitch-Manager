import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  listScenarioRevisions,
  rollbackRecordedScenario,
  type ScenarioRecordItem,
  type ScenarioRevisionItem,
} from '@/lib/backend/modules/pythonJobs';

type ScenarioRevisionSnapshot = {
  scenarioPath?: string;
  startedUrl?: string | null;
  metadata?: {
    lastRunAt?: number | null;
    [key: string]: unknown;
  } | null;
};

type UseReplayVersioningParams = {
  scenario: ScenarioRecordItem | null;
  isOpen: boolean;
};

export function useReplayVersioning({ scenario, isOpen }: UseReplayVersioningParams) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revisions, setRevisions] = useState<ScenarioRevisionItem[]>([]);
  const [rollbackLoading, setRollbackLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || !scenario?.id) {
      setRevisions([]);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const rows = await listScenarioRevisions({ scenarioId: scenario.id, limit: 50 });
        if (!cancelled) setRevisions(rows);
      } catch (e) {
        if (!cancelled) {
          setRevisions([]);
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
  }, [isOpen, scenario?.id]);

  const versions = useMemo(() => {
    const active = scenario?.activeVersion;
    return revisions.map(row => ({
      ...row,
      isActive: active != null && row.versionNo === active,
    }));
  }, [revisions, scenario?.activeVersion]);

  const selectVersion = useCallback(
    (versionNo: number) => {
      const row = revisions.find(item => item.versionNo === versionNo);
      if (!row) return null;
      try {
        const snapshot = JSON.parse(row.snapshotJson) as ScenarioRevisionSnapshot;
        return {
          versionNo,
          scenarioPath: snapshot.scenarioPath?.trim() || null,
          startedUrl: snapshot.startedUrl?.trim() || null,
        };
      } catch {
        return {
          versionNo,
          scenarioPath: null,
          startedUrl: null,
        };
      }
    },
    [revisions]
  );

  const rollback = useCallback(
    async (versionNo: number): Promise<ScenarioRecordItem | null> => {
      if (!scenario?.id) return null;
      setRollbackLoading(true);
      try {
        const updated = await rollbackRecordedScenario({ scenarioId: scenario.id, versionNo });
        return updated;
      } finally {
        setRollbackLoading(false);
      }
    },
    [scenario?.id]
  );

  return {
    loading,
    error,
    versions,
    selectVersion,
    rollback,
    rollbackLoading,
  };
}
