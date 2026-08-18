import type { Account } from '../../types/generated';
import AccountsTable from '../AccountsTable';
import type { AccountsTableProps } from '../AccountsTable';

import { t } from '@/lib/i18n';
import { Users } from 'lucide-react';
import type { AccountsVisibleColumns } from './AccountsColumnsMenu';
import { EmptyState, SkeletonLoader } from '@/components/ui';

interface AccountsTableSectionProps {
  accounts: Account[];
  loading: boolean;
  visibleColumns: AccountsVisibleColumns;
  tagFilter: string;
  searchQuery: string;
  statusFilter: string;
  quotaFilter: string;
  relationFilter: string;
  tableProps: Omit<AccountsTableProps, 'accounts' | 'isLoading' | 'visibleColumns'>;
  sectionClassName?: string;
}

export function AccountsTableSection({
  accounts,
  loading,
  visibleColumns,
  tagFilter,
  searchQuery,
  statusFilter,
  quotaFilter,
  relationFilter,
  tableProps,
  sectionClassName,
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
      <AccountsTable
        {...tableProps}
        accounts={accounts}
        isLoading={loading}
        visibleColumns={visibleColumns}
      />
    </div>
  );
}
