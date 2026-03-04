import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users } from 'lucide-react';
import { toast } from 'sonner';
import Header from '../components/layout/Header';
import { useProfilesViewModel, type ProfileListFilter } from '../hooks/useProfilesViewModel';
import AddAccountModal from '../components/AddAccountModal';
import { ProfileSettingsModal } from '../components/profiles/ProfileSettingsModal';
import { FloatingActionBar } from '../components/ui/FloatingActionBar';
import { useAccountsStore } from '../stores/accounts';
import { useUIPreferencesStore } from '../stores/uiPreferences';
import {
  getOrCreateFingerprintProfile,
  saveFingerprintProfile,
  listFingerprintProfiles,
  deleteFingerprintProfile,
  openStandaloneFingerprintProfileAndRememberUrl,
} from '@/lib/tauri';
import { t } from '../lib/i18n';
import { useBulkRefresh } from '../hooks/useBulkRefresh';
import { useAccountsActions } from '../hooks/useAccountsActions';
import { useAccountsFiltersState } from '../hooks/useAccountsFiltersState';
import { useAccountsListViewModel } from '../hooks/useAccountsListViewModel';
import { useAccountsPageLifecycle } from '../hooks/useAccountsPageLifecycle';
import { useConstrainSelectionToVisibleAccounts } from '../hooks/useConstrainSelectionToVisibleAccounts';
import { useAccountsVisibleColumnsState } from '../hooks/useAccountsVisibleColumnsState';
import { AccountsToolbar } from '../components/accounts/AccountsToolbar';
import { AccountsFiltersRail } from '../components/accounts/AccountsFiltersRail';
import { SheetsConfigPanel } from '../components/accounts/SheetsConfigPanel';
import { AccountsMainPanels } from '../components/accounts/AccountsMainPanels';
import { AccountsErrorBanner } from '../components/accounts/AccountsErrorBanner';
import { AccountsExpiredBanner } from '../components/accounts/AccountsExpiredBanner';
import { useGoogleSheetsDataset } from '../hooks/useGoogleSheetsDataset';
import { useSheetsConfigState } from '../hooks/useSheetsConfigState';

export default function Accounts() {
  const navigate = useNavigate();
  const {
    accounts: storeAccounts,
    loading,
    error: accountsError,
    fetchAccounts,
    deleteAccount,
    deleteAccounts,
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
  } = useAccountsStore();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
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
  const [profileSettingsAlias, setProfileSettingsAlias] = useState<string | null>(null);
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [profileListFilter, setProfileListFilter] = useState<ProfileListFilter>('all');
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

  const { filteredAccounts, filteredAccountIds, expiredAccountIds, providerCounts, expiredCount } =
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

  useConstrainSelectionToVisibleAccounts({
    visibleAccounts: filteredAccounts,
    selectedIds,
    setSelectedIds,
  });

  const handleAddAccount = async (d: any) => {
    try {
      await useAccountsStore.getState().addAccount(d.provider, d.email, d.password);
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
    handleUpdateAccount,
    handleExportCSV,
    handleImportAccounts,
    handleRefreshAll,
    handleRefreshExpired,
    handleRemoveSelectedAccounts,
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

  const handleCreateStandaloneProfile = useCallback(async () => {
    try {
      const profile = await getOrCreateFingerprintProfile({ email: null });
      const alias = `standalone_profile_${Date.now()}@local.profile`;
      await saveFingerprintProfile({ email: alias, profile });
      toast.success(`${t('accounts.profileCreateSuccess')}: ${alias}`);
      await loadProfiles();
      handleEntityFilterChange('profiles');
    } catch (error) {
      console.error('[Accounts] Failed to create standalone profile:', error);
      toast.error(
        `${t('accounts.profileCreateFailed')}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }, [loadProfiles, handleEntityFilterChange]);

  const { visibleProfileItems } = useProfilesViewModel({
    profileAliases,
    accounts: storeAccounts,
    searchQuery,
    profileListFilter,
  });

  const handleDeleteProfile = useCallback(
    async (alias: string) => {
      if (!window.confirm(t('accounts.deleteProfileConfirm', { alias }))) return;
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
        const profile = await getOrCreateFingerprintProfile({ email: acc.email });
        await saveFingerprintProfile({ email: acc.email, profile });
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

  const handleAddAccountOpen = useCallback(() => {
    setIsModalOpen(true);
  }, []);

  const handleEditProfile = useCallback((alias: string) => {
    setProfileSettingsAlias(alias);
  }, []);

  const handleNavigateToGraphFromSheets = useCallback(
    (payload: { sheetName: string; serviceAccountId?: string; login?: string }) => {
      console.log('[Accounts] Navigate to graph target:', payload);
      handleViewModeChange('graph');
    },
    [handleViewModeChange]
  );

  const handleStartAutoregFromProfile = useCallback(
    (
      alias: string,
      targetProvider: string,
      preset?: 'kiro_via_aws_session',
      awsBootstrapAccountId?: number
    ) => {
      const query = new URLSearchParams({
        source: 'profile',
        profile: alias,
        target: targetProvider,
      });
      if (preset) query.set('preset', preset);
      if (typeof awsBootstrapAccountId === 'number') {
        query.set('awsBootstrapAccountId', String(awsBootstrapAccountId));
      }
      navigate(`/autoreg?${query.toString()}`);
    },
    [navigate]
  );

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
    <div className="flex flex-col h-full overflow-hidden bg-[#0a0a0c] font-sans">
      <Header title={t('accounts.title')} icon={<Users size={18} />} />

      <div className="flex-1 flex overflow-hidden">
        <AccountsFiltersRail
          entityFilter={entityFilter}
          providerFilter={providerFilter}
          statusFilter={statusFilter}
          accountsCount={storeAccounts.length}
          profilesCount={profileAliases.length}
          providerCounts={providerCounts}
          onEntityFilterChange={handleEntityFilterChange}
          onProviderFilterChange={handleProviderFilterChange}
          onStatusFilterChange={handleStatusFilterChange}
        />

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <AccountsToolbar
            resolvedViewMode={resolvedViewMode}
            showAccountsModes={showAccountsModes}
            normalizedEntityFilter={normalizedEntityFilter}
            accountsCount={storeAccounts.length}
            profilesCount={profileAliases.length}
            searchQuery={searchQuery}
            statusFilter={statusFilter}
            tagFilter={tagFilter}
            relationFilter={relationFilter}
            quotaFilter={quotaFilter}
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
            onEntityFilterChange={handleEntityFilterChange}
            onViewModeChange={handleViewModeChange}
            onSearchQueryChange={handleSearchQueryChange}
            onStatusFilterChange={handleStatusFilterChange}
            onTagFilterChange={handleTagFilterChange}
            onRelationFilterChange={handleRelationFilterChange}
            onQuotaFilterChange={handleQuotaFilterChange}
            onRefreshAll={handleRefreshAll}
            onImportAccounts={handleImportAccounts}
            onExportCSV={handleExportCSV}
            onTestSheets={handleTestSheets}
            onRefreshSheets={handleRefreshSheets}
            onToggleSheetsConfig={handleToggleSheetsConfig}
            onOpenAutoReg={handleOpenAutoReg}
            onCreateStandaloneProfile={handleCreateStandaloneProfile}
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

          {/* Table */}
          <div className="flex-1 overflow-hidden">
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
              onEditProfile={handleEditProfile}
              onOpenStandaloneProfile={handleOpenStandaloneProfile}
              onStartAutoregFromProfile={handleStartAutoregFromProfile}
              onDeleteProfile={handleDeleteProfile}
              profileListFilter={profileListFilter}
              onProfileFilterChange={setProfileListFilter}
              selectedIdsSize={selectedIds.size}
              tagFilter={tagFilter}
              onCreateProfilesForSelected={handleCreateProfilesForSelected}
              onBatchProfileAction={handleBatchProfileAction}
              filteredAccounts={filteredAccounts}
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
                onDeleteSelected: handleRemoveSelectedAccounts,
                onActivate: setActiveAccount,
                onCheckStatus: handleCheckStatus,
                isAccountRefreshing,
                onOpenBrowser: handleOpenBrowser,
                onOpenProfileSession: handleOpenProfileSession,
                onConfirmProfileSession: handleConfirmProfileSession,
                onClearProfileSession: handleClearProfileSession,
                onUpdate: handleUpdateAccount,
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

      {selectedIds.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-50 px-6 pb-6 pointer-events-none">
          <div className="max-w-2xl mx-auto pointer-events-auto">
            <FloatingActionBar
              selectedCount={selectedIds.size}
              onExport={handleExportCSV}
              onDelete={() => handleRemoveSelectedAccounts()}
              onClear={clearSelection}
              onRefreshAll={handleRefreshAll}
              isRefreshing={isBulkRefreshing}
              refreshProgress={bulkProgress}
            />
          </div>
        </div>
      )}
    </div>
  );
}
