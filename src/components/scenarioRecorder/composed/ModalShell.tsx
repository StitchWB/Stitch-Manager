import { useCallback, useMemo } from 'react';
import { t } from "@/lib/i18n";
import { toast } from 'sonner';
import { Modal, Input, Select } from '@/components/ui';
import 'reactflow/dist/style.css';
import type { ComposedFlowItem } from '@/lib/backend/modules/pythonJobs';
import { compileComposedFlow } from '@/lib/scenarioFlow/compiler';
import { createEmptyComposedFlow } from '@/lib/scenarioFlow/fixtures';
import type { ComposedFlow, CompiledFlowPlan } from '@/lib/scenarioFlow/types';
import type { FlowValidationResult } from '@/lib/scenarioFlow/validation';
import { formatProfileAliasOptionLabel } from '@/lib/profiles/displayName';
import {
  FlowTabHeader,
  ComposerFooter,
  ComposerSetupTab,
  ComposerRunTab,
  ComposerFlowTab,
  ComposerNodeEditor } from
'../composer';
import type { FlowRouteHistoryEntry } from '../composer/FlowGraphNode';
import { ValidationPanel } from './ValidationPanel';
import type { useFlowNodeEditor } from './NodeEditor';
import type { useFlowNodeOperations } from './nodeOperations';
import type { useSetupTabState } from './setupTabState';
import type { ComposedFlowScenarioOption } from './useComposedFlowData';
import type { JobRunState } from './useComposedFlowJob';

type ModalShellProps = {
  alias: string | null;
  isOpen: boolean;
  onClose: () => void;
  flow: ComposedFlow | null;
  updateFlow: (fn: (prev: ComposedFlow) => ComposedFlow) => void;
  activeTab: 'setup' | 'flow' | 'run';
  onTabChange: (tab: 'setup' | 'flow' | 'run') => void;
  flows: ComposedFlowItem[];
  flowsLoading: boolean;
  selectedFlowId: string;
  setSelectedFlowId: (id: string) => void;
  setFlow: React.Dispatch<React.SetStateAction<ComposedFlow | null>>;
  scenarios: ComposedFlowScenarioOption[];
  scenariosLoading: boolean;
  flowValidation: FlowValidationResult | null;
  onIssueClick: (issueIndex: number) => void;
  nodeEditor: ReturnType<typeof useFlowNodeEditor>;
  nodeOps: ReturnType<typeof useFlowNodeOperations>;
  setup: ReturnType<typeof useSetupTabState>;
  runState: JobRunState;
  canRunFlow: boolean;
  compilePreview: CompiledFlowPlan | null;
  saveLoading: boolean;
  onDeleteFlow: () => void;
  onSaveFlow: () => void;
  onCreateSchedulerTask: () => void;
  onRunFlow: () => void;
  onRefreshLists: () => void;
  runTrace: {
    mode: string | null;
    routeHistory: FlowRouteHistoryEntry[];
    completedNodeIds: Set<string>;
    currentNodeId: string | null;
    activeRouteEdgeId: string | null;
    isLive: boolean;
    durationMs: number | null;
  };
  currentNodeName: string | null;
};

export function ModalShell({
  alias,
  isOpen,
  onClose,
  flow,
  updateFlow,
  activeTab,
  onTabChange,
  flows,
  flowsLoading,
  selectedFlowId,
  setSelectedFlowId,
  setFlow,
  scenarios,
  scenariosLoading,
  flowValidation,
  onIssueClick,
  nodeEditor,
  nodeOps,
  setup,
  runState,
  canRunFlow,
  compilePreview,
  saveLoading,
  onDeleteFlow,
  onSaveFlow,
  onCreateSchedulerTask,
  onRunFlow,
  onRefreshLists,
  runTrace,
  currentNodeName
}: ModalShellProps) {
  const {
    selectedNodeId, setSelectedNodeId, selectedEdgeId, setSelectedEdgeId,
    autoFollowRunningNode, setAutoFollowRunningNode, flowCanvasRef, flowInstanceRef,
    flowCanvasNodes, flowCanvasEdges, selectedEdgeMeta, edgeTargetOptions,
    selectedNode, selectedNodeIndex, onFlowNodesChange, onFlowConnect, onFlowEdgeClick,
    clearSelectedEdgeBranch, updateSelectedEdgeTarget, onPaletteDrop
  } = nodeEditor;
  const {
    updateNode, addRunNode, addSwitchNode, removeNode, moveSelectedNode, addNodeAfter,
    duplicateSelectedNode, setStartNode, arrangeNodes, createStarterTemplate
  } = nodeOps;

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
        onDelete={onDeleteFlow}
        onSave={onSaveFlow}
        onCreateSchedulerTask={onCreateSchedulerTask}
        onRun={onRunFlow} />

      }>

      {!alias ?
      <div className="text-sm text-slate-400">{t("recorder.composed_flow_modal.select_profile_alias_first")}</div> :
      !flow ?
      <div className="text-sm text-slate-400">{t("recorder.composed_flow_modal.loading")}</div> :

      <div className="space-y-4">
          <FlowTabHeader activeTab={activeTab} onChange={onTabChange} />

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

          <ValidationPanel validation={flowValidation} onIssueClick={onIssueClick} />

          {activeTab === 'setup' ?
        <ComposerSetupTab
          flow={flow}
          inputDefaultEntries={setup.inputDefaultEntries}
          addInputDefault={setup.addInputDefault}
          updateInputDefault={setup.updateInputDefault}
          removeInputDefault={setup.removeInputDefault}
          updateFlow={updateFlow}
          sheetsParams={setup.sheetsParams}
          sheetsError={setup.sheetsError}
          selectedSheetId={setup.selectedSheetId}
          selectedSheetColumn={setup.selectedSheetColumn}
          sheetOptions={setup.sheetOptions}
          sheetColumnOptions={setup.sheetColumnOptions}
          setSelectedSheetId={setup.setSelectedSheetId}
          setSelectedSheetColumn={setup.setSelectedSheetColumn}
          refreshSheets={setup.refreshSheets}
          importEmailsFromSheet={setup.importEmailsFromSheet} /> :

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
          onRefreshLists={onRefreshLists}
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
          onGoToFlow={() => onTabChange('flow')} /> :

        null}
        </div>
      }
    </Modal>);

}
