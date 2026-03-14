import type { ComposedFlowItem } from '@/lib/tauri/modules/pythonJobs';
import type { ComposedFlow } from '@/lib/scenarioFlow/types';

export const parseFlowItem = (item: ComposedFlowItem): ComposedFlow | null => {
  try {
    const parsed = JSON.parse(item.flowJson) as ComposedFlow;
    if (!parsed || typeof parsed !== 'object') return null;
    if (!Array.isArray(parsed.nodes)) return null;
    return {
      ...parsed,
      inputDefaults: parsed.inputDefaults ?? {},
      id: item.id,
      alias: item.alias,
      name: item.name,
    };
  } catch {
    return null;
  }
};
