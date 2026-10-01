import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUIState } from '@/hooks/useUIState';
import { toast } from 'sonner';
import {
  deleteComposedFlow,
  startComposedFlowJob,
  upsertComposedFlow } from
'@/lib/backend/modules/pythonJobs';
import { compileComposedFlow } from '@/lib/scenarioFlow/compiler';
import { createEmptyComposedFlow } from '@/lib/scenarioFlow/fixtures';
import { validateComposedFlow } from '@/lib/scenarioFlow/validation';
import {
  cacheFlowForScheduler,
  parseFlowItem } from
'./composer';
import type { ComposedFlow } from '@/lib/scenarioFlow/types';
import { ModalShell } from './composed/ModalShell';
import { useComposedFlowData } from './composed/useComposedFlowData';
import { useComposedFlowJob } from './composed/useComposedFlowJob';
import { useComposedFlowValidation, useFocusValidationIssue } from './composed/ValidationPanel';
import { useFlowNodeEditor } from './composed/NodeEditor';
import { useFlowNodeOperations } from './composed/nodeOperations';
import { useSetupTabState } from './composed/setupTabState';

type ComposedFlowModalProps = {
  alias: string | null;
  isOpen: boolean;
  onClose: () => void;
};

export function ComposedFlowModal({ alias, isOpen, onClose }: ComposedFlowModalProps) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useUIState<'setup' | 'flow' | 'run'>(
    'composed-flow-active-tab',
    'flow',
    'session'
  );
  const [selectedFlowId, setSelectedFlowId] = useState<string>('');
  const [flow, setFlow] = useState<ComposedFlow | null>(null);
  const [saveLoading, setSaveLoading] = useState(false);

  const updateFlow = useCallback((fn: (prev: ComposedFlow) => ComposedFlow) => {
    setFlow((prev) => {
      if (!prev) return prev;
      const next = fn(prev);
      return {
        ...next,
        updatedAt: new Date().toISOString()
      };
    });
  }, []);

  const { scenarios, scenariosLoading, flows, flowsLoading, refresh } =
  useComposedFlowData({ alias, isOpen });

  const { runState, setRunState, runTrace, currentNodeName } = useComposedFlowJob({ flow });

  const { compilePreview, flowValidation, canRunFlow } = useComposedFlowValidation(flow);

  const nodeEditor = useFlowNodeEditor({
    flow,
    updateFlow,
    routeHistory: runTrace.routeHistory,
    completedNodeIds: runTrace.completedNodeIds,
    currentNodeId: runTrace.currentNodeId,
    isRunning: runState.status === 'running',
    activeRouteEdgeId: runTrace.activeRouteEdgeId
  });

  const nodeOps = useFlowNodeOperations({
    updateFlow,
    selectedNodeId: nodeEditor.selectedNodeId,
    selectedNode: nodeEditor.selectedNode,
    selectedEdgeId: nodeEditor.selectedEdgeId,
    setSelectedNodeId: nodeEditor.setSelectedNodeId,
    setSelectedEdgeId: nodeEditor.setSelectedEdgeId,
    flowInstanceRef: nodeEditor.flowInstanceRef
  });

  const setup = useSetupTabState({ isOpen, flow, updateFlow });

  const { setSelectedNodeId, setSelectedEdgeId, setAutoFollowRunningNode } = nodeEditor;
  const { setSelectedSheetId, setSelectedSheetColumn } = setup;

  const activateFlowTab = useCallback(() => setActiveTab('flow'), [setActiveTab]);

  const focusValidationIssue = useFocusValidationIssue({
    flowValidation,
    flowCanvasNodes: nodeEditor.flowCanvasNodes,
    flowInstanceRef: nodeEditor.flowInstanceRef,
    onActivateFlowTab: activateFlowTab,
    setSelectedNodeId: nodeEditor.setSelectedNodeId,
    setSelectedEdgeId: nodeEditor.setSelectedEdgeId
  });

  useEffect(() => {
      if (!isOpen) {
        queueMicrotask(() => {
          setSelectedFlowId('');
          setFlow(null);
          setRunState({ jobId: null, status: 'idle', error: null, lastJobStatus: null });
          setSelectedSheetId('');
          setSelectedSheetColumn('');
          setSelectedNodeId(null);
          setSelectedEdgeId(null);
          setAutoFollowRunningNode(false);
        });
        return;
      }
      if (alias && !flow) {
        queueMicrotask(() => setFlow(createEmptyComposedFlow(alias)));
      }
  }, [alias, flow, isOpen, setAutoFollowRunningNode, setRunState, setSelectedEdgeId, setSelectedNodeId, setSelectedSheetColumn, setSelectedSheetId]);

  useEffect(() => {
    if (!selectedFlowId) return;
    const selected = flows.find((item) => item.id === selectedFlowId);
    if (!selected) return;

    const parsed = parseFlowItem(selected);
    if (!parsed) {
      toast.error('Selected flow JSON is invalid');
      return;
    }

        queueMicrotask(() => {
          setFlow(parsed);
          setRunState({ jobId: null, status: 'idle', error: null, lastJobStatus: null });
          setSelectedNodeId(null);
          setSelectedEdgeId(null);
        });
    }, [flows, selectedFlowId, setRunState, setSelectedEdgeId, setSelectedNodeId]);

  const saveFlow = useCallback(async () => {
    if (!flow || !alias) return;
    if (!flow.name.trim()) {
      toast.error('Flow name is required');
      return;
    }

    setSaveLoading(true);
    try {
      const persisted = await upsertComposedFlow({
        id: flow.id,
        alias,
        name: flow.name,
        flowJson: JSON.stringify(flow)
      });
      cacheFlowForScheduler({
        alias,
        flowId: persisted.id,
        flowJson: JSON.stringify(flow),
        flowName: flow.name
      });
      setSelectedFlowId(persisted.id);
      await refresh();
      toast.success('Flow saved');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save flow');
    } finally {
      setSaveLoading(false);
    }
  }, [alias, flow, refresh]);

  const runFlow = useCallback(async () => {
    if (!flow || !alias) return;
    const validation = validateComposedFlow(flow);
    if (!validation.canRun) {
      toast.error(validation.errors[0]?.message ?? 'Flow has validation errors');
      return;
    }
    const plan = compileComposedFlow(flow);
    if (plan.segments.length === 0) {
      toast.error('Flow has no runnable scenario segments');
      return;
    }

    try {
      const response = await startComposedFlowJob({
        alias,
        planJson: JSON.stringify(plan),
        correlationId:
        typeof globalThis.crypto?.randomUUID === 'function' ?
        globalThis.crypto.randomUUID() :
        String(Date.now())
      });
      setRunState({
        jobId: response.jobId,
        status: 'running',
        error: null,
        lastJobStatus: null
      });
      toast.success('Composed flow started');
      setSelectedFlowId(flow.id);
      const compactFlow = JSON.stringify(flow);
      const compactPlan = JSON.stringify(plan);
      cacheFlowForScheduler({
        alias,
        flowId: flow.id,
        flowJson: compactFlow,
        flowName: flow.name
      });
      const schedulerConfig = {
        mode: 'composed_flow',
        alias,
        flowId: flow.id,
        flow: JSON.parse(compactFlow),
        planJson: compactPlan
      };
      try {
        await navigator.clipboard.writeText(JSON.stringify(schedulerConfig, null, 2));
        toast.success('Scheduler config copied to clipboard');
      } catch {

        // clipboard optional
      }} catch (error) {
      setRunState({
        jobId: null,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
        lastJobStatus: null
      });
      toast.error(error instanceof Error ? error.message : 'Failed to start composed flow');
    }
  }, [alias, flow, setRunState]);

  const createSchedulerTaskFromFlow = useCallback(() => {
    if (!flow || !alias) {
      toast.error('Flow and alias are required');
      return;
    }

    cacheFlowForScheduler({
      alias,
      flowId: flow.id,
      flowJson: JSON.stringify(flow),
      flowName: flow.name
    });

    onClose();
    navigate('/scheduler?prefill=composed');
  }, [alias, flow, navigate, onClose]);

  const removeFlow = useCallback(async () => {
    if (!selectedFlowId) return;
    try {
      await deleteComposedFlow(selectedFlowId);
      setSelectedFlowId('');
      if (alias) {
        setFlow(createEmptyComposedFlow(alias));
      }
      await refresh();
      toast.success('Flow deleted');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete flow');
    }
  }, [alias, refresh, selectedFlowId]);

  return (
    <ModalShell
      alias={alias}
      isOpen={isOpen}
      onClose={onClose}
      flow={flow}
      updateFlow={updateFlow}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      flows={flows}
      flowsLoading={flowsLoading}
      selectedFlowId={selectedFlowId}
      setSelectedFlowId={setSelectedFlowId}
      setFlow={setFlow}
      scenarios={scenarios}
      scenariosLoading={scenariosLoading}
      flowValidation={flowValidation}
      onIssueClick={focusValidationIssue}
      nodeEditor={nodeEditor}
      nodeOps={nodeOps}
      setup={setup}
      runState={runState}
      canRunFlow={canRunFlow}
      compilePreview={compilePreview}
      saveLoading={saveLoading}
      onDeleteFlow={() => void removeFlow()}
      onSaveFlow={() => void saveFlow()}
      onCreateSchedulerTask={createSchedulerTaskFromFlow}
      onRunFlow={() => void runFlow()}
      onRefreshLists={() => void refresh()}
      runTrace={runTrace}
      currentNodeName={currentNodeName} />);

}
