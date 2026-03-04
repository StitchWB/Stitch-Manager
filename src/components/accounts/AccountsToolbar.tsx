import {
  Download,
  FileSpreadsheet,
  LayoutGrid,
  List,
  Plus,
  RefreshCw,
  Search,
  Share2,
  Upload,
} from 'lucide-react';
import { t } from '../../lib/i18n';
import { getAccountStatusLabel } from '../../lib/accountStatus';
import { ActionButtonGroup } from '../ui/ActionButtonGroup';
import { Button } from '../ui/Button';
import { FilterDropdown, type FilterOption } from '../ui/FilterDropdown';
import { Input } from '../ui/Input';
import { SegmentedControl } from '../ui/SegmentedControl';
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
    <div className="shrink-0 border-b border-white/5 bg-[#0b0b10]/85 px-6 py-4 backdrop-blur-xl">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_auto]">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <AccountsEntityTabs
              value={normalizedEntityFilter}
              onChange={onEntityFilterChange}
              accountsCount={accountsCount}
              profilesCount={profilesCount}
            />

            {showAccountsModes && (
              <SegmentedControl
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
                size="sm"
                className="shrink-0"
              />
            )}
          </div>

          {resolvedViewMode === 'list' ? (
            <div className="flex min-w-0 flex-col gap-4">
              <Input
                value={searchQuery}
                onChange={event => onSearchQueryChange(event.target.value)}
                placeholder={t('accounts.searchPlaceholder')}
                leftIcon={<Search className="h-4 w-4" />}
                className="h-9 text-sm text-white placeholder-slate-400"
                shellClassName="border-white/10 bg-black/40 focus-within:border-indigo-500/40 focus-within:bg-black/60"
                containerClassName="w-full min-w-[260px] max-w-md"
              />

              <div className="relative z-20 flex flex-nowrap items-center gap-2 overflow-x-auto rounded-lg border border-white/10 bg-white/[0.02] px-2 py-2 [scrollbar-width:thin] lg:flex-wrap">
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
                  label={t('filters.status')}
                  triggerClassName="h-9 min-w-[148px]"
                  menuClassName="min-w-[220px]"
                  showActiveState
                />

                <FilterDropdown
                  value={tagFilter}
                  onChange={onTagFilterChange}
                  options={tagOptions}
                  label={t('accounts.tags')}
                  triggerClassName="h-9 min-w-[132px]"
                  menuClassName="min-w-[220px]"
                  showActiveState
                />

                <FilterDropdown
                  value={relationFilter}
                  onChange={onRelationFilterChange}
                  options={relationOptions}
                  label={t('accounts.relationFilterLabel')}
                  triggerClassName="h-9 min-w-[132px]"
                  menuClassName="min-w-[220px]"
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
                  label={t('filters.quota')}
                  triggerClassName="h-9 min-w-[132px]"
                  menuClassName="min-w-[220px]"
                  showActiveState
                />
              </div>
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

        <div className="flex flex-wrap items-center justify-start gap-2 xl:justify-end">
          {resolvedViewMode === 'list' ? (
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
              className="h-9 rounded-lg bg-transparent px-2"
            />
          ) : (
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
          )}

          {resolvedViewMode === 'list' ? (
            <AccountsColumnsMenu
              visibleColumns={visibleColumns}
              onToggleColumn={onToggleVisibleColumn}
              onReset={onResetVisibleColumns}
            />
          ) : null}

          <div className="flex items-center gap-2">
            <Button
              onClick={onOpenAutoReg}
              variant="secondary"
              size="sm"
              className="h-9 rounded-lg"
            >
              <span className="hidden sm:inline">{t('sidebar.autoReg')}</span>
              <span className="sm:hidden">АР</span>
            </Button>
            <Button
              onClick={onCreateStandaloneProfile}
              variant="secondary"
              size="sm"
              className="h-9 rounded-lg"
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
              className="h-9 rounded-lg shadow-none"
            >
              <span className="hidden sm:inline">{t('accounts.addAccount')}</span>
              <span className="sm:hidden">{t('common.add')}</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
