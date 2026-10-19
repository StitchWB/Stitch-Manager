import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type Connection,
  type Edge,
  type EdgeMouseHandler,
  type NodeChange,
  type Node,
  type ReactFlowInstance } from
'reactflow';
import { toast } from 'sonner';
import {
  type FlowCanvasEdgeData,
  type FlowCanvasNodeData,
  createNodeDraft,
  useComposerGraphState } from
'../composer';
import type { FlowRouteHistoryEntry } from '../composer/FlowGraphNode';
import type { ComposedFlow } from '@/lib/scenarioFlow/types';

type UpdateFlow = (fn: (prev: ComposedFlow) => ComposedFlow) => void;

type UseFlowNodeEditorParams = {
  flow: ComposedFlow | null;
  updateFlow: UpdateFlow;
  routeHistory: FlowRouteHistoryEntry[];
  completedNodeIds: Set<string>;
  currentNodeId: string | null;
  isRunning: boolean;
  activeRouteEdgeId: string | null;
};

export function useFlowNodeEditor({
  flow,
  updateFlow,
  routeHistory,
  completedNodeIds,
  currentNodeId,
  isRunning,
  activeRouteEdgeId
}: UseFlowNodeEditorParams) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [autoFollowRunningNode, setAutoFollowRunningNode] = useState(false);
  const flowCanvasRef = useRef<HTMLDivElement | null>(null);
  const flowInstanceRef = useRef<ReactFlowInstance<
    Node<FlowCanvasNodeData>,
    Edge<FlowCanvasEdgeData>> |
  null>(null);

  useEffect(() => {
    if (!flow || !selectedNodeId) return;
    const exists = flow.nodes.some((node) => node.id === selectedNodeId);
    if (!exists) {
        queueMicrotask(() => {
      setSelectedNodeId(null);
        });
    }
  }, [flow, selectedNodeId]);

  useEffect(() => {
    if (!flow || !selectedEdgeId) return;
    const edgeExists = flow.nodes.some((node) => {
      const successId = `${node.id}::success`;
      const errorId = `${node.id}::error`;
      return successId === selectedEdgeId || errorId === selectedEdgeId;
    });
    if (!edgeExists) {
        queueMicrotask(() => {
      setSelectedEdgeId(null);
        });
    }
  }, [flow, selectedEdgeId]);

    useEffect(() => {
      if (!flow) {
        queueMicrotask(() => setSelectedNodeId(null));
        return;
      }
      if (flow.nodes.length === 0) {
        queueMicrotask(() => setSelectedNodeId(null));
        return;
      }
      if (!selectedNodeId) return;
      const exists = flow.nodes.some((node) => node.id === selectedNodeId);
      if (!exists) {
        queueMicrotask(() => setSelectedNodeId(null));
      }
    }, [flow, selectedNodeId]);

  const { flowCanvasNodes, flowCanvasEdges, selectedEdgeMeta, edgeTargetOptions } =
  useComposerGraphState({
    flow,
    selectedNodeId,
    selectedEdgeId,
    routeHistory,
    completedNodeIds,
    currentNodeId,
    isRunning,
    activeRouteEdgeId
  });

  useEffect(() => {
    if (!autoFollowRunningNode) return;
    if (!currentNodeId || !isRunning) return;
    if (!flowInstanceRef.current) return;
    const node = flowCanvasNodes.find((item) => item.id === currentNodeId);
    if (!node) return;
    flowInstanceRef.current.setCenter(node.position.x + 120, node.position.y + 60, {
      zoom: 1.05,
      duration: 260
    });
  }, [autoFollowRunningNode, flowCanvasNodes, isRunning, currentNodeId]);

  const selectedNode = useMemo(
    () => flow?.nodes.find((node) => node.id === selectedNodeId) ?? null,
    [flow, selectedNodeId]
  );

  const selectedNodeIndex = useMemo(() => {
    if (!flow || !selectedNode) return -1;
    return flow.nodes.findIndex((node) => node.id === selectedNode.id);
  }, [flow, selectedNode]);

  const onFlowNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const positionChanges = changes.flatMap((change) => {
        if (change.type !== 'position' || !change.position) {
          return [] as Array<{id: string;position: {x: number;y: number;};}>;
        }
        return [
        {
          id: change.id,
          position: {
            x: change.position.x,
            y: change.position.y
          }
        }];

      });
      if (positionChanges.length === 0) return;

      updateFlow((prev) => {
        const nextNodes = prev.nodes.map((node) => {
          const change = positionChanges.find((item) => item.id === node.id);
          if (!change) {
            return node;
          }
          return {
            ...node,
            layout: {
              x: change.position.x,
              y: change.position.y
            }
          };
        });

        return {
          ...prev,
          nodes: nextNodes
        };
      });
    },
    [updateFlow]
  );

  const onFlowConnect = useCallback(
    (connection: Connection) => {
      const sourceId = connection.source;
      const targetId = connection.target;
      const sourceHandle = connection.sourceHandle;

      if (!sourceId || !targetId) return;
      if (sourceId === targetId) {
        toast.error('Self-loop is not supported');
        return;
      }

      updateFlow((prev) => {
        const sourceNode = prev.nodes.find((node) => node.id === sourceId);
        if (!sourceNode) return prev;

        if (sourceHandle === 'error' && sourceNode.type !== 'runScenario') {
          return prev;
        }

        const nextNodes = prev.nodes.map((node) => {
          if (node.id !== sourceId) return node;

          if (sourceHandle === 'error' && node.type === 'runScenario') {
            return {
              ...node,
              errorNextNodeId: targetId
            };
          }

          return {
            ...node,
            nextNodeId: targetId
          };
        });

        return {
          ...prev,
          nodes: nextNodes
        };
      });

      const branch = sourceHandle === 'error' ? 'error' : 'success';
      setSelectedEdgeId(`${sourceId}::${branch}`);
    },
    [updateFlow]
  );

  const onFlowEdgeClick = useCallback<EdgeMouseHandler>((_event, edge) => {
    setSelectedEdgeId(edge.id);
    const sourceId = edge.source;
    if (sourceId) {
      setSelectedNodeId(sourceId);
    }
  }, []);

  const clearSelectedEdgeBranch = useCallback(() => {
    if (!selectedEdgeId) return;
    const [sourceId, branch] = selectedEdgeId.split('::');
    if (!sourceId || !branch) return;

    updateFlow((prev) => {
      const nextNodes = prev.nodes.map((node) => {
        if (node.id !== sourceId) return node;

        if (branch === 'error' && node.type === 'runScenario') {
          return {
            ...node,
            errorNextNodeId: null
          };
        }

        if (branch === 'success') {
          return {
            ...node,
            nextNodeId: null
          };
        }

        return node;
      });

      return {
        ...prev,
        nodes: nextNodes
      };
    });
  }, [selectedEdgeId, updateFlow]);

  const updateSelectedEdgeTarget = useCallback(
    (targetId: string) => {
      if (!selectedEdgeMeta) return;
      const { sourceId, branch } = selectedEdgeMeta;

      updateFlow((prev) => {
        const nextNodes = prev.nodes.map((node) => {
          if (node.id !== sourceId) return node;
          if (branch === 'success') {
            return {
              ...node,
              nextNodeId: targetId || null
            };
          }
          if (node.type === 'runScenario') {
            return {
              ...node,
              errorNextNodeId: targetId || null
            };
          }
          return node;
        });
        return {
          ...prev,
          nodes: nextNodes
        };
      });
    },
    [selectedEdgeMeta, updateFlow]
  );

  const onPaletteDrop = useCallback(
    (type: 'runScenario' | 'switchContext', event: React.MouseEvent<HTMLButtonElement>) => {
      const rect = flowCanvasRef.current?.getBoundingClientRect();
      const center = rect ?
      {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top
      } :
      { x: 120, y: 120 };

      const projected = flowInstanceRef.current ?
      flowInstanceRef.current.screenToFlowPosition(center) :
      center;

      const node = createNodeDraft(type, (flow?.nodes.length ?? 0) + 1, {
        x: projected.x,
        y: projected.y
      });

      updateFlow((prev) => ({
        ...prev,
        nodes: [...prev.nodes, node]
      }));
      setSelectedNodeId(node.id);
    },
    [flow?.nodes.length, updateFlow]
  );

  return {
    selectedNodeId,
    setSelectedNodeId,
    selectedEdgeId,
    setSelectedEdgeId,
    autoFollowRunningNode,
    setAutoFollowRunningNode,
    flowCanvasRef,
    flowInstanceRef,
    flowCanvasNodes,
    flowCanvasEdges,
    selectedEdgeMeta,
    edgeTargetOptions,
    selectedNode,
    selectedNodeIndex,
    onFlowNodesChange,
    onFlowConnect,
    onFlowEdgeClick,
    clearSelectedEdgeBranch,
    updateSelectedEdgeTarget,
    onPaletteDrop
  };
}
