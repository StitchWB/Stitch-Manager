import { User, Settings2, Wifi, Repeat } from 'lucide-react';
import { TabButton } from '@/components/ui';


export type ConfigTab = 'identity' | 'engine' | 'network' | 'automation' | 'inbox';

interface ConfigTabsProps {
  activeTab: ConfigTab;
  onTabChange: (tab: ConfigTab) => void;
  disabled?: boolean;
}

const tabs: { id: ConfigTab; label: string; icon: React.ReactNode }[] = [
  { id: 'identity', label: 'ID', icon: <User className="w-3.5 h-3.5" /> },
  { id: 'engine', label: 'Движок', icon: <Settings2 className="w-3.5 h-3.5" /> },
  { id: 'network', label: 'Сеть', icon: <Wifi className="w-3.5 h-3.5" /> },
  { id: 'automation', label: 'Авто', icon: <Repeat className="w-3.5 h-3.5" /> },
];

export function ConfigTabs({ activeTab, onTabChange, disabled }: ConfigTabsProps) {
  return (
    <div className="shrink-0 px-3 pb-3">
      <div className="flex gap-1 p-1 rounded-xl bg-white/[0.02] border border-white/5 shadow-inner shadow-black/20">
        {tabs.map(tab => (
          <TabButton
            key={tab.id}
            active={activeTab === tab.id}
            onClick={() => onTabChange(tab.id)}
            icon={tab.icon}
            label={tab.label}
            disabled={disabled}
            className="flex-1 !px-1 !py-2 !gap-1.5 text-[11px] font-bold tracking-tight"
          />
        ))}
      </div>
    </div>
  );
}
