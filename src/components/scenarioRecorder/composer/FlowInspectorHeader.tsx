import { t } from "@/lib/i18n";import { Button } from '@/components/ui';

type FlowInspectorHeaderProps = {
  selectedNodeId: string | null;
  selectedNodeIndex: number;
  selectedNodeType: string | null;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemoveSelected: () => void;
};

export function FlowInspectorHeader({
  selectedNodeId,
  selectedNodeIndex,
  selectedNodeType,
  onMoveUp,
  onMoveDown,
  onRemoveSelected
}: FlowInspectorHeaderProps) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="text-xs text-slate-300">
        {selectedNodeId ?
        `Selected node #${selectedNodeIndex + 1} • ${selectedNodeType}` :
        'Select a node from graph'}
      </div>
      {selectedNodeId ?
      <div className="flex gap-2">
          <Button
          size="xs"
          variant="secondary"
          onClick={onMoveUp}
          disabled={selectedNodeIndex <= 0}>{t("recorder.flow_inspector_header.move_up")}


        </Button>
          <Button size="xs" variant="secondary" onClick={onMoveDown}>{t("recorder.flow_inspector_header.move_down")}

        </Button>
          <Button size="xs" variant="danger" onClick={onRemoveSelected}>{t("recorder.flow_inspector_header.remove")}

        </Button>
        </div> :
      null}
    </div>);

}