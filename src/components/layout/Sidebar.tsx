import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Users,
  RefreshCw,
  Code,
  Server,
  Settings,
  FileText,
  ChevronDown,
  Terminal,
} from 'lucide-react';
import { useAppStore } from '../../stores/app';

interface NavItemProps {
  to: string;
  icon: React.ReactNode;
  label: string;
}

function NavItem({ to, icon, label }: NavItemProps) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all group ${
          isActive
            ? 'bg-primary text-white shadow-md shadow-primary/10'
            : 'text-slate-400 hover:bg-white/5 hover:text-white'
        }`
      }
    >
      <span className="text-[20px] group-hover:text-primary transition-colors">
        {icon}
      </span>
      <span className="text-sm font-medium">{label}</span>
    </NavLink>
  );
}

export default function Sidebar() {
  const { sidebarCollapsed } = useAppStore();

  return (
    <aside
      className={`${
        sidebarCollapsed ? 'w-[60px]' : 'w-64'
      } bg-surface-dark border-r border-border-dark flex flex-col shrink-0 transition-all duration-300`}
    >
      {/* Sidebar Header */}
      <div className="h-16 flex items-center px-6 border-b border-border-dark">
        <div className="flex items-center gap-3">
          <div className="bg-gradient-to-tr from-primary to-blue-400 rounded-lg w-8 h-8 flex items-center justify-center shadow-lg shadow-primary/20">
            <Terminal className="w-5 h-5 text-white" />
          </div>
          {!sidebarCollapsed && (
            <div className="flex flex-col">
              <h1 className="text-white text-base font-semibold leading-none tracking-tight">
                Stitch Manager
              </h1>
              <span className="text-slate-400 text-xs mt-1 font-mono">v0.1.0</span>
            </div>
          )}
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-6 px-3 space-y-1">
        <NavItem to="/" icon={<LayoutDashboard size={20} />} label="Dashboard" />
        <NavItem to="/accounts" icon={<Users size={20} />} label="Accounts" />
        <NavItem to="/autoreg" icon={<RefreshCw size={20} />} label="Auto-Reg" />
        <NavItem to="/patcher" icon={<Code size={20} />} label="IDE Patch" />
        <NavItem to="/server" icon={<Server size={20} />} label="API Server" />

        {/* System Section */}
        <div className="pt-4 mt-4 border-t border-border-dark">
          <p className="px-3 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
            System
          </p>
          <NavItem
            to="/settings"
            icon={<Settings size={20} />}
            label="Settings"
          />
          <NavItem to="/logs" icon={<FileText size={20} />} label="Logs" />
        </div>
      </nav>

      {/* User Profile */}
      <div className="p-4 border-t border-border-dark">
        <button className="flex items-center gap-3 w-full hover:bg-white/5 p-2 rounded-lg transition-colors">
          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-blue-500 to-purple-500 flex items-center justify-center text-[10px] font-bold text-white border border-white/20">
            AD
          </div>
          {!sidebarCollapsed && (
            <>
              <div className="flex flex-col items-start overflow-hidden">
                <span className="text-sm font-medium text-white truncate w-full text-left">
                  Admin User
                </span>
                <span className="text-xs text-slate-400 truncate w-full text-left">
                  admin@local
                </span>
              </div>
              <ChevronDown className="text-slate-400 ml-auto w-4 h-4" />
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
