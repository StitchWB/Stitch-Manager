import type { ComposedFlowNode } from '@/lib/scenarioFlow/types';

export const mkNodeId = () => `node_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

export const createNodeDraft = (
  type: 'runScenario' | 'switchContext',
  nameIndex: number,
  layout?: { x: number; y: number }
): ComposedFlowNode => {
  if (type === 'runScenario') {
    return {
      id: mkNodeId(),
      type: 'runScenario',
      name: `Run scenario #${nameIndex}`,
      scenarioPath: '',
      startUrl: null,
      continueOnError: false,
      bindings: {},
      contextOverride: {},
      layout,
    };
  }

  return {
    id: mkNodeId(),
    type: 'switchContext',
    name: `Switch context #${nameIndex}`,
    context: {},
    layout,
  };
};
