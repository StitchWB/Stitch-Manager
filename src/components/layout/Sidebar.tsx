import { NavLink } from 'react-router-dom';
import { useState, useEffect } from 'react';
import {
  LayoutDashboard,
  Users,
  RefreshCw,
  Code,
  Settings,
  FileText,
  Terminal,
  Mail,
  ChevronLeft,
  ChevronRight,
  Repeat,
  Wrench,
  ShieldCheck,
  KeyRound,
  Radar,
  HeartHandshake,
  BookOpen,
  Send,
  LogOut,
  UserCircle,
} from
  'lucide-react';
import { useAppStore } from '../../stores/app';
import { useAuthStore } from '../../stores/auth';
import { t } from '@/lib/i18n';
import { cn } from '../../lib/utils';
import { version as appVersion } from '../../../package.json';
import { ButtonBase } from '@/components/ui/ButtonBase';
import { IconButton } from '@/components/ui/IconButton';
import { Tooltip } from '@/components/ui/Tooltip';
import { Badge } from '@/components/ui/Badge';
import { openUrlInBrowser } from '@/lib/backend/modules/aiProxy';
import { MAIN_TELEGRAM_URL } from '@/lib/links';

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
          'flex items-center transition-all duration-200 rounded-xl group relative',
          collapsed ? 'justify-center px-2 py-2.5 mx-1' : 'gap-3 px-3 py-2.5 mx-2',
          isActive ?
            'bg-white/[0.06] text-white font-semibold' :
            'text-slate-300 hover:text-white hover:bg-white/[0.04]'
        )
      }>

      <span className="shrink-0">{icon}</span>
      {!collapsed &&
        <span className="text-sm tracking-tight animate-in fade-in slide-in-from-left-2 duration-300">
          {label}
        </span>
      }
      {collapsed &&
        <div className="absolute left-full ml-4 px-2 py-1 bg-vsc-sidebar text-white text-xs rounded-md opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 whitespace-nowrap shadow-xl border border-white/10">
          {label}
        </div>
      }
    </NavLink>);
}

export default function Sidebar() {
  const { sidebarCollapsed, toggleSidebar, language } = useAppStore();
  const { enabled: authEnabled, user: authUser, logout: authLogout, busy: authBusy } = useAuthStore();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    queueMicrotask(() => setMounted(true));

    // Auto-collapse sidebar on small screens (< 1200px)
    const handleResize = () => {
      const shouldCollapse = window.innerWidth < 1200;
      const isCollapsed = useAppStore.getState().sidebarCollapsed;
      if (shouldCollapse && !isCollapsed) {
        useAppStore.getState().toggleSidebar();
      }
    };

    window.addEventListener('resize', handleResize);
    handleResize(); // Initial check

    return () => window.removeEventListener('resize', handleResize);
  }, []);

  void language;

  if (!mounted) return null;

  // Role-based visibility: USER sees only /, /accounts, /radar, /friends, /chat.
  // ADMIN sees everything. When auth is disabled, show everything (desktop mode).
  const isAdmin = !authEnabled || authUser?.role === 'admin';

  return (
    <aside
      className={cn(
        'flex flex-col shrink-0 transition-all duration-300 ease-in-out border-r border-white/10 relative z-40 bg-vsc-sidebar-solid/80 backdrop-blur-3xl group',
        sidebarCollapsed ? 'w-16' : 'w-52'
      )}>

      {/* Collapse Toggle Button — integrated into border-right */}
      <ButtonBase
        onClick={toggleSidebar}
        className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 w-5 h-8 rounded-full bg-vsc-sidebar text-slate-400 flex items-center justify-center shadow-lg hover:text-white hover:bg-vsc-panel transition-colors z-50 border border-white/20 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity">

        {sidebarCollapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
      </ButtonBase>

      {/* Logo */}
      <div className={cn('h-20 flex items-center mb-2', sidebarCollapsed ? 'px-3 justify-center' : 'px-5')}>
        <div className="flex items-center gap-3 overflow-hidden">
          <div className="rounded-xl w-10 h-10 flex items-center justify-center shrink-0 bg-gradient-to-br from-indigo-500 to-indigo-700 shadow-xl shadow-indigo-900/40">
            <Terminal className="w-5 h-5 text-white" />
          </div>
          {!sidebarCollapsed &&
            <div className="flex flex-col min-w-0 animate-in fade-in slide-in-from-left-2 duration-500">
              <h1 className="text-white text-base font-black tracking-tighter leading-tight truncate uppercase">{t("common.sidebar.stitch")}

              </h1>
              <span className="text-indigo-400/80 text-[10px] font-bold tracking-widest uppercase">{t("common.sidebar.manager_v")}
                {appVersion}
              </span>
            </div>
          }
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-2 space-y-1 no-scrollbar">
        <NavItem
          to="/"
          icon={<LayoutDashboard size={20} />}
          label={t('sidebar.dashboard')}
          collapsed={sidebarCollapsed} />

        <NavItem
          to="/accounts"
          icon={<Users size={20} />}
          label={t('sidebar.accounts')}
          collapsed={sidebarCollapsed} />

        {isAdmin && (
          <NavItem
            to="/autoreg"
            icon={<RefreshCw size={20} />}
            label={t('sidebar.autoReg')}
            collapsed={sidebarCollapsed} />
        )}

        {isAdmin && (
          <NavItem
            to="/patcher"
            icon={<Code size={20} />}
            label={t('sidebar.idePatch')}
            collapsed={sidebarCollapsed} />
        )}

        {isAdmin && (
          <NavItem
            to="/ai"
            icon={<ShieldCheck size={20} />}
            label={t('sidebar.aiHub')}
            collapsed={sidebarCollapsed} />
        )}

        <NavItem
          to="/radar"
          icon={<Radar size={20} />}
          label={t('sidebar.radar')}
          collapsed={sidebarCollapsed} />

        {isAdmin && (
          <NavItem
            to="/automation"
            icon={<Repeat size={20} />}
            label={t('sidebar.automation')}
            collapsed={sidebarCollapsed} />
        )}

        {isAdmin && (
          <NavItem
            to="/mail"
            icon={<Mail size={20} />}
            label={t('sidebar.mail')}
            collapsed={sidebarCollapsed} />
        )}

        {isAdmin && (
          <NavItem
            to="/tools"
            icon={<Wrench size={20} />}
            label={t('sidebar.tools')}
            collapsed={sidebarCollapsed} />
        )}

        {isAdmin && (
          <NavItem
            to="/totp"
            icon={<KeyRound size={20} />}
            label="2FA"
            collapsed={sidebarCollapsed} />
        )}

        <NavItem
          to="/friends"
          icon={<HeartHandshake size={20} />}
          label={t('sidebar.friends')}
          collapsed={sidebarCollapsed} />

        {isAdmin && (
          <NavItem
            to="/notebooklm"
            icon={<BookOpen size={20} />}
            label={t('sidebar.notebooklm')}
            collapsed={sidebarCollapsed} />
        )}

        {isAdmin && (
          <div className="mx-5 pt-6 mt-6 border-t border-white/5 opacity-80">
            {!sidebarCollapsed &&
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-4">
                {t('sidebar.system')}
              </p>
            }
          </div>
        )}

        {isAdmin && (
          <NavItem
            to="/settings"
            icon={<Settings size={20} />}
            label={t('sidebar.settings')}
            collapsed={sidebarCollapsed} />
        )}

        {isAdmin && (
          <NavItem
            to="/logs"
            icon={<FileText size={20} />}
            label={t('sidebar.logs')}
            collapsed={sidebarCollapsed} />
        )}

        {isAdmin && authEnabled && (
          <NavItem
            to="/users"
            icon={<UserCircle size={20} />}
            label={t('auth.users.title')}
            collapsed={sidebarCollapsed} />
        )}
      </nav>

      {/* Footer */}
      <div className={cn('border-t border-white/5', sidebarCollapsed ? 'p-2 space-y-2' : 'p-4 space-y-2')}>
        {/* Auth user chip + logout — only when auth is enabled */}
        {authEnabled && authUser && (
          <div className={cn(
            'flex items-center rounded-xl bg-white/[0.02] border border-white/5',
            sidebarCollapsed ? 'justify-center px-2 py-2' : 'gap-2 px-3 py-2'
          )}>
            {sidebarCollapsed ? (
              <Tooltip content={`${authUser.username} (${t(`auth.role.${authUser.role}`)})`} side="right">
                <div className="w-7 h-7 rounded-full bg-indigo-500/15 text-indigo-300 flex items-center justify-center shrink-0">
                  <UserCircle className="w-4 h-4" />
                </div>
              </Tooltip>
            ) : (
              <>
                <div className="w-7 h-7 rounded-full bg-indigo-500/15 text-indigo-300 flex items-center justify-center shrink-0">
                  <UserCircle className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0 flex flex-col">
                  <span className="text-xs font-medium text-slate-200 truncate">
                    {authUser.username}
                  </span>
                  <Badge
                    variant={authUser.role === 'admin' ? 'info' : 'default'}
                    size="sm"
                    className="mt-0.5 self-start"
                  >
                    {t(`auth.role.${authUser.role}`)}
                  </Badge>
                </div>
              </>
            )}
            <Tooltip content={t('auth.logout')} side={sidebarCollapsed ? 'right' : 'top'}>
              <IconButton
                onClick={() => void authLogout()}
                size="md"
                variant="ghost"
                disabled={authBusy}
                aria-label={t('auth.logout')}
                className="text-slate-500 hover:text-red-400"
              >
                <LogOut size={16} />
              </IconButton>
            </Tooltip>
          </div>
        )}

        {/* Local mode indicator — hidden when auth is enabled (replaced by user chip) */}
        {!authEnabled && (
          <div
            className={cn(
              'flex items-center rounded-xl bg-white/[0.02] border border-white/5',
              sidebarCollapsed ? 'justify-center px-2 py-2' : 'gap-3 px-3 py-2'
            )}
          >
            {sidebarCollapsed ? (
              <Tooltip content={t('sidebar.localMode')} side="right">
                <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)] animate-pulse" />
              </Tooltip>
            ) : (
              <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)] animate-pulse" />
            )}
            {!sidebarCollapsed &&
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest truncate">
                {t('sidebar.localMode')}
              </span>
            }
          </div>
        )}

        {/* Telegram channel — always visible */}
        <div className={cn('flex', sidebarCollapsed ? 'justify-center' : 'justify-end')}>
          <Tooltip content={t('sidebar.telegramChannel')} side={sidebarCollapsed ? 'right' : 'top'}>
            <IconButton
              onClick={() => void openUrlInBrowser(MAIN_TELEGRAM_URL)}
              size="md"
              variant="ghost"
              aria-label={t('sidebar.telegramChannel')}
            >
              <Send size={16} />
            </IconButton>
          </Tooltip>
        </div>
      </div>
    </aside>);

}