import { NavLink } from 'react-router-dom';
import { useState, useEffect } from 'react';
import {
  LayoutDashboard,
  Users,
  RefreshCw,
  Code,
  Server,
  Settings,
  FileText,
  Terminal,
  MessageSquare,
  ChevronLeft,
  ChevronRight,
  Clock,
  Key,
  Orbit,
  ShieldCheck,
} from 'lucide-react';
import { useAppStore } from '../../stores/app';
import { t } from '../../lib/i18n';
import { cn } from '../../lib/utils';
import { version as appVersion } from '../../../package.json';

interface NavItemProps {
  to: string;
  icon: React.ReactNode;
  label: string;
  collapsed?: boolean;
}

function NavItem({ to, icon, label, collapsed }: NavItemProps) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 px-3 py-2.5 transition-all duration-200 rounded-xl mx-2 group relative',
          isActive
            ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/40 font-bold'
            : 'text-slate-300 hover:text-white hover:bg-white/[0.04]'
        )
      }
    >
      <span className="shrink-0">{icon}</span>
      {!collapsed && (
        <span className="text-sm tracking-tight animate-in fade-in slide-in-from-left-2 duration-300">
          {label}
        </span>
      )}
      {collapsed && (
        <div className="absolute left-full ml-4 px-2 py-1 bg-slate-800 text-white text-xs rounded-md opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 whitespace-nowrap shadow-xl border border-white/10">
          {label}
        </div>
      )}
    </NavLink>
  );
}

export default function Sidebar() {
  const { sidebarCollapsed, toggleSidebar, language } = useAppStore();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);

    // Auto-collapse sidebar on small screens
    const handleResize = () => {
      if (window.innerWidth < 1024 && !useAppStore.getState().sidebarCollapsed) {
        useAppStore.getState().toggleSidebar();
      }
    };

    window.addEventListener('resize', handleResize);
    handleResize(); // Initial check

    return () => window.removeEventListener('resize', handleResize);
  }, []);

  void language;

  if (!mounted) return null;

  return (
    <aside
      className={cn(
        'flex flex-col shrink-0 transition-all duration-300 ease-in-out border-r border-white/10 relative z-40 bg-[#111116]/80 backdrop-blur-3xl',
        sidebarCollapsed ? 'w-20' : 'w-64'
      )}
    >
      {/* Collapse Toggle Button */}
      <button
        onClick={toggleSidebar}
        className="absolute -right-3 top-20 w-6 h-6 rounded-full bg-indigo-600 text-white flex items-center justify-center shadow-lg hover:bg-indigo-500 transition-colors z-50 border border-indigo-400/50"
      >
        {sidebarCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
      </button>

      {/* Logo */}
      <div className="h-20 flex items-center px-5 mb-2">
        <div className="flex items-center gap-3 overflow-hidden">
          <div className="rounded-xl w-10 h-10 flex items-center justify-center shrink-0 bg-gradient-to-br from-indigo-500 to-indigo-700 shadow-xl shadow-indigo-900/40">
            <Terminal className="w-5 h-5 text-white" />
          </div>
          {!sidebarCollapsed && (
            <div className="flex flex-col min-w-0 animate-in fade-in slide-in-from-left-2 duration-500">
              <h1 className="text-white text-base font-black tracking-tighter leading-tight truncate uppercase">
                Stitch
              </h1>
              <span className="text-indigo-400/80 text-[10px] font-bold tracking-widest uppercase">
                Manager v{appVersion}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-2 space-y-1 no-scrollbar">
        <NavItem
          to="/"
          icon={<LayoutDashboard size={20} />}
          label={t('sidebar.dashboard')}
          collapsed={sidebarCollapsed}
        />
        <NavItem
          to="/accounts"
          icon={<Users size={20} />}
          label={t('sidebar.accounts')}
          collapsed={sidebarCollapsed}
        />
        <NavItem
          to="/autoreg"
          icon={<RefreshCw size={20} />}
          label={t('sidebar.autoReg')}
          collapsed={sidebarCollapsed}
        />
        <NavItem
          to="/scheduler"
          icon={<Clock size={20} />}
          label="Scheduler"
          collapsed={sidebarCollapsed}
        />
        <NavItem
          to="/patcher"
          icon={<Code size={20} />}
          label={t('sidebar.idePatch')}
          collapsed={sidebarCollapsed}
        />
        <NavItem
          to="/server"
          icon={<Server size={20} />}
          label={t('sidebar.apiServer')}
          collapsed={sidebarCollapsed}
        />
        <NavItem
          to="/ai"
          icon={<ShieldCheck size={20} />}
          label="AI Hub"
          collapsed={sidebarCollapsed}
        />
        <NavItem
          to="/antigravity"
          icon={<Orbit size={20} />}
          label="Antigravity"
          collapsed={sidebarCollapsed}
        />
        <NavItem
          to="/api-keys"
          icon={<Key size={20} />}
          label="API Keys"
          collapsed={sidebarCollapsed}
        />
        <NavItem
          to="/chat"
          icon={<MessageSquare size={20} />}
          label={t('sidebar.chat')}
          collapsed={sidebarCollapsed}
        />

        <div className="mx-5 pt-6 mt-6 border-t border-white/5 opacity-80">
          {!sidebarCollapsed && (
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-4">
              {t('sidebar.system')}
            </p>
          )}
        </div>

        <NavItem
          to="/settings"
          icon={<Settings size={20} />}
          label={t('sidebar.settings')}
          collapsed={sidebarCollapsed}
        />
        <NavItem
          to="/logs"
          icon={<FileText size={20} />}
          label={t('sidebar.logs')}
          collapsed={sidebarCollapsed}
        />
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-white/5">
        <div
          className={cn(
            'flex items-center gap-3 px-3 py-2 rounded-xl bg-white/[0.02] border border-white/5',
            sidebarCollapsed && 'justify-center'
          )}
        >
          <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)] animate-pulse" />
          {!sidebarCollapsed && (
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest truncate">
              {t('sidebar.localMode')}
            </span>
          )}
        </div>
      </div>
    </aside>
  );
}
