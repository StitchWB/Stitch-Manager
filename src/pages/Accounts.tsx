import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users } from 'lucide-react';
import { toast } from 'sonner';
import Header from '../components/layout/Header';
import { useProfilesViewModel, type ProfileListFilter } from '../hooks/useProfilesViewModel';
import AddAccountModal from '../components/AddAccountModal';
import { ProfileSettingsModal } from '../components/profiles/ProfileSettingsModal';
import { CreateProfileModal, type CreateProfileMode } from '../components/profiles/CreateProfileModal';
import { ScenarioRecordModal } from '../components/scenarioRecorder/ScenarioRecordModal';
import { type BrowserEngineId } from '@/lib/browser/engines';

import { useAccountsStore } from '../stores/accounts';
import type { ProviderName } from '../types/ui';
import { useUIPreferencesStore } from '../stores/uiPreferences';
import { useUIState } from '../hooks/useUIState';
import {
  listFingerprintProfiles,
  deleteFingerprintProfile,
  getProfileSettings,
  saveProfileSettings,
  createDefaultProfileSettings,
  openStandaloneFingerprintProfileAndRememberUrl,
  claimAccount,
} from '@/lib/backend';
import { t } from '../lib/i18n';
import { useBulkRefresh } from '../hooks/useBulkRefresh';
import { useAccountsActions } from '../hooks/useAccountsActions';
import { useAccountsFiltersState } from '../hooks/useAccountsFiltersState';
import { useAccountsListViewModel } from '../hooks/useAccountsListViewModel';
import { useAccountsPageLifecycle } from '../hooks/useAccountsPageLifecycle';
import { useConstrainSelectionToVisibleAccounts } from '../hooks/useConstrainSelectionToVisibleAccounts';
import { useAccountsVisibleColumnsState } from '../hooks/useAccountsVisibleColumnsState';
import { AccountsToolbar } from '../components/accounts/AccountsToolbar';
import { SheetsConfigPanel } from '../components/accounts/SheetsConfigPanel';
import { AccountsMainPanels } from '../components/accounts/AccountsMainPanels';
import { AccountsErrorBanner } from '../components/accounts/AccountsErrorBanner';
import { AccountsExpiredBanner } from '../components/accounts/AccountsExpiredBanner';
import { useGoogleSheetsDataset } from '../hooks/useGoogleSheetsDataset';
import { useSheetsConfigState } from '../hooks/useSheetsConfigState';
import { FloatingActionBar, SegmentedControl } from '@/components/ui';

export default function Accounts() {
  const navigate = useNavigate();
  const {
    accounts: storeAccounts,
    loading,
    error: accountsError,
    fetchAccounts,
    deleteAccount,
    deleteAccounts,
    archiveAccounts,
    toggleSelection,
    selectAll,
    clearSelection,
    selectedIds,
    setSelectedIds,
    setSelectedProvider,
    activeAccountIds,
    setActiveAccount,
    setSearchQuery: setStoreSearchQuery,
    setQuotaFilter: setStoreQuotaFilter,
    setStatusFilter: setStoreStatusFilter,
    showArchived,
    setShowArchived,
  } = useAccountsStore();

  const [isModalOpen, setIsModalOpen] = useUIState('accounts-modal-open', false, 'session');
  const [isImporting, setIsImporting] = useUIState('accounts-importing', false, 'session');
  const {
    startBulkRefresh,
    isRefreshing: isBulkRefreshing,
    progress: bulkProgress,
    isAccountRefreshing,
  } = useBulkRefresh({ concurrency: 3, delayMs: 500 });

  // Sync with UI preferences
  const {
    accountsPage,
    setAccountsProviderFilter,
    setAccountsStatusFilter,
    setAccountsQuotaFilter,
    setAccountsSearchQuery,
    setAccountsTagFilter,
    setAccountsRelationFilter,
    setAccountsEntityFilter,
    setAccountsVisibleColumns,
  } = useUIPreferencesStore();

  const {
    providerFilter,
    statusFilter,
    searchQuery,
    quotaFilter,
    tagFilter,
    relationFilter,
    entityFilter,
    resolvedViewMode,
    normalizedEntityFilter,
    tagOptions,
    relationOptions,
    parseTags,
    handleProviderFilterChange,
    handleStatusFilterChange,
    handleQuotaFilterChange,
    handleTagFilterChange,
    handleRelationFilterChange,
    handleSearchQueryChange,
    handleEntityFilterChange,
    handleViewModeChange,
  } = useAccountsFiltersState({
    accounts: storeAccounts,
    accountsPage,
    setAccountsProviderFilter,
    setAccountsStatusFilter,
    setAccountsQuotaFilter,
    setAccountsSearchQuery,
    setAccountsTagFilter,
    setAccountsRelationFilter,
    setAccountsEntityFilter,
    setSelectedProvider,
    setStoreStatusFilter,
    setStoreQuotaFilter,
    setStoreSearchQuery,
    clearSelection,
  });
  const { visibleColumns, handleToggleVisibleColumn, handleResetVisibleColumns } =
    useAccountsVisibleColumnsState({
      initial: accountsPage.tableVisibleColumns,
      onPersist: setAccountsVisibleColumns,
    });
  const [profileAliases, setProfileAliases] = useState<string[]>([]);
  const [ownershipFilter, setOwnershipFilter] = useState<'all' | 'mine' | 'shared'>('all');
  const [profileSettingsAlias, setProfileSettingsAlias] = useUIState(
    'accounts-profile-settings-alias',
    null as string | null,
    'session'
  );
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [profileListFilter, setProfileListFilter] = useUIState<ProfileListFilter>(
    'accounts-profile-list-filter',
    'all',
    'persist'
  );
  const [profileOpenTarget, setProfileOpenTarget] = useUIState(
    'accounts-profile-open-target',
    'kiro',
    'persist'
  );
  const [profileCustomUrl, setProfileCustomUrl] = useUIState(
    'accounts-profile-custom-url',
    '',
    'session'
  );
  const loadProfiles = useCallback(async () => {
    setProfilesLoading(true);
    try {
      const aliases = await listFingerprintProfiles();
      setProfileAliases(aliases);
    } catch (error) {
      console.error('[Accounts] Failed to list fingerprint profiles:', error);
    } finally {
      setProfilesLoading(false);
    }
  }, []);

  const showAccountsModes = true;

  const {
    sheetsSpreadsheetId,
    sheetsServiceAccountJson,
    sheetsTestStatus,
    sheetsTestMessage,
    showSheetsConfig,
    sheetsParams,
    handleTestSheets,
    handleRefreshSheets,
    handleToggleSheetsConfig,
    handleSheetsSpreadsheetIdChange,
    handleSheetsServiceAccountJsonChange,
    registerSheetsHandlers,
  } = useSheetsConfigState({ resolvedViewMode });

  const {
    dataset: sheetsDataset,
    isLoading: sheetsLoading,
    error: sheetsError,
    lastUpdatedAt: sheetsUpdatedAt,
    refresh: refreshSheetsDataset,
    testConnection: testSheetsConnection,
  } = useGoogleSheetsDataset({
    autoFetch: resolvedViewMode === 'graph' || resolvedViewMode === 'sheets',
    params: sheetsParams,
  });

  useEffect(() => {
    registerSheetsHandlers({
      refresh: refreshSheetsDataset,
      testConnection: testSheetsConnection,
    });
  }, [refreshSheetsDataset, registerSheetsHandlers, testSheetsConnection]);

  useAccountsPageLifecycle({ fetchAccounts });

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadProfiles();
  }, [loadProfiles]);

  const handleRemoveAccount = useCallback(
    async (id: number) => {
      try {
        await deleteAccount(id);
        fetchAccounts();
      } catch (e) {
        console.error(e);
      }
    },
    [deleteAccount, fetchAccounts]
  );

  const { filteredAccounts, filteredAccountIds, expiredAccountIds, expiredCount, providerCounts } =
    useAccountsListViewModel({
      accounts: storeAccounts,
      providerFilter,
      searchQuery,
      statusFilter,
      quotaFilter,
      tagFilter,
      relationFilter,
      parseTags,
    });

  const ownershipFilteredAccounts = useMemo(() => {
    if (ownershipFilter === 'all') return filteredAccounts;
    if (ownershipFilter === 'mine') return filteredAccounts.filter(a => a.mine);
    return filteredAccounts.filter(a => a.shared && !a.mine);
  }, [filteredAccounts, ownershipFilter]);

  const handleClaimAccount = useCallback(
    async (accountId: number) => {
      try {
        await claimAccount(accountId);
        toast.success(t('ownership.claimed'));
        fetchAccounts();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t('ownership.claim'));
      }
    },
    [fetchAccounts]
  );

  useConstrainSelectionToVisibleAccounts({
    visibleAccounts: ownershipFilteredAccounts,
    selectedIds,
    setSelectedIds,
  });

  const handleAddAccount = async (d: {
    provider: ProviderName;
    email: string;
    password: string;
    cookies?: string;
  }) => {
    try {
      await useAccountsStore.getState().addAccount(d.provider, d.email, d.password, d.cookies);
      fetchAccounts();
    } catch (e) {
      console.error(e);
    }
  };
  const {
    handleCheckStatus,
    handleOpenBrowser,
    handleOpenProfileSession,
    handleConfirmProfileSession,
    handleClearProfileSession,
    handleOpenWebLogin,
    handleCaptureWebCookies,
    handleAuthorizeKiroAccount,
    handleUpdateAccount,
    handleExportCSV,
    handleImportAccounts,
    handleImportFromClipboard,
    handleRefreshAll,
    handleRefreshExpired,
    handleRemoveSelectedAccounts,
    handleToggleAutoRefreshQuota,
  } = useAccountsActions({
    selectedIds,
    filteredAccountIds,
    expiredAccountIds,
    isImporting,
    setIsImporting,
    startBulkRefresh: async accountIds => {
      return startBulkRefresh(accountIds);
    },
    fetchAccounts,
    deleteAccounts,
    clearSelection,
  });

  const handleBatchProfileAction = useCallback(
    async (action: 'open' | 'confirm' | 'clear') => {
      const targets = Array.from(selectedIds);
      if (!targets.length) return;

      const runner =
        action === 'open'
          ? handleOpenProfileSession
          : action === 'confirm'
            ? handleConfirmProfileSession
            : handleClearProfileSession;

      const settled = await Promise.allSettled(targets.map(id => runner(id)));
      const success = settled.filter(r => r.status === 'fulfilled').length;
      const failed = settled.length - success;

      if (failed === 0) {
        toast.success(t('accounts.batchResultSummary', { success: String(success), failed: '0' }));
        return;
      }

      const errors = settled
        .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
        .slice(0, 2)
        .map(r => (r.reason instanceof Error ? r.reason.message : String(r.reason)))
        .join(' • ');

      const summary = t('accounts.batchResultSummary', {
        success: String(success),
        failed: String(failed),
      });

      toast.warning(
        t('accounts.batchResultWithErrors', {
          summary,
          errors,
        })
      );
    },
    [handleClearProfileSession, handleConfirmProfileSession, handleOpenProfileSession, selectedIds]
  );

  const handleArchiveSelected = useCallback(async () => {
    const targets = Array.from(selectedIds);
    if (!targets.length) return;
    try {
      await archiveAccounts(targets, true);
      toast.success(t('accounts.archiveSuccess', { count: String(targets.length) }));
      clearSelection();
    } catch (error) {
      toast.error(
        `${t('accounts.archiveFailed')}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }, [selectedIds, archiveAccounts, clearSelection]);

  const [createProfileOpen, setCreateProfileOpen] = useState(false);
  const [recordNewAlias, setRecordNewAlias] = useState<string | null>(null);

  // New-profile flow: create (then open settings) or create-and-record
  // (launch the browser with the recorder overlay right away).
  const handleCreateProfileSubmit = useCallback(
    async (alias: string, engine: BrowserEngineId, mode: CreateProfileMode) => {
      try {
        const settings = createDefaultProfileSettings();
        settings.engine = engine;
        await saveProfileSettings({ alias, settings });
        toast.success(`${t('accounts.profileCreateSuccess')}: ${alias}`);
        await loadProfiles();
        handleEntityFilterChange('profiles');
        if (mode === 'record') {
          setRecordNewAlias(alias);
        } else {
          setProfileSettingsAlias(alias);
        }
      } catch (error) {
        console.error('[Accounts] Failed to create profile:', error);
        toast.error(
          `${t('accounts.profileCreateFailed')}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },
    [loadProfiles, handleEntityFilterChange, setProfileSettingsAlias]
  );

  const { visibleProfileItems, shardAvailable } = useProfilesViewModel({
    profileAliases,
    accounts: storeAccounts,
    searchQuery,
    profileListFilter,
  });

  const handleDeleteProfile = useCallback(
    async (alias: string) => {
      try {
        await deleteFingerprintProfile({ email: alias });
        toast.success(t('accounts.profileDeleteSuccess'));
        await loadProfiles();
      } catch (error) {
        console.error('[Accounts] Failed to delete profile:', error);
        toast.error(t('accounts.profileDeleteFailed'));
      }
    },
    [loadProfiles]
  );

  const handleOpenStandaloneProfile = useCallback(
    async (alias: string, target: string, customUrl?: string) => {
      const isCustom = target === 'custom';
      const provider = isCustom ? 'kiro' : target;
      const url = isCustom ? customUrl?.trim() : undefined;

      if (isCustom && !url) {
        toast.error(t('accounts.profileOpenFailed'));
        return;
      }

      try {
        await openStandaloneFingerprintProfileAndRememberUrl({ alias, provider, url });
        toast.success(t('accounts.profileOpenSuccess'));
      } catch (error) {
        console.error('[Accounts] Failed to open standalone profile:', error);
        toast.error(
          `${t('accounts.profileOpenFailed')}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },
    []
  );

  const handleCreateProfilesForSelected = useCallback(async () => {
    const selectedAccounts = filteredAccounts.filter(acc => selectedIds.has(acc.id));
    if (!selectedAccounts.length) return;
    const settled = await Promise.allSettled(
      selectedAccounts.map(async acc => {
        const existing = await getProfileSettings({ alias: acc.email });
        if (!existing) {
          await saveProfileSettings({ alias: acc.email, settings: createDefaultProfileSettings() });
        }
      })
    );
    const success = settled.filter(s => s.status === 'fulfilled').length;
    const failed = settled.length - success;
    if (failed === 0) toast.success(t('accounts.profileCreateSuccess'));
    else if (success > 0)
      toast.warning(
        `${t('accounts.profileCreateSuccess')} (${success}), ${t('accounts.profileCreateFailed')} (${failed})`
      );
    else toast.error(t('accounts.profileCreateFailed'));
    await loadProfiles();
  }, [filteredAccounts, selectedIds, loadProfiles]);

  const handleOpenAutoReg = useCallback(() => {
    navigate('/autoreg');
  }, [navigate]);

  const handleOpenProfileScenarios = useCallback(
    (alias: string) => {
      const trimmed = alias.trim();
      navigate(trimmed ? `/scenarios?alias=${encodeURIComponent(trimmed)}` : '/scenarios');
    },
    [navigate]
  );

  const handleAddAccountOpen = useCallback(() => {
    setIsModalOpen(true);
  }, [setIsModalOpen]);

  const handleEditProfile = useCallback((alias: string) => {
    setProfileSettingsAlias(alias);
  }, [setProfileSettingsAlias]);

  const handleNavigateToGraphFromSheets = useCallback(
    (_payload: { sheetName: string; serviceAccountId?: string; login?: string }) => {
      handleViewModeChange('graph');
    },
    [handleViewModeChange]
  );

  const handleCopyRefUrl = useCallback(async (refUrl: string) => {
    try {
      await navigator.clipboard.writeText(refUrl);
      toast.success(t('accounts.account_ref_cell.ref_copied'));
    } catch {
      toast.error(t('accounts.account_ref_cell.ref_copy_failed'));
    }
  }, []);

  const handleRefreshRefUrl = useCallback(async (_accountId: number) => {
    try {
      // TODO: wire to Backend command that runs fetch_referral step on existing account
      toast.info(t('accounts.account_ref_cell.ref_refresh_pending'));
    } catch {
      toast.error(t('accounts.account_ref_cell.ref_refresh_failed'));
    }
  }, []);

  const handleRelationEdgeClickInAll = useCallback(
    (edgeType: string, targetProvider: string) => {
      handleRelationFilterChange(`edge:${edgeType}:${targetProvider}`);
      handleEntityFilterChange('accounts');
    },
    [handleEntityFilterChange, handleRelationFilterChange]
  );

  const handleRelationEdgeClickInAccounts = useCallback(
    (edgeType: string, targetProvider: string) => {
      handleRelationFilterChange(`edge:${edgeType}:${targetProvider}`);
    },
    [handleRelationFilterChange]
  );

  return (
    <div className="flex flex-col h-full overflow-hidden bg-vsc-bg font-sans">
      <Header title={t('accounts.title')} icon={<Users size={18} />} />

      <div className="flex-1 flex overflow-hidden">
        {/* Main Content Area */}
        <div className="flex-1 flex flex-col overflow-hidden p-6">
          <AccountsToolbar
            resolvedViewMode={resolvedViewMode}
            showAccountsModes={showAccountsModes}
            normalizedEntityFilter={normalizedEntityFilter}
            accountsCount={storeAccounts.length}
            profilesCount={profileAliases.length}
            searchQuery={searchQuery}
            providerFilter={providerFilter}
            statusFilter={statusFilter}
            tagFilter={tagFilter}
            relationFilter={relationFilter}
            quotaFilter={quotaFilter}
            providerCounts={providerCounts}
            profileListFilter={profileListFilter}
            profileOpenTarget={profileOpenTarget}
            profileCustomUrl={profileCustomUrl}
            tagOptions={tagOptions}
            relationOptions={relationOptions}
            sheetsUpdatedAt={sheetsUpdatedAt ?? null}
            isBulkRefreshing={isBulkRefreshing}
            isImporting={isImporting}
            filteredAccountsCount={filteredAccounts.length}
            sheetsTestStatus={sheetsTestStatus}
            sheetsLoading={sheetsLoading}
            hasSheetsParams={Boolean(sheetsParams)}
            showSheetsConfig={showSheetsConfig}
            visibleColumns={visibleColumns}
            showArchived={showArchived}
            onShowArchivedChange={setShowArchived}
            onEntityFilterChange={handleEntityFilterChange}
            onViewModeChange={handleViewModeChange}
            onSearchQueryChange={handleSearchQueryChange}
            onProviderFilterChange={handleProviderFilterChange}
            onStatusFilterChange={handleStatusFilterChange}
            onTagFilterChange={handleTagFilterChange}
            onRelationFilterChange={handleRelationFilterChange}
            onQuotaFilterChange={handleQuotaFilterChange}
            onProfileFilterChange={setProfileListFilter}
            onProfileOpenTargetChange={setProfileOpenTarget}
            onProfileCustomUrlChange={setProfileCustomUrl}
            onRefreshAll={handleRefreshAll}
            onImportAccounts={handleImportAccounts}
            onImportFromClipboard={handleImportFromClipboard}
            onExportCSV={handleExportCSV}
            onTestSheets={handleTestSheets}
            onRefreshSheets={handleRefreshSheets}
            onToggleSheetsConfig={handleToggleSheetsConfig}
            onOpenAutoReg={handleOpenAutoReg}
            onCreateProfile={() => setCreateProfileOpen(true)}
            onAddAccount={handleAddAccountOpen}
            onToggleVisibleColumn={handleToggleVisibleColumn}
            onResetVisibleColumns={handleResetVisibleColumns}
          />

          {resolvedViewMode !== 'list' && showSheetsConfig && (
            <SheetsConfigPanel
              spreadsheetId={sheetsSpreadsheetId}
              serviceAccountJson={sheetsServiceAccountJson}
              testStatus={sheetsTestStatus}
              testMessage={sheetsTestMessage}
              onSpreadsheetIdChange={handleSheetsSpreadsheetIdChange}
              onServiceAccountJsonChange={handleSheetsServiceAccountJsonChange}
            />
          )}

          {resolvedViewMode === 'list' && entityFilter !== 'profiles' && accountsError ? (
            <AccountsErrorBanner error={accountsError} />
          ) : null}

          {resolvedViewMode === 'list' ? (
            <AccountsExpiredBanner
              expiredCount={expiredCount}
              isRefreshing={isBulkRefreshing}
              onRefreshExpired={handleRefreshExpired}
            />
          ) : null}

          {resolvedViewMode === 'list' && entityFilter !== 'profiles' ? (
            <div className="shrink-0 py-2">
              <SegmentedControl
                size="sm"
                value={ownershipFilter}
                onChange={(v) => setOwnershipFilter(v as 'all' | 'mine' | 'shared')}
                options={[
                  { value: 'all', label: t('ownership.filterAll') },
                  { value: 'mine', label: t('ownership.filterMine') },
                  { value: 'shared', label: t('ownership.filterShared') },
                ]}
              />
            </div>
          ) : null}

          {/* Table */}
          <div className="flex-1 overflow-auto">
            <AccountsMainPanels
              resolvedViewMode={resolvedViewMode}
              entityFilter={entityFilter}
              sheetsUpdatedAt={sheetsUpdatedAt ?? null}
              sheetsDataset={sheetsDataset}
              sheetsLoading={sheetsLoading}
              sheetsError={sheetsError}
              onRefreshSheets={handleRefreshSheets}
              onNavigateToGraphFromSheets={handleNavigateToGraphFromSheets}
              profileAliases={profileAliases}
              profilesLoading={profilesLoading}
              visibleProfileItems={visibleProfileItems}
              shardAvailable={shardAvailable}
              onEditProfile={handleEditProfile}
              onOpenStandaloneProfile={handleOpenStandaloneProfile}
              onDeleteProfile={handleDeleteProfile}
              onOpenProfileScenarios={handleOpenProfileScenarios}
              openTarget={profileOpenTarget}
              customUrl={profileCustomUrl}
              selectedIdsSize={selectedIds.size}
              tagFilter={tagFilter}
              onCreateProfilesForSelected={handleCreateProfilesForSelected}
              onBatchProfileAction={handleBatchProfileAction}
              filteredAccounts={ownershipFilteredAccounts}
              loading={loading}
              searchQuery={searchQuery}
              statusFilter={statusFilter}
            quotaFilter={quotaFilter}
            relationFilter={relationFilter}
              visibleColumns={visibleColumns}
              baseAccountsTableProps={{
                selectedIds,
                activeAccountIds,
                onToggleSelection: toggleSelection,
                onSelectAll: selectAll,
                onClearSelection: clearSelection,
                onDelete: handleRemoveAccount,
                onActivate: setActiveAccount,
                onCheckStatus: handleCheckStatus,
                isAccountRefreshing,
                onOpenBrowser: handleOpenBrowser,
                onToggleAutoRefreshQuota: handleToggleAutoRefreshQuota,
                onOpenProfileSession: handleOpenProfileSession,
                onConfirmProfileSession: handleConfirmProfileSession,
                onClearProfileSession: handleClearProfileSession,
                onOpenWebLogin: handleOpenWebLogin,
                onCaptureWebCookies: handleCaptureWebCookies,
                onAuthorizeKiroAccount: handleAuthorizeKiroAccount,
                onCopyRefUrl: handleCopyRefUrl,
                onRefreshRefUrl: handleRefreshRefUrl,
                onUpdate: handleUpdateAccount,
                onClaim: handleClaimAccount,
                selectedProvider: providerFilter === 'all' ? null : providerFilter,
              }}
              onRelationEdgeClickInAll={handleRelationEdgeClickInAll}
              onRelationEdgeClickInAccounts={handleRelationEdgeClickInAccounts}
            />
          </div>
        </div>
      </div>

      <AddAccountModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleAddAccount}
      />

      <ProfileSettingsModal
        alias={profileSettingsAlias}
        isOpen={Boolean(profileSettingsAlias)}
        onClose={() => setProfileSettingsAlias(null)}
        onSaved={() => {
          void loadProfiles();
        }}
      />

      <CreateProfileModal
        isOpen={createProfileOpen}
        onClose={() => setCreateProfileOpen(false)}
        onSubmit={handleCreateProfileSubmit}
        shardAvailable={shardAvailable}
        existingAliases={profileAliases}
      />

      <ScenarioRecordModal
        alias={recordNewAlias}
        isOpen={Boolean(recordNewAlias)}
        onClose={() => setRecordNewAlias(null)}
        quickStart
        defaultUrl={
          profileOpenTarget === 'custom' && profileCustomUrl.trim()
            ? profileCustomUrl.trim()
            : 'https://google.com'
        }
      />

      {selectedIds.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-50 px-6 pb-6 pointer-events-none">
          <div className="max-w-2xl mx-auto pointer-events-auto">
            <FloatingActionBar
              selectedCount={selectedIds.size}
              onExport={handleExportCSV}
              onDelete={() => handleRemoveSelectedAccounts()}
              onArchive={handleArchiveSelected}
              onClear={clearSelection}
              onRefreshAll={handleRefreshAll}
              isRefreshing={isBulkRefreshing}
              refreshProgress={bulkProgress}
              onCreateProfiles={handleCreateProfilesForSelected}
              onOpenProfileSession={() => handleBatchProfileAction('open')}
              onConfirmProfileSession={() => handleBatchProfileAction('confirm')}
              onClearProfileSession={() => handleBatchProfileAction('clear')}
            />
          </div>
        </div>
      )}
    </div>
  );
}
