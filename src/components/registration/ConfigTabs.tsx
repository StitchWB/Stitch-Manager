import { User, Settings2, Wifi } from 'lucide-react';
import { TabButton } from '../ui/TabButton';

export type ConfigTab = 'identity' | 'engine' | 'network';

interface ConfigTabsProps {
  activeTab: ConfigTab;
  onTabChange: (tab: ConfigTab) => void;
  disabled?: boolean;
}

const tabs: { id: ConfigTab; label: string; icon: React.ReactNode }[] = [
  { id: 'identity', label: 'Identity', icon: <User className="w-3.5 h-3.5" /> },
  { id: 'engine', label: 'Engine', icon: <Settings2 className="w-3.5 h-3.5" /> },
  { id: 'network', label: 'Network', icon: <Wifi className="w-3.5 h-3.5" /> },
];

export function ConfigTabs({ activeTab, onTabChange, disabled }: ConfigTabsProps) {
  return (
    <div className="shrink-0 px-4 pb-3">
      <div
        className="flex gap-1 p-1 rounded-lg"
        style={{
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.05)',
        }}
      >
        {tabs.map(tab => (
          <TabButton
            key={tab.id}
            active={activeTab === tab.id}
            onClick={() => onTabChange(tab.id)}
            icon={tab.icon}
            label={tab.label}
            disabled={disabled}
            className="flex-1 py-2 px-2 text-xs"
          />
        ))}
      </div>
    </div>
  );
}
