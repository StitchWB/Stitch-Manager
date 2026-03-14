import type { Account } from '../../types';
import AccountsTable from '../AccountsTable';
import type { AccountsTableProps } from '../AccountsTable';

import { t } from '../../lib/i18n';
import { Users } from 'lucide-react';
import { ProfileSessionsPanel } from './ProfileSessionsPanel';
import type { AccountsVisibleColumns } from './AccountsColumnsMenu';
import { EmptyState, SkeletonLoader } from '@/components/ui';

interface AccountsTableSectionProps {
  accounts: Account[];
  loading: boolean;
  visibleColumns: AccountsVisibleColumns;
  selectedIdsSize: number;
  tagFilter: string;
  searchQuery: string;
  statusFilter: string;
  quotaFilter: string;
  relationFilter: string;
  onCreateProfilesForSelected: () => Promise<void>;
  onBatchProfileAction: (mode: 'open' | 'confirm' | 'clear') => Promise<void>;
  tableProps: Omit<AccountsTableProps, 'accounts' | 'isLoading' | 'visibleColumns'>;
  sectionClassName?: string;
  profilePanelClassName?: string;
  showHintWhenEmpty?: boolean;
}

export function AccountsTableSection({
  accounts,
  loading,
  visibleColumns,
  selectedIdsSize,
  tagFilter,
  searchQuery,
  statusFilter,
  quotaFilter,
  relationFilter,
  onCreateProfilesForSelected,
  onBatchProfileAction,
  tableProps,
  sectionClassName,
  profilePanelClassName,
  showHintWhenEmpty = false,
}: AccountsTableSectionProps) {
  if (loading && accounts.length === 0) {
    return (
      <div className="p-6">
        <SkeletonLoader variant="table-row" count={6} />
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title={t('accounts.noAccountsFound')}
        description={
          searchQuery.trim() ||
          statusFilter !== 'all' ||
          quotaFilter !== 'any' ||
          tagFilter !== 'all' ||
          relationFilter !== 'all'
            ? t('accounts.noAccountsFoundDesc')
            : t('accounts.addFirstAccountToStart')
        }
      />
    );
  }

  return (
    <div className={sectionClassName ?? 'flex flex-col h-full'}>
      {(selectedIdsSize > 0 || tagFilter.startsWith('profile:')) && (
        <ProfileSessionsPanel
          selectedCount={selectedIdsSize}
          showHintWhenEmpty={showHintWhenEmpty}
          className={
            profilePanelClassName ??
            'mx-6 mt-4 rounded-xl border border-white/5 bg-[#0f1115]/60 p-4'
          }
          onCreateProfiles={onCreateProfilesForSelected}
          onOpen={() => onBatchProfileAction('open')}
          onConfirm={() => onBatchProfileAction('confirm')}
          onClear={() => onBatchProfileAction('clear')}
        />
      )}

      <AccountsTable
        {...tableProps}
        accounts={accounts}
        isLoading={loading}
        visibleColumns={visibleColumns}
      />
    </div>
  );
}
