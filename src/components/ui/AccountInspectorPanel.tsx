import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  X,
  Copy,
  RefreshCw,
  Trash2,
  Activity,
  Eye,
  EyeOff,
  Clock,
  Globe,
  Zap,
  FolderOpen,
  Cookie,
  ChevronDown,
  LogIn,
  Gauge,
  AlertTriangle,
  Cpu,
  MoreHorizontal,
  Play,
  Square,
  Mail,
  Archive,
  FileText,
  Save,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn, formatDateTime } from '../../lib/utils';
import { ProviderLogo } from './ProviderLogo';
import { Tooltip } from './Tooltip';
import { Badge } from './Badge';
import { IconButton } from './IconButton';
import { Button } from './Button';
import { ButtonBase } from './ButtonBase';
import { LoadingSpinner } from './LoadingSpinner';
import { TabButton } from './TabButton';
import { Toggle } from './Toggle';
import { AccountProxySection } from './AccountProxySection';
import { AccountProfileSessionSection } from './account-details/AccountProfileSessionSection';
import { TotpBadge } from '../totp/TotpBadge';
import type { Account } from '../../types/generated';
import type { AccountStatusInfo } from '../../types/ui';
import { checkAccountStatus, refreshAccountToken, openInFileManager } from '@/lib/backend';
import { t } from '@/lib/i18n';
import { useCopyToClipboard } from '../../hooks/useCopyToClipboard';
import { useAccountRowData } from '../../hooks/useAccountRow';
import { useTotpStore } from '../../stores/totp';
import { useAccountsStore } from '../../stores/accounts';
import { useUIPreferencesStore } from '../../stores/uiPreferences';

// ── helpers ──────────────────────────────────────────────────────────────────

function formatRelativeTime(dateString?: string | null): string {
  if (!dateString) return 'Never';
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 30) return `${diffDays}d ago`;
  return `${Math.floor(diffDays / 30)}mo ago`;
}

function parseJsonValue(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function isAutoRefreshEnabled(account: Account): boolean {
  if (!account.metadata) return false;
  try {
    const meta = JSON.parse(account.metadata);
    return meta.autoRefreshQuota === true;
  } catch {
    return false;
  }
}

function isKiroProvider(account: Account): boolean {
  return ['kiro', 'kiro_v2'].includes(account.provider?.toLowerCase() ?? '');
}

type InspectorTab = 'overview' | 'session' | 'activity' | 'data' | 'notes';

const TAB_IDS: InspectorTab[] = ['overview', 'session', 'activity', 'data', 'notes'];

// ── props ────────────────────────────────────────────────────────────────────

export interface AccountInspectorPanelProps {
  account: Account;
  isActive: boolean;
  onToggleActive: () => void;
  onOpenBrowser?: (id: number) => void;
  onAuthorizeKiroAccount?: (id: number) => void;
  onOpenProfileSession?: (id: number) => void;
  onConfirmProfileSession?: (id: number) => void;
  onClearProfileSession?: (id: number) => void;
  onToggleAutoRefreshQuota?: (account: Account) => void;
  onCopyRefUrl?: (refUrl: string) => void;
  onRefreshRefUrl?: (id: number) => void;
  onCopyToken: (token: string) => void;
  onUpdate?: (accountId: number, updates: { notes?: string; tags?: string }) => Promise<void>;
  onRequestDelete: (accountId: number) => void;
  onClose: () => void;
  onRefresh?: (id: number) => void;
}

// ── component ─────────────────────────────────────────────────────────────────

export function AccountInspectorPanel({
  account,
  isActive,
  onToggleActive,
  onOpenBrowser,
  onAuthorizeKiroAccount,
  onOpenProfileSession,
  onConfirmProfileSession,
  onClearProfileSession,
  onToggleAutoRefreshQuota,
  onCopyRefUrl,
  onRefreshRefUrl,
  onCopyToken,
  onUpdate,
  onRequestDelete,
  onClose,
  onRefresh,
}: AccountInspectorPanelProps) {
  const { copy } = useCopyToClipboard();
  const navigate = useNavigate();
  const data = useAccountRowData(account);
  const allTotpKeys = useTotpStore(s => s.keys);

  // Local UI state — reset on account change via key={account.id} on outer wrapper
  const [statusInfo, setStatusInfo] = useState<AccountStatusInfo | null>(null);
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isRefreshingToken, setIsRefreshingToken] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [showSessionData, setShowSessionData] = useState(false);
  const [tokenExpiryDiff, setTokenExpiryDiff] = useState<number | null>(() =>
    account.expiresAt ? new Date(account.expiresAt).getTime() - Date.now() : null,
  );

  // Tab state — persisted in componentPreferences
  const [activeTab, setActiveTab] = useState<InspectorTab>(() =>
    useUIPreferencesStore.getState().getComponentPreference<InspectorTab>(
      'accountsInspector.tab',
      'overview',
    ),
  );

  const handleTabChange = (tab: InspectorTab) => {
    setActiveTab(tab);
    useUIPreferencesStore.getState().setComponentPreference('accountsInspector.tab', tab);
  };

  // Escape closes the overflow menu first, not the whole panel.
  // Capture phase + stopPropagation: fires before AccountsTable's bubble-phase
  // window listener, so the panel stays open when the menu was the target.
  useEffect(() => {
    if (!overflowOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOverflowOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [overflowOpen]);

  // Update token expiry periodically (setState in interval callback is async, not in effect body)
  useEffect(() => {
    const expiresAt = account.expiresAt;
    if (!expiresAt) return;
    const update = () =>
      setTokenExpiryDiff(new Date(expiresAt).getTime() - Date.now());
    const id = setInterval(update, 60000);
    return () => clearInterval(id);
  }, [account.expiresAt]);

  const kiro = isKiroProvider(account);
  const cookiesCount = account.cookies
    ? (() => {
        try {
          return JSON.parse(account.cookies).length;
        } catch {
          return 0;
        }
      })()
    : 0;

  const totpKeys = useMemo(
    () =>
      allTotpKeys.filter(
        k => k.enabled && k.accountId === String(account.id),
      ),
    [allTotpKeys, account.id],
  );

  const autoRefreshEnabled = isAutoRefreshEnabled(account);

  // ── actions ─────────────────────────────────────────────────────────────────

  const handleCheckStatus = async () => {
    setIsCheckingStatus(true);
    setStatusError(null);
    try {
      const result = await checkAccountStatus({ accountId: account.id });
      setStatusInfo(result);
      onRefresh?.(account.id);
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsCheckingStatus(false);
    }
  };

  const handleRefreshToken = async () => {
    setIsRefreshingToken(true);
    try {
      await refreshAccountToken({ accountId: account.id });
      toast.success(t('accounts.tokenRefreshed'));
      onRefresh?.(account.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRefreshingToken(false);
    }
  };

  const handleArchive = async () => {
    try {
      await useAccountsStore.getState().archiveAccounts([account.id], true);
      toast.success(t('accounts.archiveSuccess'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('accounts.archiveFailed'));
    }
  };

  const handleOpenLogs = () => {
    useUIPreferencesStore.getState().setLogsSourceFilter(['accounts']);
    useUIPreferencesStore.getState().setLogsSearchQuery(account.email);
    navigate('/logs');
  };

  const handleOpenMail = () => {
    navigate(`/mail?account=${account.id}`);
  };

  // ── overflow menu items ────────────────────────────────────────────────────

  const overflowItems = useMemo(() => {
    const items: { id: string; label: string; icon: React.ReactNode; onSelect: () => void; tone?: 'default' | 'danger'; disabled?: boolean }[] = [
      {
        id: 'copy-email',
        label: t('accounts.quickActions.copyEmail'),
        icon: <Copy size={12} />,
        onSelect: () => copy(account.email, { successMessage: t('accounts.quickActions.emailCopied') }),
      },
    ];
    if (account.registrationPassword) {
      items.push({
        id: 'copy-password',
        label: t('accounts.quickActions.copyPassword'),
        icon: <Eye size={12} />,
        onSelect: () =>
          copy(account.registrationPassword!, {
            sensitive: true,
            successMessage: t('accounts.quickActions.passwordCopied'),
          }),
      });
    }
    if (account.token) {
      items.push({
        id: 'copy-token',
        label: t('accounts.copyToken'),
        icon: <Copy size={12} />,
        onSelect: () => onCopyToken(account.token!),
      });
    }
    return items;
  }, [account, copy, onCopyToken]);

  const refItems = useMemo(() => {
    const items: { id: string; label: string; icon: React.ReactNode; onSelect: () => void }[] = [];
    if (account.refUrl && onCopyRefUrl) {
      items.push({
        id: 'copy-ref',
        label: t('accounts.account_ref_cell.copy_ref_url'),
        icon: <Copy size={12} />,
        onSelect: () => onCopyRefUrl(account.refUrl!),
      });
    }
    if (onRefreshRefUrl) {
      items.push({
        id: 'refresh-ref',
        label: account.refUrl
          ? t('accounts.account_ref_cell.refresh_ref_url')
          : t('accounts.account_ref_cell.get_ref_url'),
        icon: <RefreshCw size={12} />,
        onSelect: () => onRefreshRefUrl(account.id),
      });
    }
    return items;
  }, [account, onCopyRefUrl, onRefreshRefUrl]);

  // ── render ─────────────────────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col border-l border-white/5 bg-vsc-bg">
      {/* ── sticky header ──────────────────────────────────────────────────── */}
      <div className="shrink-0 p-4 border-b border-white/5">
        {/* Row 1: logo + email + status + close */}
        <div className="flex items-center gap-2">
          <ProviderLogo provider={account.provider} size={20} className="shrink-0" />
          <Tooltip content={t('accounts.quickActions.copyEmail')}>
            <button
              onClick={() => copy(account.email, { successMessage: t('accounts.quickActions.emailCopied') })}
              className="flex-1 truncate text-sm font-semibold text-white hover:text-indigo-200 transition-colors text-left"
            >
              {account.email}
            </button>
          </Tooltip>
          <Badge
            variant={account.status === 'active' ? 'success' : account.status === 'banned' ? 'danger' : 'default'}
            size="sm"
            withDot
            className="shrink-0 normal-case tracking-normal"
          >
            {account.status}
          </Badge>
          <IconButton
            type="button"
            size="sm"
            variant="ghost"
            onClick={onClose}
            className="shrink-0 text-slate-400 hover:text-white"
            aria-label={t('common.close')}
          >
            <X size={16} />
          </IconButton>
        </div>
        {/* Row 2: meta line */}
        <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-slate-500 flex-wrap">
          {account.registrationMethod && (
            <span className="text-slate-400">{account.registrationMethod}</span>
          )}
          {account.registrationMethod && (account.createdAt || account.registrationDate) && (
            <span className="text-slate-600">·</span>
          )}
          {(account.createdAt || account.registrationDate) && (
            <span>{formatRelativeTime(account.createdAt || account.registrationDate)}</span>
          )}
          {account.machineId && (
            <>
              <span className="text-slate-600">·</span>
              <Tooltip content={t('accounts.drawer.copyMachineId')}>
                <button
                  onClick={() => copy(account.machineId!, { successMessage: t('accounts.drawer.machineIdCopied') })}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white/[0.04] border border-white/[0.06] hover:border-white/[0.12] hover:bg-white/[0.06] transition-colors font-mono text-[10px] text-slate-300 hover:text-slate-100"
                >
                  <Cpu size={9} className="text-slate-500" />
                  <span className="truncate max-w-[80px]">{account.machineId.slice(-8)}</span>
                </button>
              </Tooltip>
            </>
          )}
        </div>
        {/* Row 3: status strip — quota + token expiry */}
        {((account.quota && account.quota.limit > 0) || account.expiresAt) && (
          <div className="mt-2 flex items-center gap-3">
            {account.quota && account.quota.limit > 0 && (() => {
              const pct = account.quota.limit > 0
                ? Math.min(Math.round(account.quota.used / account.quota.limit * 100), 100)
                : 0;
              const barColor = pct > 90 ? 'bg-red-500' : pct > 75 ? 'bg-amber-500' : 'bg-emerald-500';
              const textColor = pct > 90 ? 'text-red-400' : pct > 75 ? 'text-amber-400' : 'text-emerald-400';
              return (
                <div className="flex items-center gap-1.5 flex-1 min-w-0">
                  <div className="h-1.5 flex-1 rounded-full bg-white/[0.04] overflow-hidden">
                    <div className={cn('h-full rounded-full transition-all', barColor)} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-[10px] text-slate-400 tabular-nums shrink-0">
                    {account.quota.used}/{account.quota.limit}
                  </span>
                  <span className={cn('text-[10px] font-bold tabular-nums shrink-0', textColor)}>{pct}%</span>
                </div>
              );
            })()}
            {account.expiresAt && tokenExpiryDiff != null && (
              <div className="flex items-center gap-1 shrink-0">
                <Clock size={11} className="text-slate-500" />
                {tokenExpiryDiff <= 0 ? (
                  <span className="text-[10px] text-red-400">{t('accounts.drawer.tokenExpired')}</span>
                ) : tokenExpiryDiff < 86400000 ? (
                  <span className="text-[10px] text-amber-400">
                    {t('accounts.inspector.tokenHoursRemaining', { hours: Math.floor(tokenExpiryDiff / 3600000) })}
                  </span>
                ) : (
                  <span className="text-[10px] text-slate-300">
                    {t('accounts.inspector.tokenDaysRemaining', { days: Math.floor(tokenExpiryDiff / 86400000) })}
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── action bar ─────────────────────────────────────────────────────── */}
      <div className="shrink-0 px-4 py-2 border-b border-white/5 flex items-center gap-1">
        <Button
          type="button"
          size="sm"
          variant={isActive ? 'secondary' : 'primary'}
          onClick={onToggleActive}
          leftIcon={isActive ? <Square size={12} /> : <Play size={12} />}
        >
          {isActive ? t('accounts.deactivate') : t('accounts.activate')}
        </Button>

        {onOpenBrowser && (
          <Tooltip content={t('accounts.quickActions.openBrowser')}>
            <IconButton
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 w-7 text-slate-400 hover:text-blue-400 hover:bg-white/10"
              onClick={() => onOpenBrowser(account.id)}
            >
              <Globe size={14} />
            </IconButton>
          </Tooltip>
        )}
        {kiro && onAuthorizeKiroAccount && (
          <Tooltip content={t('accounts.quickActions.authorizeIde')}>
            <IconButton
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 w-7 text-slate-400 hover:text-emerald-400 hover:bg-white/10"
              onClick={() => onAuthorizeKiroAccount(account.id)}
            >
              <Zap size={14} />
            </IconButton>
          </Tooltip>
        )}
        <Tooltip content={t('accounts.drawer.checkStatus')}>
          <IconButton
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 w-7 text-slate-400 hover:text-cyan-400 hover:bg-white/10"
            disabled={isCheckingStatus}
            onClick={handleCheckStatus}
          >
            {isCheckingStatus ? <LoadingSpinner size="xs" /> : <Activity size={14} />}
          </IconButton>
        </Tooltip>
        <Tooltip content={t('accounts.refreshToken')}>
          <IconButton
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 w-7 text-slate-400 hover:text-indigo-400 hover:bg-white/10"
            disabled={isRefreshingToken || !account.refreshToken}
            onClick={handleRefreshToken}
          >
            {isRefreshingToken ? <LoadingSpinner size="xs" /> : <RefreshCw size={14} />}
          </IconButton>
        </Tooltip>

        {/* Overflow menu */}
        <div className="ml-auto relative">
          <IconButton
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 w-7 text-slate-400 hover:text-white hover:bg-white/10"
            onClick={() => setOverflowOpen(v => !v)}
            aria-label={t('common.actions')}
          >
            <MoreHorizontal size={14} />
          </IconButton>
          {overflowOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setOverflowOpen(false)} />
              <div
                className="absolute right-0 top-8 z-50 w-56 rounded-lg border border-white/10 bg-vsc-panel p-1 shadow-xl shadow-black/50"
                data-row-actions-menu="true"
              >
                {overflowItems.map(item => (
                  <ButtonBase
                    key={item.id}
                    type="button"
                    className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-slate-200 hover:bg-white/5"
                    onClick={() => { item.onSelect(); setOverflowOpen(false); }}
                  >
                    {item.icon}
                    {item.label}
                  </ButtonBase>
                ))}
                <div className="my-1 h-px bg-white/10" />
                <ButtonBase
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-slate-200 hover:bg-white/5"
                  onClick={() => { handleOpenMail(); setOverflowOpen(false); }}
                >
                  <Mail size={12} />
                  {t('accounts.inspector.openMail')}
                </ButtonBase>
                {refItems.length > 0 && (
                  <>
                    <div className="my-1 h-px bg-white/10" />
                    {refItems.map(item => (
                      <ButtonBase
                        key={item.id}
                        type="button"
                        className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-slate-200 hover:bg-white/5"
                        onClick={() => { item.onSelect(); setOverflowOpen(false); }}
                      >
                        {item.icon}
                        {item.label}
                      </ButtonBase>
                    ))}
                  </>
                )}
                <div className="my-1 h-px bg-white/10" />
                <ButtonBase
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-slate-200 hover:bg-white/5"
                  onClick={() => { handleArchive(); setOverflowOpen(false); }}
                >
                  <Archive size={12} />
                  {t('accounts.inspector.archive')}
                </ButtonBase>
                <ButtonBase
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs text-rose-300 hover:bg-rose-500/10"
                  onClick={() => { onRequestDelete(account.id); setOverflowOpen(false); }}
                >
                  <Trash2 size={12} />
                  {t('common.delete')}
                </ButtonBase>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── tabs strip ─────────────────────────────────────────────────────── */}
      <div className="shrink-0 px-2 py-1.5 border-b border-white/5 flex items-center gap-1 overflow-x-auto scrollbar-none">
        {TAB_IDS.map(tabId => (
          <TabButton
            key={tabId}
            active={activeTab === tabId}
            onClick={() => handleTabChange(tabId)}
            size="sm"
            label={t(`accounts.inspector.tabs.${tabId}`)}
          />
        ))}
      </div>

      {/* ── tab content ────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {activeTab === 'overview' && (
          <OverviewTab
            account={account}
            showToken={showToken}
            setShowToken={setShowToken}
            showPassword={showPassword}
            setShowPassword={setShowPassword}
            isRefreshingToken={isRefreshingToken}
            handleRefreshToken={handleRefreshToken}
            onCopyToken={onCopyToken}
            copy={copy}
            statusInfo={statusInfo}
            statusError={statusError}
            kiro={kiro}
            totpKeys={totpKeys}
          />
        )}
        {activeTab === 'session' && (
          <SessionTab
            account={account}
            cookiesCount={cookiesCount}
            showSessionData={showSessionData}
            setShowSessionData={setShowSessionData}
            copy={copy}
            data={data}
            onOpenProfileSession={onOpenProfileSession}
            onConfirmProfileSession={onConfirmProfileSession}
            onClearProfileSession={onClearProfileSession}
            onRefresh={onRefresh}
          />
        )}
        {activeTab === 'activity' && (
          <ActivityTab
            account={account}
            autoRefreshEnabled={autoRefreshEnabled}
            onToggleAutoRefreshQuota={onToggleAutoRefreshQuota}
            onOpenLogs={handleOpenLogs}
          />
        )}
        {activeTab === 'data' && <DataTab account={account} />}
        {activeTab === 'notes' && (
          <NotesTab account={account} onUpdate={onUpdate} />
        )}
      </div>
    </div>
  );
}

// ── Overview tab ──────────────────────────────────────────────────────────────

interface OverviewTabProps {
  account: Account;
  showToken: boolean;
  setShowToken: (v: boolean) => void;
  showPassword: boolean;
  setShowPassword: (v: boolean) => void;
  isRefreshingToken: boolean;
  handleRefreshToken: () => void;
  onCopyToken: (token: string) => void;
  copy: (text: string, opts?: { sensitive?: boolean; successMessage?: string }) => void;
  statusInfo: AccountStatusInfo | null;
  statusError: string | null;
  kiro: boolean;
  totpKeys: { secret: string; period: number }[];
}

function OverviewTab({
  account,
  showToken,
  setShowToken,
  showPassword,
  setShowPassword,
  isRefreshingToken,
  handleRefreshToken,
  onCopyToken,
  copy,
  statusInfo,
  statusError,
  kiro,
  totpKeys,
}: OverviewTabProps) {
  return (
    <>
      {/* Credentials */}
      <div className="rounded-lg bg-white/[0.02] border border-white/10 overflow-hidden">
        <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-medium px-3 pt-2.5 pb-2 border-b border-white/[0.04]">
          {t('accounts.drawer.credentials')}
        </h3>
        <div className="divide-y divide-white/[0.04]">
          {/* Email */}
          <div className="flex items-center justify-between gap-2 px-3 py-1.5">
            <span className="text-[11px] text-slate-500 shrink-0 w-20">{t('accounts.email')}</span>
            <div className="flex items-center gap-1 min-w-0 flex-1 justify-end">
              <span className="text-xs text-slate-200 truncate">{account.email}</span>
              <IconButton type="button" size="sm" variant="ghost" className="h-5 w-5 shrink-0 text-slate-500 hover:text-white"
                onClick={() => copy(account.email, { successMessage: t('accounts.quickActions.emailCopied') })}>
                <Copy size={10} />
              </IconButton>
            </div>
          </div>
          {/* Password */}
          <div className="flex items-center justify-between gap-2 px-3 py-1.5">
            <span className="text-[11px] text-slate-500 shrink-0 w-20">{t('accounts.password')}</span>
            <div className="flex items-center gap-1 min-w-0 flex-1 justify-end">
              {account.registrationPassword ? (
                <>
                  <span className="text-xs text-slate-200 font-mono truncate">
                    {showPassword ? account.registrationPassword : '••••••••'}
                  </span>
                  <IconButton type="button" size="sm" variant="ghost" className="h-5 w-5 shrink-0 text-slate-500 hover:text-white"
                    onClick={() => setShowPassword(!showPassword)}>
                    {showPassword ? <EyeOff size={10} /> : <Eye size={10} />}
                  </IconButton>
                  <IconButton type="button" size="sm" variant="ghost" className="h-5 w-5 shrink-0 text-slate-500 hover:text-white"
                    onClick={() => copy(account.registrationPassword!, { sensitive: true, successMessage: t('accounts.quickActions.passwordCopied') })}>
                    <Copy size={10} />
                  </IconButton>
                </>
              ) : (
                <span className="text-[11px] text-slate-600 italic">{t('accounts.drawer.noData')}</span>
              )}
            </div>
          </div>
          {/* Token */}
          <div className="flex items-center justify-between gap-2 px-3 py-1.5">
            <span className="text-[11px] text-slate-500 shrink-0 w-20">{t('accounts.authToken')}</span>
            <div className="flex items-center gap-1 min-w-0 flex-1 justify-end">
              {account.token ? (
                <>
                  <span className="text-xs text-slate-200 font-mono truncate max-w-[140px]">
                    {showToken ? account.token : '••••••••••••'}
                  </span>
                  <IconButton type="button" size="sm" variant="ghost" className="h-5 w-5 shrink-0 text-slate-500 hover:text-white"
                    onClick={() => setShowToken(!showToken)}>
                    {showToken ? <EyeOff size={10} /> : <Eye size={10} />}
                  </IconButton>
                  <IconButton type="button" size="sm" variant="ghost" className="h-5 w-5 shrink-0 text-slate-500 hover:text-white"
                    onClick={() => onCopyToken(account.token!)}>
                    <Copy size={10} />
                  </IconButton>
                  {account.refreshToken && (
                    <IconButton type="button" size="sm" variant="ghost" className="h-5 w-5 shrink-0 text-slate-500 hover:text-indigo-400"
                      disabled={isRefreshingToken} onClick={handleRefreshToken}>
                      <RefreshCw size={10} />
                    </IconButton>
                  )}
                </>
              ) : (
                <span className="text-[11px] text-slate-600 italic">{t('accounts.drawer.noData')}</span>
              )}
            </div>
          </div>
          {/* Machine ID */}
          <div className="flex items-center justify-between gap-2 px-3 py-1.5">
            <span className="text-[11px] text-slate-500 shrink-0 w-20">{t('accounts.machineId')}</span>
            <div className="flex items-center gap-1 min-w-0 flex-1 justify-end">
              {account.machineId ? (
                <>
                  <span className="text-[10px] text-slate-300 font-mono truncate">{account.machineId}</span>
                  <IconButton type="button" size="sm" variant="ghost" className="h-5 w-5 shrink-0 text-slate-500 hover:text-white"
                    onClick={() => copy(account.machineId!, { successMessage: t('accounts.drawer.machineIdCopied') })}>
                    <Copy size={10} />
                  </IconButton>
                </>
              ) : (
                <span className="text-[11px] text-slate-600 italic">{t('accounts.drawer.noData')}</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Stats 2x2 Grid */}
      <div className="rounded-lg bg-white/[0.02] border border-white/10 overflow-hidden">
        <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-medium px-3 pt-2.5 pb-2 border-b border-white/[0.04]">
          {t('accounts.drawer.statsTitle')}
        </h3>
        <div className="grid grid-cols-2 divide-x divide-y divide-white/[0.04]">
          <div className="p-2.5 flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-indigo-500/10 border border-indigo-500/15 flex items-center justify-center shrink-0">
              <Activity size={13} className="text-indigo-300" />
            </div>
            <div className="min-w-0">
              <p className="text-[9px] text-slate-500 uppercase tracking-wide">{t('accounts.activations')}</p>
              <p className="text-sm font-semibold text-white tabular-nums">{account.useCount || 0}</p>
            </div>
          </div>
          <div className="p-2.5 flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-sky-500/10 border border-sky-500/15 flex items-center justify-center shrink-0">
              <LogIn size={13} className="text-sky-300" />
            </div>
            <div className="min-w-0">
              <p className="text-[9px] text-slate-500 uppercase tracking-wide">{t('accounts.logins')}</p>
              <p className="text-sm font-semibold text-white tabular-nums">{account.loginCount || 0}</p>
            </div>
          </div>
          <div className="p-2.5 flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-emerald-500/10 border border-emerald-500/15 flex items-center justify-center shrink-0">
              <Gauge size={13} className="text-emerald-300" />
            </div>
            <div className="min-w-0">
              <p className="text-[9px] text-slate-500 uppercase tracking-wide">{t('accounts.successRate')}</p>
              <p className={cn(
                'text-sm font-semibold tabular-nums',
                account.successRate == null && 'text-slate-500',
                account.successRate >= 0.9 && 'text-emerald-400',
                account.successRate >= 0.7 && account.successRate < 0.9 && 'text-amber-400',
                account.successRate < 0.7 && account.useCount > 0 && 'text-red-400',
                !account.useCount && 'text-slate-500',
              )}>
                {account.successRate == null ? '—' : account.useCount > 0 ? `${Math.round(account.successRate * 100)}%` : '—'}
              </p>
            </div>
          </div>
          <div className="p-2.5 flex items-center gap-2">
            <div className={cn(
              'w-7 h-7 rounded-md flex items-center justify-center shrink-0 border',
              account.errorCount > 0 ? 'bg-red-500/10 border-red-500/15' : 'bg-white/[0.04] border-white/[0.06]',
            )}>
              <AlertTriangle size={13} className={account.errorCount > 0 ? 'text-red-300' : 'text-slate-500'} />
            </div>
            <div className="min-w-0">
              <p className="text-[9px] text-slate-500 uppercase tracking-wide">{t('accounts.errorsLabel')}</p>
              {account.errorCount > 0 ? (
                <div className="flex items-center gap-1">
                  <p className="text-sm font-semibold text-red-400 tabular-nums">{account.errorCount}</p>
                  {account.lastError && (
                    <Tooltip content={account.lastError}>
                      <span className="text-[10px] text-slate-500 truncate max-w-[60px] cursor-help underline decoration-dotted underline-offset-2">
                        {account.lastError}
                      </span>
                    </Tooltip>
                  )}
                </div>
              ) : (
                <p className="text-sm font-semibold text-slate-400 tabular-nums">0</p>
              )}
            </div>
          </div>
        </div>
        {account.lastLoginAt && (
          <div className="px-3 py-1.5 border-t border-white/[0.04] flex items-center justify-between">
            <span className="text-[10px] text-slate-500">{t('accounts.drawer.lastLogin')}</span>
            <span className="text-[11px] text-slate-300">{formatRelativeTime(account.lastLoginAt)}</span>
          </div>
        )}
      </div>

      {/* TOTP section */}
      {totpKeys.length > 0 && (
        <div className="rounded-lg bg-white/[0.02] border border-white/10 px-3 py-2.5">
          <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-medium mb-2">TOTP</h3>
          <div className="space-y-2">
            {totpKeys.map((key, idx) => (
              <TotpBadge key={idx} secret={key.secret} period={key.period} variant="compact" />
            ))}
          </div>
        </div>
      )}

      {/* Live status */}
      {statusError && (
        <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded px-3 py-2">
          {statusError}
        </div>
      )}
      {statusInfo && (
        <div className="p-3 rounded-lg bg-white/[0.02] border border-white/10 space-y-2">
          <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-medium flex items-center gap-1.5">
            <Activity size={10} />
            {t('accounts.liveStatus')}
          </h3>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <div className="text-slate-500 text-[10px]">{t('accounts.plan')}</div>
              <div className="text-slate-200 font-medium">{statusInfo.plan}</div>
            </div>
            <div>
              <div className="text-slate-500 text-[10px]">{t('common.status')}</div>
              <div className={cn('font-medium', statusInfo.isActive ? 'text-emerald-400' : 'text-red-400')}>
                {statusInfo.isActive ? t('status.active') : t('status.offline')}
              </div>
            </div>
            <div className="col-span-2">
              <div className="text-slate-500 text-[10px]">{t('accounts.quotaUsage')}</div>
              <div className="text-xs text-slate-300">
                {!statusInfo.isActive && statusInfo.quotaLimit === 0 ? (
                  <span className="text-red-400">{t('usageBar.errorBanned')}</span>
                ) : statusInfo.quotaLimit < 0 ? (
                  <span className="text-emerald-400">{t('usageBar.unlimited')}</span>
                ) : (
                  <>{account.provider?.toLowerCase() === 'fireworks' ? '~' : ''}{statusInfo.quotaUsed} / {statusInfo.quotaLimit} ({Math.round(statusInfo.quotaPercent)}%)</>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Billing (kiro only) */}
      {kiro && (
        <div className="rounded-lg bg-white/[0.02] border border-white/10 overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-3 py-1.5">
            <span className="text-[11px] text-slate-500 shrink-0 w-20">{t('accounts.drawer.billing')}</span>
            <Badge variant="default" size="sm" className="normal-case tracking-normal">
              {statusInfo?.plan || t('accounts.drawer.noData')}
            </Badge>
          </div>
        </div>
      )}
    </>
  );
}

// ── Session tab ───────────────────────────────────────────────────────────────

interface SessionTabProps {
  account: Account;
  cookiesCount: number;
  showSessionData: boolean;
  setShowSessionData: (v: boolean) => void;
  copy: (text: string, opts?: { sensitive?: boolean; successMessage?: string }) => void;
  data: ReturnType<typeof useAccountRowData>;
  onOpenProfileSession?: (id: number) => void;
  onConfirmProfileSession?: (id: number) => void;
  onClearProfileSession?: (id: number) => void;
  onRefresh?: (id: number) => void;
}

function SessionTab({
  account,
  cookiesCount,
  showSessionData,
  setShowSessionData,
  copy,
  data,
  onOpenProfileSession,
  onConfirmProfileSession,
  onClearProfileSession,
  onRefresh,
}: SessionTabProps) {
  const formatSessionJSON = (jsonString: string | null): string => {
    if (!jsonString) return t('accounts.notAvailable');
    try {
      return JSON.stringify(JSON.parse(jsonString), null, 2);
    } catch {
      return jsonString;
    }
  };

  return (
    <>
      {/* Session & Profile */}
      <div className="rounded-lg bg-white/[0.02] border border-white/10 overflow-hidden">
        <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-medium px-3 pt-2.5 pb-2 border-b border-white/[0.04]">
          {t('accounts.drawer.sessionProfile')}
        </h3>
        <div className="divide-y divide-white/[0.04]">
          {/* Browser Profile */}
          <div className="flex items-center justify-between gap-2 px-3 py-1.5">
            <span className="text-[11px] text-slate-500 shrink-0 w-20">{t('accounts.browserProfilePath')}</span>
            <div className="flex items-center gap-1 min-w-0 flex-1 justify-end">
              {account.browserProfilePath ? (
                <>
                  <FolderOpen size={11} className="text-slate-500 shrink-0" />
                  <span className="text-[10px] text-slate-300 font-mono truncate max-w-[180px]" title={account.browserProfilePath}>
                    {account.browserProfilePath.split(/[/\\]/).slice(-2).join('/')}
                  </span>
                  <Tooltip content={t('accounts.drawer.openFolder')}>
                    <IconButton type="button" size="sm" variant="ghost" className="h-5 w-5 shrink-0 text-slate-500 hover:text-white"
                      onClick={() => { void openInFileManager({ path: account.browserProfilePath! }); }}>
                      <FolderOpen size={10} />
                    </IconButton>
                  </Tooltip>
                </>
              ) : (
                <span className="text-[11px] text-slate-600 italic">{t('accounts.drawer.noData')}</span>
              )}
            </div>
          </div>
          {/* Cookies */}
          <div className="flex items-center justify-between gap-2 px-3 py-1.5">
            <span className="text-[11px] text-slate-500 shrink-0 w-20">{t('accounts.drawer.cookies')}</span>
            <div className="flex items-center gap-1">
              {cookiesCount > 0 ? (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/15 text-[10px] text-amber-300">
                  <Cookie size={9} />
                  {cookiesCount} {t('accounts.drawer.cookies')}
                </span>
              ) : (
                <span className="text-[11px] text-slate-600 italic">{t('accounts.drawer.noCookies')}</span>
              )}
            </div>
          </div>
          {/* Session Status */}
          <div className="flex items-center justify-between gap-2 px-3 py-1.5">
            <span className="text-[11px] text-slate-500 shrink-0 w-20">{t('accounts.drawer.session')}</span>
            <Badge variant={account.sessionData ? 'success' : 'default'} size="sm" withDot className="normal-case tracking-normal">
              {account.sessionData ? t('status.active') : t('status.offline')}
            </Badge>
          </div>
        </div>
      </div>

      {/* Session data with show/copy */}
      {account.sessionData && (
        <div className="rounded-lg bg-white/[0.02] border border-white/10 overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-3 pt-2.5 pb-2 border-b border-white/[0.04]">
            <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">{t('accounts.sessionData')}</h3>
            <div className="flex items-center gap-2">
              {showSessionData && (
                <ButtonBase
                  onClick={() => copy(account.sessionData!, { sensitive: true, successMessage: t('common.copy') })}
                  className="text-[10px] font-bold uppercase tracking-widest text-slate-400 hover:text-white transition-colors"
                >
                  {t('common.copy')}
                </ButtonBase>
              )}
              <ButtonBase
                onClick={() => setShowSessionData(!showSessionData)}
                className={cn(
                  'text-[10px] font-bold uppercase tracking-widest transition-colors',
                  showSessionData ? 'text-amber-300 hover:text-amber-200' : 'text-slate-400 hover:text-white',
                )}
              >
                {showSessionData ? t('accounts.hide') : t('accounts.reveal')}
              </ButtonBase>
            </div>
          </div>
          {!showSessionData ? (
            <div className="text-[10px] font-mono p-2 bg-black/20 text-slate-500">
              {t('accounts.sessionDataHidden')}
            </div>
          ) : (
            <pre className="text-[10px] font-mono p-2 bg-black/20 text-slate-400 overflow-auto max-h-32 whitespace-pre-wrap break-all">
              {formatSessionJSON(account.sessionData)}
            </pre>
          )}
        </div>
      )}

      {/* Profile session controls */}
      <AccountProfileSessionSection
        tagsList={data.tags}
        onOpenProfileSession={onOpenProfileSession ? () => onOpenProfileSession(account.id) : undefined}
        onConfirmProfileSession={onConfirmProfileSession ? () => onConfirmProfileSession(account.id) : undefined}
        onClearProfileSession={onClearProfileSession ? () => onClearProfileSession(account.id) : undefined}
        compact
      />

      {/* Proxy — rendered directly, not inside CollapsibleSection */}
      <div>
        <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-medium mb-2">
          {t('accounts.drawer.proxy')}
        </h3>
        <AccountProxySection
          accountId={account.id}
          proxyId={account.proxyId}
          onProxyChanged={() => onRefresh?.(account.id)}
        />
      </div>
    </>
  );
}

// ── Activity tab ──────────────────────────────────────────────────────────────

interface ActivityTabProps {
  account: Account;
  autoRefreshEnabled: boolean;
  onToggleAutoRefreshQuota?: (account: Account) => void;
  onOpenLogs: () => void;
}

function ActivityTab({ account, autoRefreshEnabled, onToggleAutoRefreshQuota, onOpenLogs }: ActivityTabProps) {
  return (
    <>
      {/* Last error prominent block */}
      {account.lastError && (
        <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2.5">
          <div className="flex items-center gap-1.5 mb-1">
            <AlertTriangle size={12} className="text-red-400 shrink-0" />
            <span className="text-[10px] uppercase tracking-wider text-red-400/70 font-medium">
              {t('accounts.lastError')}
            </span>
          </div>
          <p className="text-xs text-red-300 break-words">{account.lastError}</p>
        </div>
      )}

      {/* Activity rows */}
      <div className="rounded-lg bg-white/[0.02] border border-white/10 overflow-hidden">
        <div className="divide-y divide-white/[0.04]">
          <div className="flex items-center justify-between gap-2 px-3 py-2">
            <span className="text-[11px] text-slate-500">{t('accounts.inspector.useCount')}</span>
            <span className="text-xs text-slate-200 tabular-nums">{account.useCount || 0}</span>
          </div>
          <div className="flex items-center justify-between gap-2 px-3 py-2">
            <span className="text-[11px] text-slate-500">{t('accounts.inspector.loginCount')}</span>
            <span className="text-xs text-slate-200 tabular-nums">{account.loginCount || 0}</span>
          </div>
          <div className="flex items-center justify-between gap-2 px-3 py-2">
            <span className="text-[11px] text-slate-500">{t('accounts.errorsLabel')}</span>
            <span className={cn('text-xs tabular-nums', account.errorCount > 0 ? 'text-red-400' : 'text-slate-200')}>
              {account.errorCount || 0}
            </span>
          </div>
          {account.lastLoginAt && (
            <div className="flex items-center justify-between gap-2 px-3 py-2">
              <span className="text-[11px] text-slate-500">{t('accounts.lastLoginAt')}</span>
              <span className="text-xs text-slate-300">{formatRelativeTime(account.lastLoginAt)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Auto-refresh quota toggle */}
      {onToggleAutoRefreshQuota && (
        <div className="rounded-lg bg-white/[0.02] border border-white/10 px-3 py-2.5">
          <Toggle
            label={t('accounts.inspector.autoRefreshQuota')}
            checked={autoRefreshEnabled}
            onChange={() => onToggleAutoRefreshQuota(account)}
            size="sm"
          />
        </div>
      )}

      {/* Open logs button */}
      <ButtonBase
        type="button"
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-slate-300 hover:bg-white/5 hover:text-white transition-colors"
        onClick={onOpenLogs}
      >
        <FileText size={12} />
        {t('accounts.inspector.openLogsForAccount')}
      </ButtonBase>
    </>
  );
}

// ── Data tab ──────────────────────────────────────────────────────────────────

function DataTab({ account }: { account: Account }) {
  const registrationMetadata = useMemo(() => parseJsonValue(account.registrationMetadata), [account.registrationMetadata]);
  const patchConfig = useMemo(() => parseJsonValue(account.patchConfig), [account.patchConfig]);
  const providerMetadata = useMemo(() => parseJsonValue(account.providerMetadata), [account.providerMetadata]);

  const hasRegMeta = Object.keys(registrationMetadata).length > 0;
  const hasPatchConfig = Object.keys(patchConfig).length > 0;
  const hasProviderMeta = Object.keys(providerMetadata).length > 0;

  return (
    <>
      {/* Registration info */}
      <div className="rounded-lg bg-white/[0.02] border border-white/10 overflow-hidden">
        <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-medium px-3 pt-2.5 pb-2 border-b border-white/[0.04]">
          {t('accounts.registrationInfo')}
        </h3>
        <div className="divide-y divide-white/[0.04]">
          {account.registrationMethod && (
            <div className="flex items-center justify-between gap-2 px-3 py-1.5">
              <span className="text-[11px] text-slate-500">{t('accounts.registrationMethod')}</span>
              <span className={cn(
                'px-1.5 py-0.5 rounded text-[10px] font-medium',
                account.registrationMethod === 'auto' && 'bg-indigo-500/20 text-indigo-400',
                account.registrationMethod === 'manual' && 'bg-slate-500/20 text-slate-400',
                account.registrationMethod === 'oauth' && 'bg-emerald-500/20 text-emerald-400',
              )}>
                {account.registrationMethod}
              </span>
            </div>
          )}
          {account.registrationDate && (
            <div className="flex items-center justify-between gap-2 px-3 py-1.5">
              <span className="text-[11px] text-slate-500">{t('accounts.registeredLabel')}</span>
              <span className="text-xs text-slate-300">{formatDateTime(account.registrationDate)}</span>
            </div>
          )}
          {account.lastLoginAt && (
            <div className="flex items-center justify-between gap-2 px-3 py-1.5">
              <span className="text-[11px] text-slate-500">{t('accounts.lastLogin')}</span>
              <span className="text-xs text-slate-300">{formatRelativeTime(account.lastLoginAt)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Registration metadata */}
      {hasRegMeta && (
        <div className="rounded-lg bg-white/[0.02] border border-white/10 overflow-hidden">
          <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-medium px-3 pt-2.5 pb-2 border-b border-white/[0.04]">
            {t('accounts.inspector.registrationMetadata')}
          </h3>
          <div className="divide-y divide-white/[0.04]">
            {Object.entries(registrationMetadata).map(([key, value]) => (
              <div key={key} className="flex items-center justify-between gap-2 px-3 py-1.5">
                <span className="text-[11px] text-slate-500 truncate">{key}</span>
                <span className="text-xs text-slate-300 truncate max-w-[60%] text-right">
                  {typeof value === 'string' ? value : JSON.stringify(value)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Patch block */}
      {(account.patchAppliedAt || hasPatchConfig) && (
        <div className="rounded-lg bg-white/[0.02] border border-white/10 overflow-hidden">
          <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-medium px-3 pt-2.5 pb-2 border-b border-white/[0.04]">
            {t('accounts.inspector.patchInfo')}
          </h3>
          <div className="divide-y divide-white/[0.04]">
            {account.patchAppliedAt && (
              <div className="flex items-center justify-between gap-2 px-3 py-1.5">
                <span className="text-[11px] text-slate-500">{t('accounts.inspector.patchAppliedAt')}</span>
                <span className="text-xs text-slate-300">{formatDateTime(account.patchAppliedAt)}</span>
              </div>
            )}
            {hasPatchConfig && (
              <div className="px-3 py-1.5">
                <span className="text-[11px] text-slate-500 block mb-1">{t('accounts.inspector.patchConfig')}</span>
                <pre className="text-[10px] font-mono p-2 bg-black/20 rounded text-slate-400 overflow-auto max-h-32 whitespace-pre-wrap break-all">
                  {JSON.stringify(patchConfig, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Region + provider type/subtype */}
      <div className="rounded-lg bg-white/[0.02] border border-white/10 overflow-hidden">
        <div className="divide-y divide-white/[0.04]">
          {account.accountRegion && (
            <div className="flex items-center justify-between gap-2 px-3 py-1.5">
              <span className="text-[11px] text-slate-500">{t('accounts.inspector.accountRegion')}</span>
              <span className="text-xs text-slate-300">{account.accountRegion}</span>
            </div>
          )}
          {account.providerType && (
            <div className="flex items-center justify-between gap-2 px-3 py-1.5">
              <span className="text-[11px] text-slate-500">{t('accounts.inspector.providerType')}</span>
              <span className="text-xs text-slate-300">{account.providerType}</span>
            </div>
          )}
          {account.providerSubtype && (
            <div className="flex items-center justify-between gap-2 px-3 py-1.5">
              <span className="text-[11px] text-slate-500">{t('accounts.inspector.providerSubtype')}</span>
              <span className="text-xs text-slate-300">{account.providerSubtype}</span>
            </div>
          )}
        </div>
      </div>

      {/* Provider metadata */}
      {hasProviderMeta && (
        <div className="rounded-lg bg-white/[0.02] border border-white/10 overflow-hidden">
          <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-medium px-3 pt-2.5 pb-2 border-b border-white/[0.04]">
            {t('accounts.inspector.providerMetadata')}
          </h3>
          <div className="divide-y divide-white/[0.04]">
            {Object.entries(providerMetadata).map(([key, value]) => (
              <div key={key} className="flex items-center justify-between gap-2 px-3 py-1.5">
                <span className="text-[11px] text-slate-500 truncate">{key}</span>
                <span className="text-xs text-slate-300 truncate max-w-[60%] text-right">
                  {typeof value === 'string' ? value : JSON.stringify(value)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Referral block */}
      {(account.refCode || account.refUsedCount != null || account.refMaxCount != null || account.referredById) && (
        <div className="rounded-lg bg-white/[0.02] border border-white/10 overflow-hidden">
          <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-medium px-3 pt-2.5 pb-2 border-b border-white/[0.04]">
            {t('accounts.inspector.referralBlock')}
          </h3>
          <div className="divide-y divide-white/[0.04]">
            {account.refCode && (
              <div className="flex items-center justify-between gap-2 px-3 py-1.5">
                <span className="text-[11px] text-slate-500">{t('accounts.inspector.refCode')}</span>
                <span className="text-xs text-slate-300 font-mono">{account.refCode}</span>
              </div>
            )}
            {(account.refUsedCount != null || account.refMaxCount != null) && (
              <div className="flex items-center justify-between gap-2 px-3 py-1.5">
                <span className="text-[11px] text-slate-500">{t('accounts.inspector.refUsed')}</span>
                <span className="text-xs text-slate-300 tabular-nums">
                  {account.refUsedCount ?? 0} / {account.refMaxCount ?? '—'}
                </span>
              </div>
            )}
            {account.referredById && (
              <div className="flex items-center justify-between gap-2 px-3 py-1.5">
                <span className="text-[11px] text-slate-500">{t('accounts.inspector.referredBy')}</span>
                <span className="text-xs text-slate-300 font-mono">{account.referredById}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Timestamps */}
      <div className="rounded-lg bg-white/[0.02] border border-white/10 overflow-hidden">
        <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-medium px-3 pt-2.5 pb-2 border-b border-white/[0.04]">
          {t('accounts.inspector.timestamps')}
        </h3>
        <div className="divide-y divide-white/[0.04]">
          <div className="flex items-center justify-between gap-2 px-3 py-1.5">
              <span className="text-[11px] text-slate-500">{t('accounts.inspector.createdAt')}</span>
              <span className="text-xs text-slate-300">{formatDateTime(account.createdAt)}</span>
            </div>
          {account.updatedAt && (
            <div className="flex items-center justify-between gap-2 px-3 py-1.5">
              <span className="text-[11px] text-slate-500">{t('accounts.inspector.updatedAt')}</span>
              <span className="text-xs text-slate-300">{formatDateTime(account.updatedAt)}</span>
            </div>
          )}
          {account.lastUsedAt && (
            <div className="flex items-center justify-between gap-2 px-3 py-1.5">
              <span className="text-[11px] text-slate-500">{t('accounts.inspector.lastUsedAt')}</span>
              <span className="text-xs text-slate-300">{formatDateTime(account.lastUsedAt)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Debug JSON accordion */}
      {account.metadata && (() => {
        try {
          return Object.keys(JSON.parse(account.metadata)).length > 0;
        } catch {
          return false;
        }
      })() && (
        <details className="group">
          <summary className="flex items-center justify-between p-2 cursor-pointer hover:bg-white/5 rounded-lg transition-colors">
            <span className="text-[10px] uppercase tracking-wider text-slate-500">
              {t('accounts.advancedData')}
            </span>
            <ChevronDown className="w-3.5 h-3.5 text-slate-500 transition-transform group-open:rotate-180" />
          </summary>
          <pre className="mt-1 p-2 bg-black/20 rounded-lg text-[10px] text-slate-400 overflow-auto max-h-48 font-mono whitespace-pre-wrap break-all">
            {JSON.stringify(account, null, 2)}
          </pre>
        </details>
      )}
    </>
  );
}

// ── Notes tab ─────────────────────────────────────────────────────────────────

interface NotesTabProps {
  account: Account;
  onUpdate?: (accountId: number, updates: { notes?: string; tags?: string }) => Promise<void>;
}

function NotesTab({ account, onUpdate }: NotesTabProps) {
  const [notes, setNotes] = useState(account.notes ?? '');
  const [tags, setTags] = useState(account.tags ?? '');
  const [isSaving, setIsSaving] = useState(false);

  // Panel is keyed by account.id in parent, so local state resets on account switch.
  // No useEffect needed — initial state is correct on mount.

  const notesDirty = notes !== (account.notes ?? '');
  const tagsDirty = tags !== (account.tags ?? '');
  const isDirty = notesDirty || tagsDirty;

  const handleSave = async () => {
    if (!onUpdate) return;
    setIsSaving(true);
    try {
      await onUpdate(account.id, { notes, tags });
      toast.success(t('accounts.inspector.notesSaved'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('accounts.inspector.notesSaveFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setNotes(account.notes ?? '');
    setTags(account.tags ?? '');
  };

  // Read-only fallback when onUpdate is not provided
  if (!onUpdate) {
    return (
      <>
        <div className="rounded-lg bg-white/[0.02] border border-white/10 overflow-hidden">
          <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-medium px-3 pt-2.5 pb-2 border-b border-white/[0.04]">
            {t('accounts.drawer.notes')}
          </h3>
          <div className="px-3 py-2">
            {account.notes ? (
              <p className="text-xs text-slate-300 whitespace-pre-wrap">{account.notes}</p>
            ) : (
              <span className="text-[11px] text-slate-600 italic">{t('accounts.drawer.noData')}</span>
            )}
          </div>
        </div>
        <div className="rounded-lg bg-white/[0.02] border border-white/10 overflow-hidden">
          <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-medium px-3 pt-2.5 pb-2 border-b border-white/[0.04]">
            {t('accounts.drawer.tags')}
          </h3>
          <div className="px-3 py-2">
            {account.tags ? (
              <div className="flex flex-wrap gap-1">
                {account.tags.split(',').map(tag => (
                  <span key={tag.trim()} className="px-1.5 py-0.5 rounded text-[10px] bg-indigo-500/20 text-indigo-300">
                    {tag.trim()}
                  </span>
                ))}
              </div>
            ) : (
              <span className="text-[11px] text-slate-600 italic">{t('accounts.drawer.noData')}</span>
            )}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      {/* Notes */}
      <div className="rounded-lg bg-white/[0.02] border border-white/10 overflow-hidden">
        <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-medium px-3 pt-2.5 pb-2 border-b border-white/[0.04]">
          {t('accounts.drawer.notes')}
        </h3>
        <div className="p-3">
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            disabled={isSaving}
            rows={4}
            className="w-full px-3 py-2 bg-black/20 border border-white/10 rounded text-xs text-white focus:outline-none focus:border-indigo-500/50 resize-none"
            placeholder={t('accounts.addNotesPlaceholder')}
          />
        </div>
      </div>

      {/* Tags */}
      <div className="rounded-lg bg-white/[0.02] border border-white/10 overflow-hidden">
        <h3 className="text-[10px] uppercase tracking-wider text-slate-500 font-medium px-3 pt-2.5 pb-2 border-b border-white/[0.04]">
          {t('accounts.drawer.tags')}
        </h3>
        <div className="p-3">
          <input
            type="text"
            value={tags}
            onChange={e => setTags(e.target.value)}
            disabled={isSaving}
            className="w-full px-3 py-2 bg-black/20 border border-white/10 rounded text-xs text-white focus:outline-none focus:border-indigo-500/50"
            placeholder={t('accounts.addTagPlaceholder')}
          />
        </div>
      </div>

      {/* Save / Cancel */}
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="primary"
          onClick={handleSave}
          disabled={!isDirty || isSaving}
          leftIcon={<Save size={12} />}
        >
          {t('common.save')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={handleCancel}
          disabled={!isDirty || isSaving}
        >
          {t('common.cancel')}
        </Button>
      </div>
    </>
  );
}
