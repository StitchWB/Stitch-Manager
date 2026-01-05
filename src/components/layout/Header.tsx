import { Bell } from 'lucide-react';
import { useAppStore } from '../../stores/app';

interface HeaderProps {
  title: string;
  subtitle?: string;
}

export default function Header({ title, subtitle }: HeaderProps) {
  const { serverStatus } = useAppStore();

  const getStatusInfo = () => {
    if (serverStatus?.isRunning) {
      return { label: 'System Online', color: 'bg-green-500' };
    }
    return { label: 'Server Offline', color: 'bg-slate-500' };
  };

  const status = getStatusInfo();

  return (
    <header className="h-16 border-b border-border-dark bg-background-dark flex items-center justify-between px-6 shrink-0">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-white">{title}</h1>
        {subtitle && <p className="text-xs text-slate-400">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-4">
        {/* Status Indicator */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-white/5 border border-white/10">
          <div className={`w-2 h-2 rounded-full ${status.color} animate-pulse`} />
          <span className="text-xs font-medium text-slate-300">{status.label}</span>
        </div>

        {/* Notifications */}
        <button className="text-slate-400 hover:text-white transition-colors relative">
          <Bell size={20} />
          {/* Notification badge */}
          <span className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full" />
        </button>
      </div>
    </header>
  );
}
