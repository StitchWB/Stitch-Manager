import { Activity, GitBranch, Settings2 } from 'lucide-react';
import { SegmentedControl } from '@/components/ui';

type ComposerTab = 'setup' | 'flow' | 'run';

type FlowTabHeaderProps = {
  activeTab: ComposerTab;
  onChange: (next: ComposerTab) => void;
};

export function FlowTabHeader({ activeTab, onChange }: FlowTabHeaderProps) {
  return (
    <SegmentedControl
      value={activeTab}
      onChange={value => onChange(value as ComposerTab)}
      options={[
        { value: 'setup', label: 'Setup', icon: <Settings2 size={14} /> },
        { value: 'flow', label: 'Flow', icon: <GitBranch size={14} /> },
        { value: 'run', label: 'Run & Debug', icon: <Activity size={14} /> },
      ]}
      size="sm"
      className="max-w-[460px]"
    />
  );
}

export type { ComposerTab };
