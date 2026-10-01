import { useCallback, useMemo } from 'react';
import {
  type Edge,
  type Node,
  type ReactFlowInstance } from
'reactflow';
import { compileComposedFlow } from '@/lib/scenarioFlow/compiler';
import { validateComposedFlow } from '@/lib/scenarioFlow/validation';
import type { FlowValidationResult } from '@/lib/scenarioFlow/validation';
import type { ComposedFlow } from '@/lib/scenarioFlow/types';
import { FlowValidationBanner } from '../composer';
import type { FlowCanvasEdgeData, FlowCanvasNodeData } from '../composer';

export function useComposedFlowValidation(flow: ComposedFlow | null) {
  const compilePreview = useMemo(() => {
    if (!flow) {
      return null;
    }
    return compileComposedFlow(flow);
  }, [flow]);

  const flowValidation = useMemo(() => flow ? validateComposedFlow(flow) : null, [flow]);

  const canRunFlow = useMemo(
    () =>
    Boolean(
      flow &&
      compilePreview &&
      compilePreview.segments.length > 0 &&
      flowValidation &&
      flowValidation.canRun
    ),
    [compilePreview, flow, flowValidation]
  );

  return { compilePreview, flowValidation, canRunFlow };
}

type UseFocusValidationIssueParams = {
  flowValidation: FlowValidationResult | null;
  flowCanvasNodes: Array<Node<FlowCanvasNodeData>>;
  flowInstanceRef: React.MutableRefObject<ReactFlowInstance<
    Node<FlowCanvasNodeData>,
    Edge<FlowCanvasEdgeData>> |
  null>;
  onActivateFlowTab: () => void;
  setSelectedNodeId: (id: string | null) => void;
  setSelectedEdgeId: (id: string | null) => void;
};

export function useFocusValidationIssue({
  flowValidation,
  flowCanvasNodes,
  flowInstanceRef,
  onActivateFlowTab,
  setSelectedNodeId,
  setSelectedEdgeId
}: UseFocusValidationIssueParams) {
  return useCallback(
    (issueIndex: number) => {
      const issue = flowValidation?.issues[issueIndex];
      if (!issue) return;
      onActivateFlowTab();

      if (issue.nodeId) {
        setSelectedNodeId(issue.nodeId);
        const node = flowCanvasNodes.find((item) => item.id === issue.nodeId);
        if (node && flowInstanceRef.current) {
          flowInstanceRef.current.setCenter(node.position.x + 120, node.position.y + 60, {
            zoom: 1.02,
            duration: 220
          });
        }
      }

      if (issue.targetType === 'edge' && issue.edgeId) {
        setSelectedEdgeId(issue.edgeId);
      } else {
        setSelectedEdgeId(null);
      }
    },
    [flowCanvasNodes, flowValidation, onActivateFlowTab, setSelectedNodeId, setSelectedEdgeId, flowInstanceRef]
  );
}

type ValidationPanelProps = {
  validation: FlowValidationResult | null;
  onIssueClick: (issueIndex: number) => void;
};

export function ValidationPanel({ validation, onIssueClick }: ValidationPanelProps) {
  return validation ?
  <FlowValidationBanner validation={validation} onIssueClick={onIssueClick} /> :
  null;
}
