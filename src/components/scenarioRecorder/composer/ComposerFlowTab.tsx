import ReactFlow, {
  Background,
  type Connection,
  Controls,
  MiniMap,
  type Edge,
  type EdgeMouseHandler,
  type Node,
  type NodeChange,
  type ReactFlowInstance,
} from 'reactflow';
import { Button, Select } from '@/components/ui';
import {
  FLOW_NODE_TYPES,
  FlowFallbackPanel,
  type FlowCanvasEdgeData,
  type FlowCanvasNodeData,
} from './FlowGraphNode';
import { FlowActionsBar } from './FlowActionsBar';
import { FlowInspectorHeader } from './FlowInspectorHeader';

type ComposerFlowTabProps = {
  flowNodesCount: number;
  scenariosLoading: boolean;
  selectedNodeId: string | null;
  selectedNodeIndex: number;
  selectedNodeType: string | null;
  selectedEdgeId: string | null;
  selectedEdgeMeta: { branch: 'success' | 'error'; targetId: string } | null;
  edgeTargetOptions: Array<{ value: string; label: string }>;
  flowCanvasNodes: Array<Node<FlowCanvasNodeData>>;
  flowCanvasEdges: Array<Edge<FlowCanvasEdgeData>>;
  flowCanvasRef: React.RefObject<HTMLDivElement>;
  flowInstanceRef: React.MutableRefObject<ReactFlowInstance<
    Node<FlowCanvasNodeData>,
    Edge<FlowCanvasEdgeData>
  > | null>;
  onPaletteDrop: (
    type: 'runScenario' | 'switchContext',
    event: React.MouseEvent<HTMLButtonElement>
  ) => void;
  onAddRunNode: () => void;
  onAddSwitchNode: () => void;
  onAddNextRunNode: () => void;
  onAddNextSwitchNode: () => void;
  onDuplicateSelected: () => void;
  onArrange: () => void;
  onRefreshLists: () => void;
  onExportCompiledPlan: () => void;
  onNodesChange: (changes: NodeChange[]) => void;
  onConnect: (connection: Connection) => void;
  onEdgeClick: EdgeMouseHandler;
  onPaneClick: () => void;
  onNodeClick: (event: React.MouseEvent, node: Node<FlowCanvasNodeData>) => void;
  onClearSelectedEdgeBranch: () => void;
  onUpdateSelectedEdgeTarget: (targetId: string) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemoveSelected: () => void;
  onSetSelectedAsStart: () => void;
  renderSelectedNodeEditor: () => React.ReactNode;
  onCreateStarterTemplate: () => void;
  autoFollowRunningNode: boolean;
  onAutoFollowRunningNodeChange: (enabled: boolean) => void;
};

export function ComposerFlowTab(props: ComposerFlowTabProps) {
  const {
    flowNodesCount,
    scenariosLoading,
    selectedNodeId,
    selectedNodeIndex,
    selectedNodeType,
    selectedEdgeId,
    selectedEdgeMeta,
    edgeTargetOptions,
    flowCanvasNodes,
    flowCanvasEdges,
    flowCanvasRef,
    flowInstanceRef,
    onPaletteDrop,
    onAddRunNode,
    onAddSwitchNode,
    onAddNextRunNode,
    onAddNextSwitchNode,
    onDuplicateSelected,
    onArrange,
    onRefreshLists,
    onExportCompiledPlan,
    onNodesChange,
    onConnect,
    onEdgeClick,
    onPaneClick,
    onNodeClick,
    onClearSelectedEdgeBranch,
    onUpdateSelectedEdgeTarget,
    onMoveUp,
    onMoveDown,
    onRemoveSelected,
    onSetSelectedAsStart,
    renderSelectedNodeEditor,
    onCreateStarterTemplate,
    autoFollowRunningNode,
    onAutoFollowRunningNodeChange,
  } = props;

  return (
    <>
      <FlowActionsBar
        scenariosLoading={scenariosLoading}
        flowNodesCount={flowNodesCount}
        selectedNodeId={selectedNodeId}
        autoFollowRunningNode={autoFollowRunningNode}
        onAutoFollowRunningNodeChange={onAutoFollowRunningNodeChange}
        onAddScenarioStep={event => onPaletteDrop('runScenario', event)}
        onAddContextStep={event => onPaletteDrop('switchContext', event)}
        onAddNextScenarioStep={onAddNextRunNode}
        onAddNextContextStep={onAddNextSwitchNode}
        onDuplicateSelected={onDuplicateSelected}
        onArrange={onArrange}
        onRefreshLists={onRefreshLists}
        onExportCompiledPlan={onExportCompiledPlan}
      />

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.55fr)_minmax(340px,1fr)] gap-3">
        <div
          ref={flowCanvasRef}
          className="rounded-lg border border-white/10 bg-black/20 p-2 h-[460px]"
        >
          {flowNodesCount === 0 ? (
            <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-slate-300 space-y-3">
              <div className="font-medium text-slate-100">Start by adding your first step</div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" onClick={onAddRunNode}>
                  + Add Auth node
                </Button>
                <Button size="sm" variant="secondary" onClick={onAddSwitchNode}>
                  + Add Context node
                </Button>
                <Button size="sm" onClick={onCreateStarterTemplate}>
                  Use starter template
                </Button>
              </div>
            </div>
          ) : (
            <ReactFlow
              nodes={flowCanvasNodes}
              edges={flowCanvasEdges}
              nodeTypes={FLOW_NODE_TYPES}
              onInit={instance => {
                flowInstanceRef.current = instance;
              }}
              fitView
              fitViewOptions={{ padding: 0.22 }}
              nodesConnectable
              nodesDraggable
              elementsSelectable
              onNodesChange={onNodesChange}
              onConnect={onConnect}
              onEdgeClick={onEdgeClick}
              onPaneClick={onPaneClick}
              onNodeClick={onNodeClick}
              proOptions={{ hideAttribution: true }}
              className="rounded-md"
            >
              <Background gap={18} size={1} color="rgba(148,163,184,0.16)" />
              <Controls showInteractive={false} />
              <MiniMap
                pannable
                zoomable
                maskColor="rgba(2,6,23,0.65)"
                nodeColor={node =>
                  node.data?.type === 'runScenario'
                    ? 'rgba(16,185,129,0.9)'
                    : 'rgba(245,158,11,0.9)'
                }
                className="!bg-slate-950/80 !border !border-white/15"
              />
            </ReactFlow>
          )}
        </div>

        <div className="rounded-lg border border-white/10 bg-black/20 p-3 space-y-3 max-h-[460px] overflow-y-auto">
          <FlowInspectorHeader
            selectedNodeId={selectedNodeId}
            selectedNodeIndex={selectedNodeIndex}
            selectedNodeType={selectedNodeType}
            onMoveUp={onMoveUp}
            onMoveDown={onMoveDown}
            onRemoveSelected={onRemoveSelected}
          />

          {selectedEdgeId ? (
            <div className="rounded-md border border-rose-400/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200 flex items-center justify-between gap-2">
              <span>Selected branch: {selectedEdgeId}</span>
              <Button size="xs" variant="danger" onClick={onClearSelectedEdgeBranch}>
                Clear branch
              </Button>
            </div>
          ) : null}

          {selectedEdgeMeta ? (
            <div className="rounded-md border border-sky-400/25 bg-sky-500/10 p-2">
              <Select
                label={`Branch target (${selectedEdgeMeta.branch})`}
                value={selectedEdgeMeta.targetId}
                options={edgeTargetOptions}
                onValueChange={onUpdateSelectedEdgeTarget}
              />
            </div>
          ) : null}

          {!selectedNodeId ? (
            <FlowFallbackPanel label="Select a node to edit it. Tip: connect success/error handles and click edge to clear branch." />
          ) : (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                <Button size="xs" variant="secondary" onClick={onSetSelectedAsStart}>
                  Set as start
                </Button>
                <Button size="xs" variant="secondary" onClick={onDuplicateSelected}>
                  Duplicate
                </Button>
              </div>
              {renderSelectedNodeEditor()}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
