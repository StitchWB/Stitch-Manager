import { t } from "@/lib/i18n";import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUIState } from '@/hooks/useUIState';
import { Modal, Input, Select } from '@/components/ui';
import { toast } from 'sonner';
import {
  type Connection,
  type Edge,
  type EdgeMouseHandler,
  type NodeChange,
  type Node,
  type ReactFlowInstance } from
'reactflow';
import 'reactflow/dist/style.css';
import {
  type ComposedFlowItem,
  type PythonJobStatus,
  deleteComposedFlow,
  getPythonJobStatus,
  listComposedFlows,
  listRecordedScenarios,
  markComposedFlowRan,
  startComposedFlowJob,
  upsertComposedFlow } from
'@/lib/tauri/modules/pythonJobs';
import { useGoogleSheetsDataset } from '@/hooks/useGoogleSheetsDataset';
import { useRegistrationStore } from '@/stores/registration';
import { compileComposedFlow } from '@/lib/scenarioFlow/compiler';
import { createEmptyComposedFlow } from '@/lib/scenarioFlow/fixtures';
import { validateComposedFlow } from '@/lib/scenarioFlow/validation';
import { formatProfileAliasOptionLabel } from '@/lib/profiles/displayName';
import {
  type FlowCanvasEdgeData,
  type FlowCanvasNodeData,
  createNodeDraft,
  cacheFlowForScheduler,
  parseFlowItem,
  FlowValidationBanner,
  FlowTabHeader,
  mkNodeId,
  ComposerFooter,
  ComposerSetupTab,
  ComposerRunTab,
  ComposerFlowTab,
  ComposerNodeEditor,
  useComposerRunTrace,
  useComposerGraphState } from
'./composer';
import type {
  ComposedFlow,
  ComposedFlowNode,
  FlowRunScenarioNode,
  FlowSwitchContextNode } from
'@/lib/scenarioFlow/types';

type ComposedFlowModalProps = {
  alias: string | null;
  isOpen: boolean;
  onClose: () => void;
};

type JobRunState = {
  jobId: string | null;
  status: 'idle' | 'running' | 'done' | 'error';
  error: string | null;
  lastJobStatus: PythonJobStatus | null;
};

// moved to ./composer/* modules

export function ComposedFlowModal({ alias, isOpen, onClose }: ComposedFlowModalProps) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useUIState<'setup' | 'flow' | 'run'>(
    'composed-flow-active-tab',
    'flow',
    'session'
  );
  const [scenariosLoading, setScenariosLoading] = useState(false);
  const [scenarios, setScenarios] = useState<
    Array<{id: string;name: string;scenarioPath: string;}>>(
    []);

  const [flowsLoading, setFlowsLoading] = useState(false);
  const [flows, setFlows] = useState<ComposedFlowItem[]>([]);
  const [selectedFlowId, setSelectedFlowId] = useState<string>('');
  const [flow, setFlow] = useState<ComposedFlow | null>(null);

  const [saveLoading, setSaveLoading] = useState(false);
  const [runState, setRunState] = useState<JobRunState>({
    jobId: null,
    status: 'idle',
    error: null,
    lastJobStatus: null
  });

  const registrationConfig = useRegistrationStore((state) => state.config);
  const sheetsParams = useMemo(() => {
    const spreadsheetId = registrationConfig.advanced.googleSheetsSpreadsheetId?.trim();
    const serviceAccountJson = registrationConfig.advanced.googleSheetsServiceAccountJson?.trim();
    if (!spreadsheetId || !serviceAccountJson) return null;
    return { spreadsheetId, serviceAccountJson };
  }, [
  registrationConfig.advanced.googleSheetsServiceAccountJson,
  registrationConfig.advanced.googleSheetsSpreadsheetId]
  );
  const {
    dataset: sheetsDataset,
    isLoading: sheetsLoading,
    error: sheetsError,
    refresh: refreshSheets
  } = useGoogleSheetsDataset({
    autoFetch: Boolean(isOpen && sheetsParams),
    params: sheetsParams
  });
  const [selectedSheetId, setSelectedSheetId] = useState<string>('');
  const [selectedSheetColumn, setSelectedSheetColumn] = useState<string>('');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [autoFollowRunningNode, setAutoFollowRunningNode] = useState(false);
  const flowCanvasRef = useRef<HTMLDivElement | null>(null);
  const flowInstanceRef = useRef<ReactFlowInstance<
    Node<FlowCanvasNodeData>,
    Edge<FlowCanvasEdgeData>> |
  null>(null);

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
    void refresh();
  }, [alias, isOpen, refresh]);

  useEffect(() => {
    if (!isOpen) {
      setSelectedFlowId('');
      setFlow(null);
      setRunState({ jobId: null, status: 'idle', error: null, lastJobStatus: null });
      setSelectedSheetId('');
      setSelectedSheetColumn('');
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
      setAutoFollowRunningNode(false);
      return;
    }
    if (alias && !flow) {
      setFlow(createEmptyComposedFlow(alias));
    }
  }, [alias, flow, isOpen]);

  useEffect(() => {
    if (!selectedFlowId) return;
    const selected = flows.find((item) => item.id === selectedFlowId);
    if (!selected) return;

    const parsed = parseFlowItem(selected);
    if (!parsed) {
      toast.error('Selected flow JSON is invalid');
      return;
    }

    setFlow(parsed);
    setRunState({ jobId: null, status: 'idle', error: null, lastJobStatus: null });
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
  }, [flows, selectedFlowId]);

  useEffect(() => {
    if (!flow || !selectedNodeId) return;
    const exists = flow.nodes.some((node) => node.id === selectedNodeId);
    if (!exists) {
      setSelectedNodeId(null);
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
      setSelectedEdgeId(null);
    }
  }, [flow, selectedEdgeId]);

  const runTrace = useComposerRunTrace(runState.lastJobStatus);

  const currentNodeName = useMemo(() => {
    if (!flow || !runTrace.currentNodeId) return null;
    return flow.nodes.find((node) => node.id === runTrace.currentNodeId)?.name ?? null;
  }, [flow, runTrace.currentNodeId]);

  useEffect(() => {
    const jobId = runState.jobId;
    if (!jobId || runState.status !== 'running') return;

    let cancelled = false;
    const timer = window.setInterval(() => {
      void (async () => {
        if (cancelled) return;
        const status = await getPythonJobStatus(jobId);
        if (!status) return;

        if (status.state === 'succeeded') {
          setRunState({
            jobId: null,
            status: 'done',
            error: null,
            lastJobStatus: status
          });
          if (flow?.id) {
            void markComposedFlowRan(flow.id).catch(() => {});
          }
          toast.success('Composed flow finished');
          return;
        }

        if (
        status.state === 'failed' ||
        status.state === 'cancelled' ||
        status.state === 'timedout')
        {
          setRunState({
            jobId: null,
            status: 'error',
            error: status.error ?? `Job ${status.state}`,
            lastJobStatus: status
          });
          toast.error(status.error ?? `Composed flow failed: ${status.state}`);
          return;
        }

        setRunState((prev) => ({ ...prev, lastJobStatus: status }));
      })();
    }, 1200);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [flow?.id, runState.jobId, runState.status]);

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

  useEffect(() => {
    if (!flow) {
      setSelectedNodeId(null);
      return;
    }
    if (flow.nodes.length === 0) {
      setSelectedNodeId(null);
      return;
    }
    if (!selectedNodeId) return;
    const exists = flow.nodes.some((node) => node.id === selectedNodeId);
    if (!exists) {
      setSelectedNodeId(null);
    }
  }, [flow, selectedNodeId]);

  const { flowCanvasNodes, flowCanvasEdges, selectedEdgeMeta, edgeTargetOptions } =
  useComposerGraphState({
    flow,
    selectedNodeId,
    selectedEdgeId,
    routeHistory: runTrace.routeHistory,
    completedNodeIds: runTrace.completedNodeIds,
    currentNodeId: runTrace.currentNodeId,
    isRunning: runState.status === 'running',
    activeRouteEdgeId: runTrace.activeRouteEdgeId
  });

  const focusValidationIssue = useCallback(
    (issueIndex: number) => {
      const issue = flowValidation?.issues[issueIndex];
      if (!issue) return;
      setActiveTab('flow');

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
    [flowCanvasNodes, flowValidation, setActiveTab]
  );

  useEffect(() => {
    if (!autoFollowRunningNode) return;
    if (!runTrace.currentNodeId || runState.status !== 'running') return;
    if (!flowInstanceRef.current) return;
    const node = flowCanvasNodes.find((item) => item.id === runTrace.currentNodeId);
    if (!node) return;
    flowInstanceRef.current.setCenter(node.position.x + 120, node.position.y + 60, {
      zoom: 1.05,
      duration: 260
    });
  }, [autoFollowRunningNode, flowCanvasNodes, runState.status, runTrace.currentNodeId]);

  const flowOptions = useMemo(
    () => [
    { value: '', label: 'New flow' },
    ...flows.map((item) => ({
      value: item.id,
      label: `${item.name} • ${formatProfileAliasOptionLabel(item.alias)} (${item.runCount} runs)`
    }))],

    [flows]
  );

  const scenarioOptions = useMemo(
    () => [
    { value: '', label: 'Select scenario...' },
    ...scenarios.map((item) => ({
      value: item.scenarioPath,
      label: `${item.name} • ${item.scenarioPath}`
    }))],

    [scenarios]
  );

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

  const sheetOptions = useMemo(
    () => [
    { value: '', label: sheetsLoading ? 'Loading sheets...' : 'Select sheet' },
    ...(sheetsDataset?.sheets ?? []).map((sheet) => ({
      value: sheet.id,
      label: `${sheet.name} (${sheet.rowCount ?? sheet.rows.length})`
    }))],

    [sheetsDataset?.sheets, sheetsLoading]
  );

  const sheetColumnOptions = useMemo(() => {
    const sheet = (sheetsDataset?.sheets ?? []).find((item) => item.id === selectedSheetId);
    const columns = sheet?.columns ?? [];
    return [
    { value: '', label: 'Select column' },
    ...columns.map((col) => ({ value: col, label: col }))];

  }, [selectedSheetId, sheetsDataset?.sheets]);

  const inputDefaultEntries = useMemo(() => Object.entries(flow?.inputDefaults ?? {}), [flow]);

  const importEmailsFromSheet = useCallback(() => {
    const sheet = (sheetsDataset?.sheets ?? []).find((item) => item.id === selectedSheetId);
    if (!sheet) {
      toast.error('Select a sheet first');
      return;
    }
    if (!selectedSheetColumn) {
      toast.error('Select a column first');
      return;
    }

    const values = sheet.rows.
    map((row) => {
      const value = row[selectedSheetColumn];
      if (typeof value === 'string') return value.trim();
      if (typeof value === 'number') return String(value);
      return '';
    }).
    filter(Boolean).
    filter((value) => value.includes('@'));

    if (values.length === 0) {
      toast.error('No email-like values found in selected column');
      return;
    }

    updateFlow((prev) => {
      const rest = prev.dataLists.filter((d) => d.id !== 'emails_pool');
      return {
        ...prev,
        dataLists: [
        {
          id: 'emails_pool',
          values,
          strategy: 'next'
        },
        ...rest]

      };
    });
    toast.success(`Imported ${values.length} emails from Google Sheets`);
  }, [selectedSheetColumn, selectedSheetId, sheetsDataset?.sheets, updateFlow]);

  const exportCompiledPlan = useCallback(() => {
    if (!flow) {
      toast.error('Nothing to export');
      return;
    }
    const plan = compileComposedFlow(flow);
    const blob = new Blob([JSON.stringify(plan, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = (flow.name || 'composed_flow').replace(/[^a-zA-Z0-9_-]+/g, '_');
    a.download = `${safeName}_compiled_plan.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [flow]);

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
  }, [updateFlow]);

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
  }, [updateFlow]);

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
    [selectedEdgeId, selectedNodeId, updateFlow]
  );

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
  }, [alias, flow]);

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

  const selectedNode = useMemo(
    () => flow?.nodes.find((node) => node.id === selectedNodeId) ?? null,
    [flow, selectedNodeId]
  );

  const selectedNodeIndex = useMemo(() => {
    if (!flow || !selectedNode) return -1;
    return flow.nodes.findIndex((node) => node.id === selectedNode.id);
  }, [flow, selectedNode]);

  // selectedEdgeMeta + edgeTargetOptions moved to useComposerGraphState

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
    [updateFlow]
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
  }, [selectedNode, updateFlow]);

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
  }, [updateFlow]);

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

  const addInputDefault = useCallback(() => {
    updateFlow((prev) => {
      const existingKeys = new Set(Object.keys(prev.inputDefaults ?? {}));
      let idx = 1;
      let key = `input_${idx}`;
      while (existingKeys.has(key)) {
        idx += 1;
        key = `input_${idx}`;
      }
      return {
        ...prev,
        inputDefaults: {
          ...(prev.inputDefaults ?? {}),
          [key]: ''
        }
      };
    });
  }, [updateFlow]);

  const updateInputDefault = useCallback(
    (oldKey: string, newKey: string, value: string) => {
      const trimmedKey = newKey.trim();
      updateFlow((prev) => {
        const next = { ...(prev.inputDefaults ?? {}) };
        delete next[oldKey];
        if (trimmedKey) {
          next[trimmedKey] = value;
        }
        return {
          ...prev,
          inputDefaults: next
        };
      });
    },
    [updateFlow]
  );

  const removeInputDefault = useCallback(
    (key: string) => {
      updateFlow((prev) => {
        const next = { ...(prev.inputDefaults ?? {}) };
        delete next[key];
        return {
          ...prev,
          inputDefaults: next
        };
      });
    },
    [updateFlow]
  );

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

  // Node editor UI moved to ComposerNodeEditor

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Scenario Flow Composer"
      size="xl"
      footer={
      <ComposerFooter
        runState={runState}
        canRunFlow={canRunFlow}
        segmentCount={compilePreview?.segments.length ?? 0}
        selectedFlowId={selectedFlowId}
        saveLoading={saveLoading}
        onClose={onClose}
        onDelete={() => void removeFlow()}
        onSave={() => void saveFlow()}
        onCreateSchedulerTask={createSchedulerTaskFromFlow}
        onRun={() => void runFlow()} />

      }>

      {!alias ?
      <div className="text-sm text-slate-400">{t("recorder.composed_flow_modal.select_profile_alias_first")}</div> :
      !flow ?
      <div className="text-sm text-slate-400">{t("recorder.composed_flow_modal.loading")}</div> :

      <div className="space-y-4">
          <FlowTabHeader activeTab={activeTab} onChange={setActiveTab} />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Select
            label={flowsLoading ? 'Saved flows (loading...)' : 'Saved flows'}
            value={selectedFlowId}
            options={flowOptions}
            onValueChange={(value) => {
              if (!value) {
                setSelectedFlowId('');
                setFlow(createEmptyComposedFlow(alias));
                return;
              }
              setSelectedFlowId(value);
            }} />

            <Input
            label="Flow name"
            value={flow.name}
            onChange={(e) => updateFlow((prev) => ({ ...prev, name: e.target.value }))}
            className="h-9" />

          </div>

          {flowValidation ?
        <FlowValidationBanner validation={flowValidation} onIssueClick={focusValidationIssue} /> :
        null}

          {activeTab === 'setup' ?
        <ComposerSetupTab
          flow={flow}
          inputDefaultEntries={inputDefaultEntries}
          addInputDefault={addInputDefault}
          updateInputDefault={updateInputDefault}
          removeInputDefault={removeInputDefault}
          updateFlow={updateFlow}
          sheetsParams={sheetsParams}
          sheetsError={sheetsError}
          selectedSheetId={selectedSheetId}
          selectedSheetColumn={selectedSheetColumn}
          sheetOptions={sheetOptions}
          sheetColumnOptions={sheetColumnOptions}
          setSelectedSheetId={setSelectedSheetId}
          setSelectedSheetColumn={setSelectedSheetColumn}
          refreshSheets={refreshSheets}
          importEmailsFromSheet={importEmailsFromSheet} /> :

        null}

          {activeTab === 'flow' ?
        <ComposerFlowTab
          flowNodesCount={flow.nodes.length}
          scenariosLoading={scenariosLoading}
          selectedNodeId={selectedNodeId}
          selectedNodeIndex={selectedNodeIndex}
          selectedNodeType={selectedNode?.type ?? null}
          selectedEdgeId={selectedEdgeId}
          selectedEdgeMeta={selectedEdgeMeta}
          edgeTargetOptions={edgeTargetOptions}
          flowCanvasNodes={flowCanvasNodes}
          flowCanvasEdges={flowCanvasEdges}
          flowCanvasRef={flowCanvasRef}
          flowInstanceRef={flowInstanceRef}
          onPaletteDrop={onPaletteDrop}
          onAddRunNode={() => addRunNode()}
          onAddSwitchNode={() => addSwitchNode()}
          onAddNextRunNode={() => addNodeAfter(selectedNodeId ?? null, 'runScenario')}
          onAddNextSwitchNode={() => addNodeAfter(selectedNodeId ?? null, 'switchContext')}
          onDuplicateSelected={duplicateSelectedNode}
          onArrange={arrangeNodes}
          onRefreshLists={() => void refresh()}
          onExportCompiledPlan={exportCompiledPlan}
          onNodesChange={onFlowNodesChange}
          onConnect={onFlowConnect}
          onEdgeClick={onFlowEdgeClick}
          onPaneClick={() => setSelectedEdgeId(null)}
          onNodeClick={(_event, node) => {
            setSelectedNodeId(node.id);
            setSelectedEdgeId(null);
          }}
          onClearSelectedEdgeBranch={clearSelectedEdgeBranch}
          onUpdateSelectedEdgeTarget={updateSelectedEdgeTarget}
          onMoveUp={() => moveSelectedNode('up')}
          onMoveDown={() => moveSelectedNode('down')}
          onRemoveSelected={() => selectedNode && removeNode(selectedNode.id)}
          onSetSelectedAsStart={() => selectedNode && setStartNode(selectedNode.id)}
          renderSelectedNodeEditor={() =>
          selectedNode ?
          <ComposerNodeEditor
            selectedNode={selectedNode}
            flow={flow}
            scenarioOptions={scenarioOptions}
            updateNode={updateNode} /> :

          null
          }
          onCreateStarterTemplate={createStarterTemplate}
          autoFollowRunningNode={autoFollowRunningNode}
          onAutoFollowRunningNodeChange={setAutoFollowRunningNode} /> :

        null}

          {activeTab === 'run' ?
        <ComposerRunTab
          runTrace={{
            ...runTrace,
            currentNodeName
          }}
          compilePreview={compilePreview}
          onGoToFlow={() => setActiveTab('flow')} /> :

        null}
        </div>
      }
    </Modal>);

}