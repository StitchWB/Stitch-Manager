import { useEffect } from 'react';

type VisibleAccount = {
  id: number;
};

type UseConstrainSelectionToVisibleAccountsArgs = {
  visibleAccounts: VisibleAccount[];
  selectedIds: Set<number>;
  setSelectedIds: (ids: number[]) => void;
};

export function useConstrainSelectionToVisibleAccounts({
  visibleAccounts,
  selectedIds,
  setSelectedIds,
}: UseConstrainSelectionToVisibleAccountsArgs) {
  useEffect(() => {
    const visibleIds = new Set(visibleAccounts.map(a => a.id));
    const nextSelected = Array.from(selectedIds).filter(id => visibleIds.has(id));
    if (nextSelected.length !== selectedIds.size) {
      setSelectedIds(nextSelected);
    }
  }, [visibleAccounts, selectedIds, setSelectedIds]);
}
