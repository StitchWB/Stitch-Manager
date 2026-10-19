import { t } from "@/lib/i18n";import { MoreHorizontal } from 'lucide-react';
import { Button, DropdownMenu, Toggle } from '@/components/ui';

type FlowActionsBarProps = {
  scenariosLoading: boolean;
  flowNodesCount: number;
  selectedNodeId: string | null;
  autoFollowRunningNode: boolean;
  onAutoFollowRunningNodeChange: (enabled: boolean) => void;
  onAddScenarioStep: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onAddContextStep: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onAddNextScenarioStep: () => void;
  onAddNextContextStep: () => void;
  onDuplicateSelected: () => void;
  onArrange: () => void;
  onRefreshLists: () => void;
  onExportCompiledPlan: () => void;
};

export function FlowActionsBar({
  scenariosLoading,
  flowNodesCount,
  selectedNodeId,
  autoFollowRunningNode,
  onAutoFollowRunningNodeChange,
  onAddScenarioStep,
  onAddContextStep,
  onAddNextScenarioStep,
  onAddNextContextStep,
  onDuplicateSelected,
  onArrange,
  onRefreshLists,
  onExportCompiledPlan
}: FlowActionsBarProps) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="secondary" onClick={onAddScenarioStep} disabled={scenariosLoading}>{t("recorder.flow_actions_bar.scenario_step")}

      </Button>
      <Button variant="secondary" onClick={onAddContextStep}>{t("recorder.flow_actions_bar.context_step")}

      </Button>
      <Button variant="secondary" onClick={onAddNextScenarioStep}>{t("recorder.flow_actions_bar.next_scenario")}

      </Button>

      <div className="h-9 px-2 rounded-md border border-white/10 bg-black/30 inline-flex items-center">
        <Toggle
          size="sm"
          label="Auto-follow"
          checked={autoFollowRunningNode}
          onChange={onAutoFollowRunningNodeChange}
          className="py-0 px-0 hover:bg-transparent" />

      </div>

      <DropdownMenu
        value="more"
        onValueChange={(value) => {
          if (value === 'add_next_context') onAddNextContextStep();
          if (value === 'duplicate') onDuplicateSelected();
          if (value === 'arrange') onArrange();
          if (value === 'refresh') onRefreshLists();
          if (value === 'export') onExportCompiledPlan();
        }}
        triggerLabel="More"
        triggerIcon={<MoreHorizontal size={14} />}
        options={[
        { value: 'add_next_context', label: 'Add next context step' },
        { value: 'duplicate', label: 'Duplicate selected', disabled: !selectedNodeId },
        { value: 'arrange', label: 'Arrange flow', disabled: flowNodesCount < 2 },
        { value: 'refresh', label: 'Refresh lists' },
        { value: 'export', label: 'Export compiled plan' }]
        } />

    </div>);

}