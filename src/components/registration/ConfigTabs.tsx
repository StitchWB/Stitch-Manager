import {
  User,
  Settings2,
  Wifi,
  Volume2,
  LayoutGrid,
  MonitorSmartphone,
} from 'lucide-react';
import { TabButton } from '@/components/ui';

export type ConfigTab = 'all' | 'identity' | 'browser' | 'network' | 'launch' | 'notify';

interface ConfigTabsProps {
  activeTab: ConfigTab;
  onTabChange: (tab: ConfigTab) => void;
  disabled?: boolean;
}

const tabs: { id: ConfigTab; label: string; icon: React.ReactNode }[] = [
  { id: 'all', label: 'Все', icon: <LayoutGrid className="w-3.5 h-3.5" /> },
  { id: 'identity', label: 'Почта', icon: <User className="w-3.5 h-3.5" /> },
  { id: 'browser', label: 'Браузер', icon: <MonitorSmartphone className="w-3.5 h-3.5" /> },
  { id: 'network', label: 'Сеть', icon: <Wifi className="w-3.5 h-3.5" /> },
  { id: 'launch', label: 'Запуск', icon: <Settings2 className="w-3.5 h-3.5" /> },
  { id: 'notify', label: 'Звук', icon: <Volume2 className="w-3.5 h-3.5" /> },
];

export function ConfigTabs({ activeTab, onTabChange, disabled }: ConfigTabsProps) {
  return (
    <div className="shrink-0 px-3 pb-2">
      <div className="flex gap-1 p-1 rounded-xl bg-white/[0.02] border border-white/5 shadow-inner shadow-black/20">
        {tabs.map(tab => (
          <TabButton
            key={tab.id}
            active={activeTab === tab.id}
            onClick={() => onTabChange(tab.id)}
            icon={tab.icon}
            label={tab.label}
            disabled={disabled}
            className="flex-1 !px-0.5 !py-1.5 !gap-1 text-[9px] font-bold tracking-tight"
          />
        ))}
      </div>
    </div>
  );
}
