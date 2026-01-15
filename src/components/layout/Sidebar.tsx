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
} from 'lucide-react';
import { useAppStore } from '../../stores/app';
import { t } from '../../lib/i18n';
import { version as appVersion } from '../../../package.json';

interface NavItemProps {
  to: string;
  icon: React.ReactNode;
  label: string;
  collapsed?: boolean;
  index?: number;
}

function NavItem({ to, icon, label, collapsed, index = 0 }: NavItemProps) {
  const [mounted, setMounted] = useState(false);
  
  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 50 + index * 30);
    return () => clearTimeout(timer);
  }, [index]);

  return (
    <NavLink
      to={to}
      style={{
        opacity: mounted ? 1 : 0,
        transform: mounted ? 'translateX(0)' : 'translateX(-8px)',
        transition: `opacity 250ms ease-out, transform 250ms ease-out`,
      }}
      className={({ isActive }) =>
        `flex items-center gap-3 px-3 py-2 transition-all duration-200 ${
          isActive
            ? 'bg-indigo-500/10 border-l-2 border-indigo-400 font-medium text-white'
            : 'border-l-2 border-transparent text-slate-400 hover:text-white hover:bg-white/[0.03]'
        }`
      }
    >
      {({ isActive }) => (
        <>
          <span className={`transition-colors duration-200 ${isActive ? 'text-indigo-400' : ''}`}>
            {icon}
          </span>
          {!collapsed && (
            <span className="text-sm">{label}</span>
          )}
        </>
      )}
    </NavLink>
  );
}

export default function Sidebar() {
  const { sidebarCollapsed, language } = useAppStore();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 50);
    return () => clearTimeout(timer);
  }, []);

  // Force re-render when language changes
  void language; // Force re-render on language change

  return (
    <aside
      className={`${
        sidebarCollapsed ? 'w-[60px]' : 'w-60'
      } flex flex-col shrink-0 transition-sidebar backdrop-blur-xl border-r border-white/5`}
      style={{
        opacity: mounted ? 1 : 0,
        transition: 'opacity 300ms ease-out, width 300ms cubic-bezier(0.4, 0, 0.2, 1)',
        background: 'rgba(15, 23, 42, 0.5)',
      }}
    >
      {/* Logo */}
      <div className="h-14 flex items-center px-4 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="rounded-lg w-8 h-8 flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #6366f1, #4f46e5)', boxShadow: '0 0 20px rgba(99, 102, 241, 0.4)' }}>
            <Terminal className="w-4 h-4 text-white" />
          </div>
          {!sidebarCollapsed && (
            <div className="flex flex-col">
              <h1 className="text-white text-sm font-semibold tracking-tight">
                Stitch Manager
              </h1>
              <span className="text-slate-500 text-2xs font-mono">v{appVersion}</span>
            </div>
          )}
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4 space-y-0.5 no-scrollbar">
        <NavItem to="/" icon={<LayoutDashboard size={18} />} label={t('sidebar.dashboard')} collapsed={sidebarCollapsed} index={0} />
        <NavItem to="/accounts" icon={<Users size={18} />} label={t('sidebar.accounts')} collapsed={sidebarCollapsed} index={1} />
        <NavItem to="/autoreg" icon={<RefreshCw size={18} />} label={t('sidebar.autoReg')} collapsed={sidebarCollapsed} index={2} />
        <NavItem to="/patcher" icon={<Code size={18} />} label={t('sidebar.idePatch')} collapsed={sidebarCollapsed} index={3} />
        <NavItem to="/server" icon={<Server size={18} />} label={t('sidebar.apiServer')} collapsed={sidebarCollapsed} index={4} />

        {/* System Section */}
        <div className="pt-4 mt-4 border-t border-white/5">
          {!sidebarCollapsed && (
            <p className="px-3 text-2xs font-semibold text-slate-600 uppercase tracking-wider mb-2">
              {t('sidebar.system')}
            </p>
          )}
          <NavItem to="/settings" icon={<Settings size={18} />} label={t('sidebar.settings')} collapsed={sidebarCollapsed} index={5} />
          <NavItem to="/logs" icon={<FileText size={18} />} label={t('sidebar.logs')} collapsed={sidebarCollapsed} index={6} />
        </div>
      </nav>

      {/* App Info Footer */}
      <div className="h-12 px-3 border-t border-white/5 flex items-center">
        <div className="flex items-center gap-2 w-full px-2 py-1.5">
          <div className="w-6 h-6 rounded-full flex items-center justify-center text-2xs font-bold text-white" style={{ background: 'linear-gradient(135deg, #6366f1, #4f46e5)', boxShadow: '0 0 12px rgba(99, 102, 241, 0.4)' }}>
            <Terminal className="w-3 h-3" />
          </div>
          {!sidebarCollapsed && (
            <div className="flex flex-col items-start overflow-hidden flex-1">
              <span className="text-xs font-medium text-slate-400 truncate w-full text-left">
                {t('sidebar.localMode')}
              </span>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
