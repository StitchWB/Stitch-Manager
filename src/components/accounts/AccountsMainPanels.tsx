import { FileSpreadsheet, Share2 } from 'lucide-react';
import type { Account } from '../../types/generated';
import type { ProfileItem } from '../ProfilesTable';
import { t } from '@/lib/i18n';
import {
  extractRelationEdges,
  extractRelationHints,
  type RelationType,
} from '../../lib/accounts/relations';
import type { AccountsVisibleColumns } from './AccountsColumnsMenu';
import { AccountsTabContent } from './AccountsTabContent';
import { ServiceAccountsPanel } from './ServiceAccountsPanel';
import { DolphinProfilesPanel } from './DolphinProfilesPanel';
import { IdentityGraphPanel } from './IdentityGraphPanel';
import { SheetsExplorerPanel } from './SheetsExplorerPanel';
import { ProfilesSection } from './ProfilesSection';
import { AccountsTableSection } from './AccountsTableSection';
import type { AccountsTableProps } from '../AccountsTable';
import type { GoogleSheetsDataset } from '../../types/googleSheets';

type AccountsTableBaseProps = Omit<
  AccountsTableProps,
  | 'accounts'
  | 'isLoading'
  | 'visibleColumns'
  | 'relationEdgesById'
  | 'relationHintsById'
  | 'onRelationEdgeClick'
>;

interface AccountsMainPanelsProps {
  resolvedViewMode: 'list' | 'graph' | 'sheets';
  entityFilter: string;
  sheetsUpdatedAt: string | null;
  sheetsDataset: GoogleSheetsDataset | null;
  sheetsLoading: boolean;
  sheetsError: string | null;
  onRefreshSheets: () => Promise<void>;
  onNavigateToGraphFromSheets: (payload: {
    sheetName: string;
    serviceAccountId?: string;
    login?: string;
  }) => void;
  profileAliases: string[];
  profilesLoading: boolean;
  visibleProfileItems: ProfileItem[];
  onEditProfile: (alias: string) => void;
  onOpenStandaloneProfile: (alias: string, target: string, customUrl?: string) => Promise<void>;
  onDeleteProfile: (alias: string) => Promise<void>;
  onOpenProfileScenarios?: (alias: string) => void;
  openTarget: string;
  customUrl: string;
  selectedIdsSize: number;
  tagFilter: string;
  onCreateProfilesForSelected: () => Promise<void>;
  onBatchProfileAction: (action: 'open' | 'confirm' | 'clear') => Promise<void>;
  filteredAccounts: Account[];
  loading: boolean;
  searchQuery: string;
  statusFilter: string;
  quotaFilter: string;
  relationFilter: string;
  visibleColumns: AccountsVisibleColumns;
  baseAccountsTableProps: AccountsTableBaseProps;
  onRelationEdgeClickInAll: (edgeType: RelationType, targetProvider: string) => void;
  onRelationEdgeClickInAccounts: (edgeType: RelationType, targetProvider: string) => void;
}

export function AccountsMainPanels({
  resolvedViewMode,
  entityFilter,
  sheetsUpdatedAt,
  sheetsDataset,
  sheetsLoading,
  sheetsError,
  onRefreshSheets,
  onNavigateToGraphFromSheets,
  profileAliases,
  profilesLoading,
  visibleProfileItems,
  onEditProfile,
  onOpenStandaloneProfile,
  onDeleteProfile,
  onOpenProfileScenarios,
  openTarget,
  customUrl,
  tagFilter,
  filteredAccounts,
  loading,
  searchQuery,
  statusFilter,
  quotaFilter,
  relationFilter,
  visibleColumns,
  baseAccountsTableProps,
  onRelationEdgeClickInAll,
  onRelationEdgeClickInAccounts,
}: AccountsMainPanelsProps) {
  const relationEdgesById = Object.fromEntries(
    filteredAccounts.map(acc => [acc.id, extractRelationEdges(acc)])
  );

  const relationHintsById = Object.fromEntries(
    filteredAccounts.map(acc => [acc.id, extractRelationHints(acc)])
  );

  return (
    <AccountsTabContent>
      {resolvedViewMode === 'graph' ? (
        <ServiceAccountsPanel
          header={
            <div className="flex items-center justify-between border-b border-white/5 bg-vsc-bg/60 px-6 py-3 text-xs text-slate-400">
              <div className="flex items-center gap-2">
                <Share2 className="h-4 w-4 text-indigo-400" />
                <span className="font-semibold text-white">{t('accounts.relationGraphTitle')}</span>
              </div>
              {sheetsUpdatedAt && (
                <span className="text-[11px] text-slate-500">
                  {t('logs.lastUpdated')} {new Date(sheetsUpdatedAt).toLocaleString()}
                </span>
              )}
            </div>
          }
          body={
            <IdentityGraphPanel
              dataset={sheetsDataset}
              isLoading={sheetsLoading}
              error={sheetsError}
              onRetry={onRefreshSheets}
              localProfiles={profileAliases}
            />
          }
        />
      ) : resolvedViewMode === 'sheets' ? (
        <ServiceAccountsPanel
          header={
            <div className="flex items-center justify-between border-b border-white/5 bg-vsc-bg/60 px-6 py-3 text-xs text-slate-400">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="h-4 w-4 text-emerald-400" />
                <span className="font-semibold text-white">
                  {t('accounts.sheetsExplorerTitle')}
                </span>
              </div>
              {sheetsUpdatedAt && (
                <span className="text-[11px] text-slate-500">
                  {t('logs.lastUpdated')} {new Date(sheetsUpdatedAt).toLocaleString()}
                </span>
              )}
            </div>
          }
          body={
            <SheetsExplorerPanel
              dataset={sheetsDataset}
              isLoading={sheetsLoading}
              error={sheetsError}
              onRetry={onRefreshSheets}
              onNavigateToGraph={onNavigateToGraphFromSheets}
            />
          }
        />
      ) : entityFilter === 'profiles' ? (
        <DolphinProfilesPanel
          body={
            <ProfilesSection
              profilesLoading={profilesLoading}
              profiles={visibleProfileItems}
              onEdit={onEditProfile}
              onOpen={onOpenStandaloneProfile}
              onDelete={onDeleteProfile}
              onOpenScenarios={onOpenProfileScenarios}
              openTarget={openTarget}
              customUrl={customUrl}
            />
          }
        />
      ) : entityFilter === 'all' ? (
        <div className="flex h-full flex-col overflow-auto">
          <div className="px-6 pt-4 pb-2 text-xs uppercase tracking-widest text-slate-500">
            {t('accounts.entityAccounts')}
          </div>

          <AccountsTableSection
            sectionClassName="flex flex-col h-[55%] min-h-[260px]"
            accounts={filteredAccounts}
            loading={loading}
            visibleColumns={visibleColumns}
            tagFilter={tagFilter}
            searchQuery={searchQuery}
            statusFilter={statusFilter}
            quotaFilter={quotaFilter}
            relationFilter={relationFilter}
            tableProps={{
              ...baseAccountsTableProps,
              relationEdgesById,
              relationHintsById,
              onRelationEdgeClick: onRelationEdgeClickInAll,
            }}
          />

          <div className="border-t border-white/5 px-6 pt-4 pb-2 text-xs uppercase tracking-widest text-slate-500">
            {t('accounts.entityProfiles')}
          </div>

          <ProfilesSection
            className="flex flex-col h-[45%] min-h-[220px] pb-4"
            skeletonCount={4}
            profilesLoading={profilesLoading}
            profiles={visibleProfileItems}
            onEdit={onEditProfile}
            onOpen={onOpenStandaloneProfile}
            onDelete={onDeleteProfile}
            onOpenScenarios={onOpenProfileScenarios}
            openTarget={openTarget}
            customUrl={customUrl}
          />
        </div>
      ) : (
        <ServiceAccountsPanel
          body={
            <AccountsTableSection
              accounts={filteredAccounts}
              loading={loading}
              visibleColumns={visibleColumns}
              tagFilter={tagFilter}
              searchQuery={searchQuery}
              statusFilter={statusFilter}
              quotaFilter={quotaFilter}
              relationFilter={relationFilter}
              tableProps={{
                ...baseAccountsTableProps,
                relationEdgesById,
                relationHintsById,
                onRelationEdgeClick: onRelationEdgeClickInAccounts,
              }}
            />
          }
        />
      )}
    </AccountsTabContent>
  );
}
