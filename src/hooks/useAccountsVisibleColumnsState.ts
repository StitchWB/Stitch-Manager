import { useCallback, useMemo, useState } from 'react';
import type { AccountsVisibleColumns } from '../components/accounts/AccountsColumnsMenu';

type UseAccountsVisibleColumnsStateArgs = {
  initial?: AccountsVisibleColumns | null;
  onPersist: (next: AccountsVisibleColumns) => void;
};

type UseAccountsVisibleColumnsStateResult = {
  visibleColumns: AccountsVisibleColumns;
  handleToggleVisibleColumn: (column: keyof AccountsVisibleColumns, value: boolean) => void;
  handleResetVisibleColumns: () => void;
};

const defaultVisibleColumns: AccountsVisibleColumns = {
  lastLogin: true,
  apiKey: true,
  quota: true,
};

export function useAccountsVisibleColumnsState({
  initial,
  onPersist,
}: UseAccountsVisibleColumnsStateArgs): UseAccountsVisibleColumnsStateResult {
  const [visibleColumns, setVisibleColumns] = useState<AccountsVisibleColumns>(
    initial ? { ...defaultVisibleColumns, ...initial } : defaultVisibleColumns
  );

  const handleToggleVisibleColumn = useCallback(
    (column: keyof AccountsVisibleColumns, value: boolean) => {
      setVisibleColumns(current => {
        const next = { ...current, [column]: value };
        onPersist(next);
        return next;
      });
    },
    [onPersist]
  );

  const handleResetVisibleColumns = useCallback(() => {
    const next = { ...defaultVisibleColumns };
    setVisibleColumns(next);
    onPersist(next);
  }, [onPersist]);

  return useMemo(
    () => ({
      visibleColumns,
      handleToggleVisibleColumn,
      handleResetVisibleColumns,
    }),
    [visibleColumns, handleToggleVisibleColumn, handleResetVisibleColumns]
  );
}
