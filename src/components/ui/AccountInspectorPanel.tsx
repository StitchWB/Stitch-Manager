import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { checkAccountStatus, refreshAccountToken } from '@/lib/backend';
import { t } from '@/lib/i18n';
import { TabButton } from './TabButton';
import {
  ActivityTab,
  DataTab,
  InspectorActionBar,
  InspectorHeader,
  NotesTab,
  OverviewTab,
  SessionTab,
  TAB_IDS,
  isAutoRefreshEnabled,
  isKiroProvider,
  type InspectorTab,
} from './inspector';
import type { Account } from '../../types/generated';
import type { AccountStatusInfo } from '../../types/ui';
import { useCopyToClipboard } from '../../hooks/useCopyToClipboard';
import { useAccountRowData } from '../../hooks/useAccountRow';
import { useTotpStore } from '../../stores/totp';
import { useUIPreferencesStore } from '../../stores/uiPreferences';

export interface AccountInspectorPanelProps {
  account: Account;
  isActive: boolean;
  onToggleActive: () => void;
  onOpenBrowser?: (id: number) => void;
  onAuthorizeKiroAccount?: (id: number) => void;
  onOpenProfileSession?: (id: number) => void;
  onConfirmProfileSession?: (id: number) => void;
  onClearProfileSession?: (id: number) => void;
  onOpenWebLogin?: (id: number) => void;
  onCaptureWebCookies?: (id: number) => void;
  onToggleAutoRefreshQuota?: (account: Account) => void;
  onCopyRefUrl?: (refUrl: string) => void;
  onRefreshRefUrl?: (id: number) => void;
  onCopyToken: (token: string) => void;
  onUpdate?: (accountId: number, updates: { notes?: string; tags?: string }) => Promise<void>;
  onRequestDelete: (accountId: number) => void;
  onClose: () => void;
  onRefresh?: (id: number) => void;
}

export function AccountInspectorPanel({
  account,
  isActive,
  onToggleActive,
  onOpenBrowser,
  onAuthorizeKiroAccount,
  onOpenProfileSession,
  onConfirmProfileSession,
  onClearProfileSession,
  onOpenWebLogin,
  onCaptureWebCookies,
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

  const handleOpenLogs = () => {
    useUIPreferencesStore.getState().setLogsSourceFilter(['accounts']);
    useUIPreferencesStore.getState().setLogsSearchQuery(account.email);
    navigate('/logs');
  };

  return (
    <div className="h-full flex flex-col border-l border-white/5 bg-vsc-bg">
      <InspectorHeader
        account={account}
        tokenExpiryDiff={tokenExpiryDiff}
        copy={copy}
        onClose={onClose}
      />

      <InspectorActionBar
        account={account}
        isActive={isActive}
        onToggleActive={onToggleActive}
        onOpenBrowser={onOpenBrowser}
        onAuthorizeKiroAccount={onAuthorizeKiroAccount}
        kiro={kiro}
        isCheckingStatus={isCheckingStatus}
        onCheckStatus={handleCheckStatus}
        isRefreshingToken={isRefreshingToken}
        onRefreshToken={handleRefreshToken}
        onCopyToken={onCopyToken}
        onCopyRefUrl={onCopyRefUrl}
        onRefreshRefUrl={onRefreshRefUrl}
        onRequestDelete={onRequestDelete}
        copy={copy}
      />

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
            onOpenWebLogin={onOpenWebLogin}
            onCaptureWebCookies={onCaptureWebCookies}
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
