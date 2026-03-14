import { Button } from '@/components/ui';
import type { CompiledFlowPlan } from '@/lib/scenarioFlow/types';

type RunDiagnosticsPanelProps = {
  compilePreview: CompiledFlowPlan | null;
  executedNodesCount: number;
  executedBranchesCount: number;
  onGoToFlow: () => void;
};

export function RunDiagnosticsPanel({
  compilePreview,
  executedNodesCount,
  executedBranchesCount,
  onGoToFlow,
}: RunDiagnosticsPanelProps) {
  const hasSegments = (compilePreview?.segments.length ?? 0) > 0;

  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-3 text-xs">
      <div className="text-slate-400 mb-1">Compile preview</div>
      <div className="text-slate-200">Segments: {compilePreview?.segments.length ?? 0}</div>
      <div className="text-slate-400 mt-1">
        Executed nodes: {executedNodesCount}
        {executedBranchesCount ? ` • Executed branches: ${executedBranchesCount}` : ''}
      </div>

      {!hasSegments ? (
        <div className="mt-2 rounded-md border border-amber-400/25 bg-amber-500/10 p-2 text-amber-200 space-y-2">
          <div>No runnable steps yet. Add your first node in Flow tab.</div>
          <Button size="xs" variant="secondary" onClick={onGoToFlow}>
            Go to Flow tab
          </Button>
        </div>
      ) : null}

      {compilePreview?.diagnostics?.length ? (
        <div className="text-amber-300 mt-1">
          {compilePreview.diagnostics.map(item => (
            <div key={item}>{item}</div>
          ))}
        </div>
      ) : (
        <div className="text-slate-500 mt-1">No diagnostics</div>
      )}
    </div>
  );
}
