import { useCallback } from 'react';
import {
  type Edge,
  type Node,
  type ReactFlowInstance } from
'reactflow';
import { mkNodeId, createNodeDraft } from '../composer';
import type { FlowCanvasEdgeData, FlowCanvasNodeData } from '../composer';
import type {
  ComposedFlow,
  ComposedFlowNode,
  FlowRunScenarioNode,
  FlowSwitchContextNode } from
'@/lib/scenarioFlow/types';

type UpdateFlow = (fn: (prev: ComposedFlow) => ComposedFlow) => void;

type UseFlowNodeOperationsParams = {
  updateFlow: UpdateFlow;
  selectedNodeId: string | null;
  selectedNode: ComposedFlowNode | null;
  selectedEdgeId: string | null;
  setSelectedNodeId: (id: string | null) => void;
  setSelectedEdgeId: (id: string | null) => void;
  flowInstanceRef: React.MutableRefObject<ReactFlowInstance<
    Node<FlowCanvasNodeData>,
    Edge<FlowCanvasEdgeData>> |
  null>;
};

export function useFlowNodeOperations({
  updateFlow,
  selectedNodeId,
  selectedNode,
  selectedEdgeId,
  setSelectedNodeId,
  setSelectedEdgeId,
  flowInstanceRef
}: UseFlowNodeOperationsParams) {
  const updateNode = useCallback(
    (nodeId: string, updater: (node: ComposedFlowNode) => ComposedFlowNode) => {
      updateFlow((prev) => ({
        ...prev,
        nodes: prev.nodes.map((node) => node.id === nodeId ? updater(node) : node)
      }));
    },
    [updateFlow]
  );

  const addRunNode = useCallback(() => {
    const nodeId = mkNodeId();
    updateFlow((prev) => {
      const node: FlowRunScenarioNode = {
        id: nodeId,
        type: 'runScenario',
        name: `Run scenario #${prev.nodes.length + 1}`,
        scenarioPath: '',
        startUrl: null,
        continueOnError: false,
        bindings: {},
        contextOverride: {}
      };
      return {
        ...prev,
        nodes: [...prev.nodes, node]
      };
    });
    setSelectedNodeId(nodeId);
  }, [setSelectedNodeId, updateFlow]);

  const addSwitchNode = useCallback(() => {
    const nodeId = mkNodeId();
    updateFlow((prev) => {
      const node: FlowSwitchContextNode = {
        id: nodeId,
        type: 'switchContext',
        name: `Switch context #${prev.nodes.length + 1}`,
        context: {}
      };
      return {
        ...prev,
        nodes: [...prev.nodes, node]
      };
    });
    setSelectedNodeId(nodeId);
  }, [setSelectedNodeId, updateFlow]);

  const removeNode = useCallback(
    (nodeId: string) => {
      updateFlow((prev) => {
        const nextNodes = prev.nodes.
        filter((node) => node.id !== nodeId).
        map((node) => {
          const patched: ComposedFlowNode = {
            ...node,
            nextNodeId: node.nextNodeId === nodeId ? null : node.nextNodeId
          };

          if (patched.type === 'runScenario') {
            patched.errorNextNodeId =
            patched.errorNextNodeId === nodeId ? null : patched.errorNextNodeId;
          }

          return patched;
        });

        return {
          ...prev,
          nodes: nextNodes
        };
      });
      if (selectedNodeId === nodeId) {
        setSelectedNodeId(null);
      }
      if (selectedEdgeId?.startsWith(`${nodeId}::`)) {
        setSelectedEdgeId(null);
      }
    },
    [selectedEdgeId, selectedNodeId, setSelectedEdgeId, setSelectedNodeId, updateFlow]
  );

  const moveSelectedNode = useCallback(
    (direction: 'up' | 'down') => {
      if (!selectedNodeId) return;
      updateFlow((prev) => {
        const currentIndex = prev.nodes.findIndex((node) => node.id === selectedNodeId);
        if (currentIndex < 0) return prev;

        const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
        if (targetIndex < 0 || targetIndex >= prev.nodes.length) return prev;

        const nextNodes = [...prev.nodes];
        const [node] = nextNodes.splice(currentIndex, 1);
        nextNodes.splice(targetIndex, 0, node);
        return {
          ...prev,
          nodes: nextNodes
        };
      });
    },
    [selectedNodeId, updateFlow]
  );

  const addNodeAfter = useCallback(
    (afterNodeId: string | null, type: 'runScenario' | 'switchContext') => {
      let createdNodeId = '';
      updateFlow((prev) => {
        const nextNodes = [...prev.nodes];
        const insertIndex =
        afterNodeId == null ?
        nextNodes.length :
        Math.max(0, nextNodes.findIndex((node) => node.id === afterNodeId) + 1);

        const newNode = createNodeDraft(type, prev.nodes.length + 1);
        createdNodeId = newNode.id;

        nextNodes.splice(insertIndex, 0, newNode);
        return {
          ...prev,
          nodes: nextNodes
        };
      });
      if (createdNodeId) {
        setSelectedNodeId(createdNodeId);
      }
      return createdNodeId;
    },
    [setSelectedNodeId, updateFlow]
  );

  const duplicateSelectedNode = useCallback(() => {
    if (!selectedNode) return;
    const cloneId = mkNodeId();
    updateFlow((prev) => {
      const index = prev.nodes.findIndex((node) => node.id === selectedNode.id);
      if (index < 0) return prev;
      const source = prev.nodes[index];
      const clone: ComposedFlowNode = {
        ...source,
        id: cloneId,
        name: `${source.name || source.id} copy`
      };
      const nextNodes = [...prev.nodes];
      nextNodes.splice(index + 1, 0, clone);
      return {
        ...prev,
        nodes: nextNodes
      };
    });
    setSelectedNodeId(cloneId);
  }, [selectedNode, setSelectedNodeId, updateFlow]);

  const setStartNode = useCallback(
    (nodeId: string) => {
      updateFlow((prev) => {
        const index = prev.nodes.findIndex((node) => node.id === nodeId);
        if (index <= 0) return prev;
        const nextNodes = [...prev.nodes];
        const [node] = nextNodes.splice(index, 1);
        nextNodes.unshift(node);
        return {
          ...prev,
          nodes: nextNodes
        };
      });
    },
    [updateFlow]
  );

  const arrangeNodes = useCallback(() => {
    updateFlow((prev) => ({
      ...prev,
      nodes: prev.nodes.map((node, index) => ({
        ...node,
        layout: {
          x: 40 + index % 4 * 320,
          y: 60 + Math.floor(index / 4) * 180
        }
      }))
    }));
    flowInstanceRef.current?.fitView({ padding: 0.22, duration: 280 });
  }, [flowInstanceRef, updateFlow]);

  const createStarterTemplate = useCallback(() => {
    updateFlow((prev) => {
      const authId = mkNodeId();
      const actionId = mkNodeId();
      const verifyId = mkNodeId();
      const baseX = 0;
      return {
        ...prev,
        nodes: [
        {
          id: authId,
          type: 'runScenario',
          name: 'Auth step',
          scenarioPath: '',
          startUrl: null,
          continueOnError: false,
          nextNodeId: actionId,
          bindings: {},
          contextOverride: {},
          layout: { x: baseX, y: 40 }
        },
        {
          id: actionId,
          type: 'runScenario',
          name: 'Action step',
          scenarioPath: '',
          startUrl: null,
          continueOnError: false,
          nextNodeId: verifyId,
          bindings: {},
          contextOverride: {},
          layout: { x: baseX + 300, y: 40 }
        },
        {
          id: verifyId,
          type: 'runScenario',
          name: 'Verify step',
          scenarioPath: '',
          startUrl: null,
          continueOnError: false,
          bindings: {},
          contextOverride: {},
          layout: { x: baseX + 600, y: 40 }
        }]

      };
    });
  }, [updateFlow]);

  return {
    updateNode,
    addRunNode,
    addSwitchNode,
    removeNode,
    moveSelectedNode,
    addNodeAfter,
    duplicateSelectedNode,
    setStartNode,
    arrangeNodes,
    createStarterTemplate
  };
}
