import { t } from "@/lib/i18n";import { Button } from '@/components/ui';
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
  onGoToFlow
}: RunDiagnosticsPanelProps) {
  const hasSegments = (compilePreview?.segments.length ?? 0) > 0;

  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-3 text-xs">
      <div className="text-slate-400 mb-1">{t("recorder.run_diagnostics_panel.compile_preview")}</div>
      <div className="text-slate-200">{t("recorder.run_diagnostics_panel.segments")}{compilePreview?.segments.length ?? 0}</div>
      <div className="text-slate-400 mt-1">{t("recorder.run_diagnostics_panel.executed_nodes")}
        {executedNodesCount}
        {executedBranchesCount ? ` • Executed branches: ${executedBranchesCount}` : ''}
      </div>

      {!hasSegments ?
      <div className="mt-2 rounded-md border border-amber-400/25 bg-amber-500/10 p-2 text-amber-200 space-y-2">
          <div>{t("recorder.run_diagnostics_panel.no_runnable_steps_yet_add_your_first_node_in_flow_")}</div>
          <Button size="xs" variant="secondary" onClick={onGoToFlow}>{t("recorder.run_diagnostics_panel.go_to_flow_tab")}

        </Button>
        </div> :
      null}

      {compilePreview?.diagnostics?.length ?
      <div className="text-amber-300 mt-1">
          {compilePreview.diagnostics.map((item) =>
        <div key={item}>{item}</div>
        )}
        </div> :

      <div className="text-slate-500 mt-1">{t("recorder.run_diagnostics_panel.no_diagnostics")}</div>
      }
    </div>);

}