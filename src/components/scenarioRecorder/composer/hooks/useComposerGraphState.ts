import { useMemo } from 'react';
import { MarkerType, type Edge, type Node } from 'reactflow';
import type { ComposedFlow } from '@/lib/scenarioFlow/types';
import {
  FLOW_NODE_TONE,
  type FlowCanvasEdgeData,
  type FlowCanvasNodeData,
  type FlowRouteHistoryEntry,
} from '../FlowGraphNode';

type UseComposerGraphStateParams = {
  flow: ComposedFlow | null;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  routeHistory: FlowRouteHistoryEntry[];
  completedNodeIds: Set<string>;
  currentNodeId?: string | null;
  isRunning?: boolean;
  activeRouteEdgeId?: string | null;
};

export function useComposerGraphState({
  flow,
  selectedNodeId,
  selectedEdgeId,
  routeHistory,
  completedNodeIds,
  currentNodeId,
  isRunning,
  activeRouteEdgeId,
}: UseComposerGraphStateParams) {
  const executedEdgeIds = useMemo(
    () => new Set(routeHistory.map(route => `${route.fromNodeId}::${route.branch}`)),
    [routeHistory]
  );

  const computedActiveEdgeId = useMemo(() => {
    if (!isRunning || routeHistory.length === 0) return null;
    const last = routeHistory[routeHistory.length - 1];
    return `${last.fromNodeId}::${last.branch}`;
  }, [isRunning, routeHistory]);

  const liveEdgeId = activeRouteEdgeId ?? computedActiveEdgeId;

  const flowCanvasNodes = useMemo<Array<Node<FlowCanvasNodeData>>>(() => {
    if (!flow) return [];

    return flow.nodes.map((node, index) => ({
      id: node.id,
      type: 'flowNode',
      position: node.layout ?? {
        x: (index % 4) * 280,
        y: Math.floor(index / 4) * 150,
      },
      draggable: true,
      selectable: true,
      data: {
        id: node.id,
        name: node.name,
        index,
        type: node.type,
        tone: FLOW_NODE_TONE[node.type],
        selected: node.id === selectedNodeId,
        executed: completedNodeIds.has(node.id),
        running: currentNodeId === node.id,
      },
    }));
  }, [completedNodeIds, currentNodeId, flow, selectedNodeId]);

  const flowCanvasEdges = useMemo<Array<Edge<FlowCanvasEdgeData>>>(() => {
    if (!flow || flow.nodes.length === 0) return [];

    const byId = new Map(flow.nodes.map(node => [node.id, node]));

    return flow.nodes.flatMap((node, index) => {
      const fallbackNextId = flow.nodes[index + 1]?.id ?? null;
      const explicitSuccess = node.nextNodeId ?? null;
      const successTarget = explicitSuccess ?? fallbackNextId;
      const hasImplicitSuccess = !explicitSuccess && Boolean(successTarget);

      const edges: Array<Edge<FlowCanvasEdgeData>> = [];

      if (successTarget && byId.has(successTarget)) {
        const edgeId = `${node.id}::success`;
        const executed = executedEdgeIds.has(edgeId);
        edges.push({
          id: edgeId,
          source: node.id,
          sourceHandle: 'success',
          target: successTarget,
          targetHandle: 'in',
          type: 'smoothstep',
          data: {
            branch: 'success',
            implicit: hasImplicitSuccess,
          },
          label: executed
            ? hasImplicitSuccess
              ? 'success ✓ (implicit)'
              : 'success ✓'
            : hasImplicitSuccess
              ? 'success (implicit)'
              : 'success',
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color:
              selectedEdgeId === edgeId
                ? 'rgba(34,211,238,0.95)'
                : executed
                  ? 'rgba(34,197,94,0.95)'
                  : 'rgba(148, 163, 184, 0.9)',
          },
          style: {
            stroke:
              selectedEdgeId === edgeId
                ? 'rgba(34,211,238,0.95)'
                : executed
                  ? 'rgba(34,197,94,0.95)'
                  : 'rgba(148, 163, 184, 0.9)',
            strokeDasharray: hasImplicitSuccess ? '6 4' : undefined,
            strokeWidth: selectedEdgeId === edgeId ? 2.2 : executed ? 2.05 : 1.7,
          },
          labelStyle: {
            fontSize: 10,
            fill: executed
              ? 'rgba(74,222,128,0.95)'
              : hasImplicitSuccess
                ? 'rgba(148,163,184,0.9)'
                : 'rgba(226,232,240,0.92)',
          },
          animated: liveEdgeId === edgeId,
        });
      }

      const errorTarget = node.type === 'runScenario' ? (node.errorNextNodeId ?? null) : null;
      if (errorTarget && byId.has(errorTarget)) {
        const edgeId = `${node.id}::error`;
        const executed = executedEdgeIds.has(edgeId);
        edges.push({
          id: edgeId,
          source: node.id,
          sourceHandle: 'error',
          target: errorTarget,
          targetHandle: 'in',
          type: 'smoothstep',
          data: {
            branch: 'error',
          },
          label: executed ? 'error ✓' : 'error',
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color:
              selectedEdgeId === edgeId
                ? 'rgba(251,113,133,0.98)'
                : executed
                  ? 'rgba(244,63,94,0.98)'
                  : 'rgba(251,113,133,0.85)',
          },
          style: {
            stroke:
              selectedEdgeId === edgeId
                ? 'rgba(251,113,133,0.98)'
                : executed
                  ? 'rgba(244,63,94,0.98)'
                  : 'rgba(251,113,133,0.85)',
            strokeDasharray: '7 4',
            strokeWidth: selectedEdgeId === edgeId ? 2.3 : executed ? 2.1 : 1.8,
          },
          labelStyle: {
            fontSize: 10,
            fill: executed ? 'rgba(253,164,175,0.98)' : 'rgba(251,113,133,0.95)',
          },
          animated: liveEdgeId === edgeId,
        });
      }

      return edges;
    });
  }, [executedEdgeIds, flow, liveEdgeId, selectedEdgeId]);

  const selectedEdgeMeta = useMemo(() => {
    if (!flow || !selectedEdgeId) return null;
    const [sourceId, branch] = selectedEdgeId.split('::');
    if (!sourceId || (branch !== 'success' && branch !== 'error')) return null;
    const sourceNode = flow.nodes.find(node => node.id === sourceId);
    if (!sourceNode) return null;
    const targetId =
      branch === 'success'
        ? (sourceNode.nextNodeId ?? '')
        : sourceNode.type === 'runScenario'
          ? (sourceNode.errorNextNodeId ?? '')
          : '';
    return {
      sourceId,
      branch,
      sourceNode,
      targetId,
    } as const;
  }, [flow, selectedEdgeId]);

  const edgeTargetOptions = useMemo(() => {
    if (!flow || !selectedEdgeMeta) return [{ value: '', label: 'None' }];
    return [
      { value: '', label: 'None' },
      ...flow.nodes
        .filter(node => node.id !== selectedEdgeMeta.sourceId)
        .map(node => ({
          value: node.id,
          label: `${node.name || node.id} • ${node.type}`,
        })),
    ];
  }, [flow, selectedEdgeMeta]);

  return {
    flowCanvasNodes,
    flowCanvasEdges,
    selectedEdgeMeta,
    edgeTargetOptions,
  };
}
