import {
  Download,
  FileSpreadsheet,
  LayoutGrid,
  List,
  Plus,
  RefreshCw,
  Share2,
  Upload,
} from 'lucide-react';
import { t } from '../../lib/i18n';
import { getAccountStatusLabel } from '../../lib/accountStatus';
import {
  ActionButtonGroup,
  Button,
  FilterDropdown,
  Input,
  ViewModeSwitch,
  StickyToolbar,
  ToolbarRow,
  ToolbarFiltersGroup,
  ToolbarSearchField,
  ToolbarActionsCluster,
  type FilterOption,
} from '@/components/ui';
import type { AccountsEntityTab } from './AccountsEntityTabs';
import { AccountsEntityTabs } from './AccountsEntityTabs';
import { AccountsColumnsMenu, type AccountsVisibleColumns } from './AccountsColumnsMenu';

type ViewMode = 'list' | 'graph' | 'sheets';

interface AccountsToolbarProps {
  resolvedViewMode: ViewMode;
  showAccountsModes: boolean;
  normalizedEntityFilter: AccountsEntityTab;
  accountsCount: number;
  profilesCount: number;
  searchQuery: string;
  statusFilter: string;
  tagFilter: string;
  relationFilter: string;
  quotaFilter: string;
  profileListFilter: 'all' | 'standalone' | 'linked' | 'used_kiro';
  profileOpenTarget: string;
  profileCustomUrl: string;
  tagOptions: FilterOption<string>[];
  relationOptions: FilterOption<string>[];
  sheetsUpdatedAt: string | null;
  isBulkRefreshing: boolean;
  isImporting: boolean;
  filteredAccountsCount: number;
  sheetsTestStatus: 'idle' | 'loading' | 'success' | 'error';
  sheetsLoading: boolean;
  hasSheetsParams: boolean;
  showSheetsConfig: boolean;
  visibleColumns: AccountsVisibleColumns;
  onEntityFilterChange: (value: AccountsEntityTab) => void;
  onViewModeChange: (value: string) => void;
  onSearchQueryChange: (value: string) => void;
  onStatusFilterChange: (value: string) => void;
  onTagFilterChange: (value: string) => void;
  onRelationFilterChange: (value: string) => void;
  onQuotaFilterChange: (value: string) => void;
  onProfileFilterChange: (value: 'all' | 'standalone' | 'linked' | 'used_kiro') => void;
  onProfileOpenTargetChange: (value: string) => void;
  onProfileCustomUrlChange: (value: string) => void;
  onRefreshAll: () => void;
  onImportAccounts: () => void;
  onExportCSV: () => void;
  onTestSheets: () => void;
  onRefreshSheets: () => void;
  onToggleSheetsConfig: () => void;
  onOpenAutoReg: () => void;
  onCreateStandaloneProfile: () => void;
  onAddAccount: () => void;
  onToggleVisibleColumn: (column: keyof AccountsVisibleColumns, value: boolean) => void;
  onResetVisibleColumns: () => void;
}

export function AccountsToolbar({
  resolvedViewMode,
  showAccountsModes,
  normalizedEntityFilter,
  accountsCount,
  profilesCount,
  searchQuery,
  statusFilter,
  tagFilter,
  relationFilter,
  quotaFilter,
  profileListFilter,
  profileOpenTarget,
  profileCustomUrl,
  tagOptions,
  relationOptions,
  sheetsUpdatedAt,
  isBulkRefreshing,
  isImporting,
  filteredAccountsCount,
  sheetsTestStatus,
  sheetsLoading,
  hasSheetsParams,
  showSheetsConfig,
  visibleColumns,
  onEntityFilterChange,
  onViewModeChange,
  onSearchQueryChange,
  onStatusFilterChange,
  onTagFilterChange,
  onRelationFilterChange,
  onQuotaFilterChange,
  onProfileFilterChange,
  onProfileOpenTargetChange,
  onProfileCustomUrlChange,
  onRefreshAll,
  onImportAccounts,
  onExportCSV,
  onTestSheets,
  onRefreshSheets,
  onToggleSheetsConfig,
  onOpenAutoReg,
  onCreateStandaloneProfile,
  onAddAccount,
  onToggleVisibleColumn,
  onResetVisibleColumns,
}: AccountsToolbarProps) {
  return (
    <StickyToolbar
      topClassName="top-0"
      className="shrink-0 border-b border-white/5 bg-[#0b0b10]/85 px-4 py-3"
    >
      <div className="flex flex-col gap-4 w-full">
        {/* Top Row: Tabs and Action Buttons */}
        <div className="flex flex-wrap justify-between items-center gap-2 w-full">
          <ToolbarRow className="gap-2 min-w-0 flex-1 items-center">
            <AccountsEntityTabs
              value={normalizedEntityFilter}
              onChange={onEntityFilterChange}
              accountsCount={accountsCount}
              profilesCount={profilesCount}
            />

            {showAccountsModes && (
              <ViewModeSwitch
                value={resolvedViewMode}
                onChange={onViewModeChange}
                options={[
                  { value: 'list', label: t('accounts.viewList'), icon: <List size={14} /> },
                  { value: 'graph', label: t('accounts.viewGraph'), icon: <Share2 size={14} /> },
                  {
                    value: 'sheets',
                    label: t('accounts.viewSheets'),
                    icon: <FileSpreadsheet size={14} />,
                  },
                ]}
                className="shrink-0"
              />
            )}
          </ToolbarRow>

          <ToolbarActionsCluster className="justify-start xl:justify-end shrink-0" align="start">
            {resolvedViewMode === 'list' && normalizedEntityFilter !== 'profiles' ? (
              <ActionButtonGroup
                actions={[
                  {
                    icon: RefreshCw,
                    label: t('accounts.refreshAll'),
                    onClick: onRefreshAll,
                    disabled: isBulkRefreshing,
                    loading: isBulkRefreshing,
                  },
                  {
                    icon: Upload,
                    label: t('accounts.importAccounts'),
                    onClick: onImportAccounts,
                    disabled: isImporting,
                    loading: isImporting,
                  },
                  {
                    icon: Download,
                    label: t('accounts.exportCsv'),
                    onClick: onExportCSV,
                    disabled: filteredAccountsCount === 0,
                  },
                ]}
                spacing="tight"
                size="sm"
                className="h-8 rounded-lg bg-transparent px-2"
              />
            ) : resolvedViewMode !== 'list' ? (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={onTestSheets}
                  isLoading={sheetsTestStatus === 'loading'}
                  disabled={!hasSheetsParams}
                >
                  {t('validation.testConnection')}
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={onRefreshSheets}
                  disabled={!hasSheetsParams || sheetsLoading}
                  leftIcon={<RefreshCw size={14} className={sheetsLoading ? 'animate-spin' : ''} />}
                >
                  {t('common.refresh')}
                </Button>
                <Button
                  variant={showSheetsConfig ? 'secondary' : 'outline'}
                  size="sm"
                  onClick={onToggleSheetsConfig}
                >
                  {t('common.settings')}
                </Button>
              </>
            ) : null}

            {resolvedViewMode === 'list' && normalizedEntityFilter !== 'profiles' ? (
              <AccountsColumnsMenu
                visibleColumns={visibleColumns}
                onToggleColumn={onToggleVisibleColumn}
                onReset={onResetVisibleColumns}
              />
            ) : null}

            <div className="flex items-center gap-2">
              {normalizedEntityFilter !== 'profiles' ? (
                <Button
                  onClick={onOpenAutoReg}
                  variant="secondary"
                  size="sm"
                  className="h-8 rounded-lg"
                >
                  <span className="hidden sm:inline">{t('sidebar.autoReg')}</span>
                  <span className="sm:hidden">АР</span>
                </Button>
              ) : null}
              <Button
                onClick={onCreateStandaloneProfile}
                variant="secondary"
                size="sm"
                className="h-8 rounded-lg"
                leftIcon={<LayoutGrid size={16} />}
              >
                <span className="hidden sm:inline">{t('accounts.profilesCreateButton')}</span>
                <span className="sm:hidden">{t('accounts.entityProfiles')}</span>
              </Button>
              <Button
                onClick={onAddAccount}
                variant="primary"
                size="sm"
                leftIcon={<Plus size={18} />}
                className="h-8 rounded-lg shadow-none"
              >
                <span className="hidden sm:inline">{t('accounts.addAccount')}</span>
                <span className="sm:hidden">{t('common.add')}</span>
              </Button>
            </div>
          </ToolbarActionsCluster>
        </div>

        {/* Bottom Row: Search and Filters */}
        {resolvedViewMode === 'list' ? (
          <div className="flex flex-wrap items-center gap-3 w-full">
            <ToolbarSearchField
              value={searchQuery}
              onValueChange={onSearchQueryChange}
              placeholder={t('accounts.searchPlaceholder')}
              shellClassName="border-white/10 bg-black/40 focus-within:border-indigo-500/40 focus-within:bg-black/60 h-8"
              containerClassName="w-full min-w-[200px] max-w-xs flex-1"
            />

            {normalizedEntityFilter === 'profiles' ? (
              <ToolbarFiltersGroup align="end">
                <FilterDropdown
                  value={profileListFilter}
                  onChange={value =>
                    onProfileFilterChange(
                      value as 'all' | 'standalone' | 'linked' | 'used_kiro'
                    )
                  }
                  label={t('accounts.profilesFilterLabel')}
                  options={[
                    { value: 'all', label: t('accounts.profilesFilterAll') },
                    { value: 'standalone', label: t('accounts.profilesFilterStandalone') },
                    { value: 'linked', label: t('accounts.profilesFilterLinked') },
                    { value: 'used_kiro', label: t('accounts.profilesFilterUsedForKiro') },
                  ]}
                  triggerClassName="h-8 min-w-[180px]"
                  menuClassName="min-w-[220px]"
                  showActiveState
                />

                <FilterDropdown
                  value={profileOpenTarget}
                  onChange={value => onProfileOpenTargetChange(String(value))}
                  label={t('accounts.profileDestinationLabel')}
                  options={[
                    { value: 'kiro', label: 'Kiro' },
                    { value: 'windsurf', label: 'Windsurf' },
                    { value: 'trae', label: 'Trae' },
                    { value: 'github', label: 'GitHub' },
                    { value: 'custom', label: t('accounts.profileDestinationCustom') },
                  ]}
                  triggerClassName="h-8 min-w-[180px]"
                  menuClassName="min-w-[220px]"
                  showActiveState
                />

                {profileOpenTarget === 'custom' && (
                  <Input
                    label=""
                    value={profileCustomUrl}
                    onChange={event => onProfileCustomUrlChange(event.target.value)}
                    placeholder={t('accounts.profileOpenUrlPlaceholder')}
                    containerClassName="w-[360px] shrink-0"
                    className="h-8"
                  />
                )}
              </ToolbarFiltersGroup>
            ) : (
              <ToolbarFiltersGroup mobileScrollable>
                <FilterDropdown
                  value={statusFilter}
                  onChange={onStatusFilterChange}
                  options={[
                    { value: 'all', label: t('filters.anyStatus') },
                    { value: 'active', label: getAccountStatusLabel('active') },
                    { value: 'banned', label: getAccountStatusLabel('banned') },
                    { value: 'limit_hit', label: getAccountStatusLabel('limit_hit') },
                    { value: 'expired', label: getAccountStatusLabel('expired') },
                    { value: 'unknown', label: getAccountStatusLabel('unknown') },
                  ]}
                  triggerClassName="h-8 min-w-[128px] px-2.5 text-xs"
                  menuClassName="min-w-[200px]"
                  showActiveState
                />

                <FilterDropdown
                  value={tagFilter}
                  onChange={onTagFilterChange}
                  options={tagOptions}
                  triggerClassName="h-8 min-w-[108px] px-2.5 text-xs"
                  menuClassName="min-w-[200px]"
                  showActiveState
                />

                <FilterDropdown
                  value={relationFilter}
                  onChange={onRelationFilterChange}
                  options={relationOptions}
                  triggerClassName="h-8 min-w-[108px] px-2.5 text-xs"
                  menuClassName="min-w-[200px]"
                  showActiveState
                />

                <FilterDropdown
                  value={quotaFilter}
                  onChange={onQuotaFilterChange}
                  options={[
                    { value: 'any', label: t('filters.any') },
                    { value: 'has_quota', label: t('filters.hasQuota') },
                    { value: 'low_quota', label: t('filters.lowQuota') },
                    { value: 'empty', label: t('filters.empty') },
                    { value: 'full', label: t('filters.full') },
                  ]}
                  triggerClassName="h-8 min-w-[108px] px-2.5 text-xs"
                  menuClassName="min-w-[200px]"
                  showActiveState
                />
              </ToolbarFiltersGroup>
            )}
          </div>
        ) : (
          <div className="text-[11px] text-slate-500">
            {t('accounts.sheetsIntegration')}
            {sheetsUpdatedAt
              ? ` • ${t('logs.lastUpdated')} ${new Date(sheetsUpdatedAt).toLocaleString()}`
              : ''}
          </div>
        )}
      </div>
    </StickyToolbar>
  );
}
