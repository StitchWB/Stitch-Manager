import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  type ComposedFlowItem,
  listComposedFlows,
  listRecordedScenarios } from
'@/lib/backend/modules/pythonJobs';

export type ComposedFlowScenarioOption = {id: string;name: string;scenarioPath: string;};

export function useComposedFlowData({ alias, isOpen }: { alias: string | null; isOpen: boolean }) {
  const [scenariosLoading, setScenariosLoading] = useState(false);
  const [scenarios, setScenarios] = useState<ComposedFlowScenarioOption[]>([]);
  const [flowsLoading, setFlowsLoading] = useState(false);
  const [flows, setFlows] = useState<ComposedFlowItem[]>([]);

  const refresh = useCallback(async () => {
    if (!alias) return;

    setScenariosLoading(true);
    setFlowsLoading(true);
    try {
      const [scenarioItems, flowItems] = await Promise.all([
      listRecordedScenarios({ alias, limit: 100 }),
      listComposedFlows({ alias, limit: 100 })]
      );

      setScenarios(
        scenarioItems.map((item) => ({
          id: item.id,
          name: item.name,
          scenarioPath: item.scenarioPath
        }))
      );
      setFlows(flowItems);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load composed flow data');
    } finally {
      setScenariosLoading(false);
      setFlowsLoading(false);
    }
  }, [alias]);

  useEffect(() => {
    if (!isOpen || !alias) return;
      queueMicrotask(() => {
    void refresh();
      });
  }, [alias, isOpen, refresh]);

  return { scenarios, scenariosLoading, flows, flowsLoading, refresh };
}
