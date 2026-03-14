import type { CompiledFlowPlan } from '@/lib/scenarioFlow/types';
import type { FlowRouteHistoryEntry } from './FlowGraphNode';
import { RunDiagnosticsPanel } from './RunDiagnosticsPanel';

type ComposerRunTabProps = {
  runTrace: {
    mode: string | null;
    routeHistory: FlowRouteHistoryEntry[];
    completedNodeIds: Set<string>;
    currentNodeId: string | null;
    currentNodeName: string | null;
    activeRouteEdgeId: string | null;
    isLive: boolean;
    durationMs: number | null;
  };
  compilePreview: CompiledFlowPlan | null;
  onGoToFlow: () => void;
};

export function ComposerRunTab({ runTrace, compilePreview, onGoToFlow }: ComposerRunTabProps) {
  return (
    <div className="space-y-3">
      {runTrace.routeHistory.length ? (
        <div className="rounded-md border border-emerald-400/25 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-100 space-y-1">
          <div className="font-medium">
            Last run trace ({runTrace.mode ?? 'unknown'})
            {typeof runTrace.durationMs === 'number'
              ? ` • ${(runTrace.durationMs / 1000).toFixed(1)}s`
              : ''}
          </div>
          {runTrace.routeHistory.slice(0, 6).map((route, idx) => (
            <div key={`${route.fromNodeId}-${route.toNodeId}-${route.branch}-${idx}`}>
              {route.fromNodeId} → {route.toNodeId} ({route.branch})
            </div>
          ))}
        </div>
      ) : null}

      {runTrace.currentNodeId ? (
        <div className="rounded-md border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
          Running now: {runTrace.currentNodeName ?? runTrace.currentNodeId}
          {runTrace.isLive ? ' • live' : ''}
        </div>
      ) : null}

      <RunDiagnosticsPanel
        compilePreview={compilePreview}
        executedNodesCount={runTrace.completedNodeIds.size}
        executedBranchesCount={runTrace.routeHistory.length}
        onGoToFlow={onGoToFlow}
      />
    </div>
  );
}
