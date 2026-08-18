import {
  Battery,
  Bot,
  ClipboardPaste,
  Download,
  FileSpreadsheet,
  Globe,
  LayoutGrid,
  List,
  Plus,
  RefreshCw,
  Share2,
  Tag,
  Upload,
} from 'lucide-react';
import { t } from '@/lib/i18n';
import { cn } from '../../lib/utils';
import { getAccountStatusLabel } from '../../lib/accountStatus';
import {
  ActionButtonGroup,
  Button,
  Checkbox,
  FilterDropdown,
  IconButton,
  Input,
  ViewModeSwitch,
  StickyToolbar,
  ToolbarRow,
  ToolbarFiltersGroup,
  ToolbarSearchField,
  ToolbarActionsCluster,
  type FilterOption,
  Tooltip,
} from '@/components/ui';
import type { AccountsEntityTab } from './AccountsEntityTabs';
import { AccountsEntityTabs } from './AccountsEntityTabs';
import { AccountsColumnsMenu, type AccountsVisibleColumns } from './AccountsColumnsMenu';
import { PROVIDERS } from '@/constants/providers';
import { useAuthStore } from '@/stores/auth';

type ViewMode = 'list' | 'graph' | 'sheets';

interface AccountsToolbarProps {
  resolvedViewMode: ViewMode;
  showAccountsModes: boolean;
  normalizedEntityFilter: AccountsEntityTab;
  accountsCount: number;
  profilesCount: number;
  searchQuery: string;
  providerFilter: string;
  statusFilter: string;
  tagFilter: string;
  relationFilter: string;
  quotaFilter: string;
  providerCounts: Record<string, number>;
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
  showArchived: boolean;
  onShowArchivedChange: (value: boolean) => void;
  onEntityFilterChange: (value: AccountsEntityTab) => void;
  onViewModeChange: (value: string) => void;
  onSearchQueryChange: (value: string) => void;
  onProviderFilterChange: (value: string) => void;
  onStatusFilterChange: (value: string) => void;
  onTagFilterChange: (value: string) => void;
  onRelationFilterChange: (value: string) => void;
  onQuotaFilterChange: (value: string) => void;
  onProfileFilterChange: (value: 'all' | 'standalone' | 'linked' | 'used_kiro') => void;
  onProfileOpenTargetChange: (value: string) => void;
  onProfileCustomUrlChange: (value: string) => void;
  onRefreshAll: () => void;
  onImportAccounts: () => void;
  onImportFromClipboard: () => void;
  onExportCSV: () => void;
  onTestSheets: () => void;
  onRefreshSheets: () => void;
  onToggleSheetsConfig: () => void;
  onOpenAutoReg: () => void;
  onCreateProfile: () => void;
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
  providerFilter,
  statusFilter,
  tagFilter,
  relationFilter,
  quotaFilter,
  profileListFilter,
  profileOpenTarget,
  profileCustomUrl,
  tagOptions,
  relationOptions,
  providerCounts,
  sheetsUpdatedAt,
  isBulkRefreshing,
  isImporting,
  filteredAccountsCount,
  sheetsTestStatus,
  sheetsLoading,
  hasSheetsParams,
  showSheetsConfig,
  visibleColumns,
  showArchived,
  onShowArchivedChange,
  onEntityFilterChange,
  onViewModeChange,
  onSearchQueryChange,
  onProviderFilterChange,
  onStatusFilterChange,
  onTagFilterChange,
  onRelationFilterChange,
  onQuotaFilterChange,
  onProfileFilterChange,
  onProfileOpenTargetChange,
  onProfileCustomUrlChange,
  onRefreshAll,
  onImportAccounts,
  onImportFromClipboard,
  onExportCSV,
  onTestSheets,
  onRefreshSheets,
  onToggleSheetsConfig,
  onOpenAutoReg,
  onCreateProfile,
  onAddAccount,
  onToggleVisibleColumn,
  onResetVisibleColumns,
}: AccountsToolbarProps) {
  const isAccountsList = resolvedViewMode === 'list' && normalizedEntityFilter !== 'profiles';
  const isProfilesList = resolvedViewMode === 'list' && normalizedEntityFilter === 'profiles';
  const isSheetsView = resolvedViewMode !== 'list';
  const hasPermission = useAuthStore(state => state.hasPermission);
  const canExport = hasPermission('action.export_accounts');

  return (
    <StickyToolbar
      topClassName="top-0"
      className="shrink-0 px-6 py-3"
    >
      <div className="flex flex-col gap-4 w-full">
        {/* Row 1: Navigation (Tabs left) + View Switcher (right-center) + Actions (far right) */}
        <div className="flex items-center justify-between gap-4 w-full">
          {/* Left: Tabs only */}
          <ToolbarRow className="gap-3 items-center">
            <AccountsEntityTabs
              value={normalizedEntityFilter}
              onChange={onEntityFilterChange}
              accountsCount={accountsCount}
              profilesCount={profilesCount}
            />
          </ToolbarRow>

          {/* Right: View Switcher + Utility Actions + Primary Button */}
          <div className="flex items-center gap-2">
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

            {/* Divider between view switcher and utility actions */}
            {showAccountsModes && <div className="h-6 w-px bg-white/10 shrink-0" />}

            <ToolbarActionsCluster className="gap-2" align="end">
            {/* Utility Group: Refresh/Import/Export */}
            {isAccountsList ? (
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
                    icon: ClipboardPaste,
                    label: t('accounts.importFromClipboard'),
                    onClick: onImportFromClipboard,
                    disabled: isImporting,
                    loading: isImporting,
                  },
                  ...(canExport ? [{
                    icon: Download,
                    label: t('accounts.exportCsv'),
                    onClick: onExportCSV,
                    disabled: filteredAccountsCount === 0,
                  }] : []),
                ]}
                spacing="tight"
                size="sm"
                className="h-8 rounded-lg bg-transparent px-1"
              />
            ) : isSheetsView ? (
              <div className="flex items-center gap-2">
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
              </div>
            ) : null}

            {/* Columns Menu */}
            {isAccountsList ? (
              <>
                <div className="h-6 w-px bg-white/10 shrink-0" />
                <AccountsColumnsMenu
                  visibleColumns={visibleColumns}
                  onToggleColumn={onToggleVisibleColumn}
                  onReset={onResetVisibleColumns}
                />
              </>
            ) : null}

            {/* Compact IconButton: Auto-Reg (accounts tab only) */}
            {isAccountsList ? (
              <>
                <div className="h-6 w-px bg-white/10 shrink-0" />
                <Tooltip content={t('sidebar.autoReg')}>
                  <IconButton
                    size="sm"
                    variant="ghost"
                    onClick={onOpenAutoReg}
                    className="h-8 w-8 rounded-lg"
                  >
                    <Bot size={16} />
                  </IconButton>
                </Tooltip>
              </>
            ) : null}

            {/* Divider before primary button */}
            <div className="h-6 w-px bg-white/10 shrink-0" />

            {/* Primary action: Add Account (accounts tab) / Create Profile (profiles tab) */}
            <Button
              onClick={normalizedEntityFilter === 'profiles' ? onCreateProfile : onAddAccount}
              variant="primary"
              size="sm"
              leftIcon={<Plus size={16} />}
              className="h-8 rounded-lg shadow-none whitespace-nowrap"
            >
              <span className="hidden sm:inline">
                {normalizedEntityFilter !== 'profiles'
                  ? t('accounts.addAccount')
                  : t('accounts.profilesCreateButton')}
              </span>
            </Button>
            </ToolbarActionsCluster>
          </div>
        </div>

        {/* Row 2: Search (30%) + Filters (flex-1, fills remaining space) */}
        {resolvedViewMode === 'list' ? (
          <div className="flex items-center gap-3 w-full">
            {/* Search Field - 30% width */}
            <ToolbarSearchField
              value={searchQuery}
              onValueChange={onSearchQueryChange}
              placeholder={t('accounts.searchPlaceholder')}
              shellClassName="border-white/10 bg-black/40 focus-within:border-indigo-500/40 focus-within:bg-black/60 h-8"
              containerClassName="w-[28%] min-w-[160px]"
            />

            {/* Visual separator */}
            <div className="h-6 w-px bg-white/20 shrink-0 mx-1" />

            {/* Filters - fills remaining space */}
            {isProfilesList ? (
              <div className="flex items-center gap-3 w-[60%]">
                <FilterDropdown
                  value={profileListFilter}
                  onChange={value =>
                    onProfileFilterChange(
                      value as 'all' | 'standalone' | 'linked' | 'used_kiro'
                    )
                  }
                  icon={<LayoutGrid size={14} />}
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
                  icon={<Globe size={14} />}
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
                    containerClassName="flex-1 min-w-[200px]"
                    className="h-8"
                  />
                )}
              </div>
            ) : (
              <ToolbarFiltersGroup mobileScrollable className="flex-1">
                <FilterDropdown
                  value={providerFilter}
                  onChange={onProviderFilterChange}
                  icon={<LayoutGrid size={14} />}
                  options={[
                    { value: 'all', label: t('accounts.allProviders'), count: providerCounts.all ?? 0 },
                    ...PROVIDERS.map(p => ({
                      value: p.id,
                      label: p.name,
                      count: providerCounts[p.id] ?? 0,
                    })),
                  ]}
                  triggerClassName="h-8 min-w-[160px] px-2.5 text-xs"
                  menuClassName="min-w-[200px]"
                  showActiveState
                />

                <FilterDropdown
                  value={statusFilter}
                  onChange={onStatusFilterChange}
                  icon={
                    <span className={cn(
                      'h-2.5 w-2.5 rounded-full shrink-0',
                      statusFilter === 'active' ? 'bg-emerald-500' :
                      statusFilter === 'banned' ? 'bg-red-500' :
                      statusFilter === 'limit_hit' ? 'bg-amber-500' :
                      statusFilter === 'expired' ? 'bg-orange-500' :
                      'bg-slate-500'
                    )} />
                  }
                  options={[
                    { value: 'all', label: t('filters.anyStatus'), dot: 'bg-slate-500' },
                    { value: 'active', label: getAccountStatusLabel('active'), dot: 'bg-emerald-500' },
                    { value: 'banned', label: getAccountStatusLabel('banned'), dot: 'bg-red-500' },
                    { value: 'limit_hit', label: getAccountStatusLabel('limit_hit'), dot: 'bg-amber-500' },
                    { value: 'expired', label: getAccountStatusLabel('expired'), dot: 'bg-orange-500' },
                    { value: 'unknown', label: getAccountStatusLabel('unknown'), dot: 'bg-slate-500' },
                  ]}
                  triggerClassName="h-8 min-w-[100px] px-2.5 text-xs"
                  menuClassName="min-w-[200px]"
                  showActiveState
                />

                <FilterDropdown
                  value={tagFilter}
                  onChange={onTagFilterChange}
                  icon={<Tag size={14} />}
                  options={tagOptions}
                  triggerClassName="h-8 min-w-[100px] px-2.5 text-xs"
                  menuClassName="min-w-[200px]"
                  showActiveState
                />

                <FilterDropdown
                  value={relationFilter}
                  onChange={onRelationFilterChange}
                  icon={<Share2 size={14} />}
                  options={relationOptions}
                  triggerClassName="h-8 min-w-[100px] px-2.5 text-xs"
                  menuClassName="min-w-[200px]"
                  showActiveState
                />

                <FilterDropdown
                  value={quotaFilter}
                  onChange={onQuotaFilterChange}
                  icon={<Battery size={14} />}
                  options={[
                    { value: 'any', label: t('filters.any') },
                    { value: 'has_quota', label: t('filters.hasQuota') },
                    { value: 'low_quota', label: t('filters.lowQuota') },
                    { value: 'empty', label: t('filters.empty') },
                    { value: 'full', label: t('filters.full') },
                  ]}
                  triggerClassName="h-8 min-w-[100px] px-2.5 text-xs"
                  menuClassName="min-w-[200px]"
                  showActiveState
                />

                {/* Show archived toggle */}
                <div className="h-5 w-px bg-white/10 shrink-0" />
                <Checkbox
                  className="gap-1.5 py-0 px-0 hover:bg-transparent whitespace-nowrap"
                  label={<span className="text-xs text-slate-400">{t('accounts.showArchived')}</span>}
                  checked={showArchived}
                  onChange={e => onShowArchivedChange(e.target.checked)}
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
