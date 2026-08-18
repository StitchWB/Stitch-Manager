import { useState, useCallback, useMemo } from 'react';

export interface UseSelectionReturn {
  selectedIds: Set<number>;
  isSelected: (id: number) => boolean;
  isAllSelected: (visibleIds: number[]) => boolean;
  toggle: (id: number) => void;
  select: (id: number) => void;
  deselect: (id: number) => void;
  selectAll: (visibleIds: number[]) => void;
  deselectAll: () => void;
  toggleAll: (visibleIds: number[]) => void;
  clear: () => void;
  setSelection: (ids: number[]) => void;
  selectedCount: number;
}

/**
 * Reusable selection hook for tables with checkbox bulk operations.
 *
 * Usage:
 *   const { selectedIds, toggle, selectAll, clear, isAllSelected } = useSelection();
 *
 *   // In table header checkbox:
 *   <Checkbox
 *     checked={isAllSelected(visibleIds)}
 *     onChange={() => toggleAll(visibleIds)}
 *   />
 *
 *   // In row checkbox:
 *   <Checkbox
 *     checked={selectedIds.has(account.id)}
 *     onChange={() => toggle(account.id)}
 *   />
 */
export function useSelection(): UseSelectionReturn {
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const isSelected = useCallback((id: number): boolean => {
    return selectedIds.has(id);
  }, [selectedIds]);

  const isAllSelected = useCallback((visibleIds: number[]): boolean => {
    if (visibleIds.length === 0) return false;
    return visibleIds.every(id => selectedIds.has(id));
  }, [selectedIds]);

  const select = useCallback((id: number) => {
    setSelectedIds(prev => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const deselect = useCallback((id: number) => {
    setSelectedIds(prev => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const toggle = useCallback((id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback((visibleIds: number[]) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      visibleIds.forEach(id => next.add(id));
      return next;
    });
  }, []);

  const deselectAll = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const toggleAll = useCallback((visibleIds: number[]) => {
    if (isAllSelected(visibleIds)) {
      // Deselect only the visible ones (keeps other selections intact)
      setSelectedIds(prev => {
        const next = new Set(prev);
        visibleIds.forEach(id => next.delete(id));
        return next;
      });
    } else {
      selectAll(visibleIds);
    }
  }, [isAllSelected, selectAll]);

  const clear = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const setSelection = useCallback((ids: number[]) => {
    setSelectedIds(new Set(ids));
  }, []);

  const selectedCount = useMemo(() => selectedIds.size, [selectedIds]);

  return {
    selectedIds,
    isSelected,
    isAllSelected,
    toggle,
    select,
    deselect,
    selectAll,
    deselectAll,
    toggleAll,
    clear,
    setSelection,
    selectedCount,
  };
}
