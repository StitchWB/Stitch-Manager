import { useCallback, useMemo, useState } from 'react';
import type { UIEvent } from 'react';

interface UseVirtualSliceOptions<T> {
  items: T[];
  rowHeight: number;
  threshold?: number;
  overscan?: number;
  defaultViewportHeight?: number;
}

interface VirtualSlice<T> {
  rows: T[];
  topSpacer: number;
  bottomSpacer: number;
  virtualized: boolean;
  onScroll: (event: UIEvent<HTMLElement>) => void;
}

export function useVirtualSlice<T>({
  items,
  rowHeight,
  threshold = 80,
  overscan = 8,
  defaultViewportHeight = 520,
}: UseVirtualSliceOptions<T>): VirtualSlice<T> {
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(defaultViewportHeight);
  const virtualized = items.length > threshold;

  const onScroll = useCallback((event: UIEvent<HTMLElement>) => {
    const target = event.currentTarget;
    setScrollTop(target.scrollTop);
    setViewportHeight(target.clientHeight);
  }, []);

  return useMemo(() => {
    if (!virtualized) {
      return { rows: items, topSpacer: 0, bottomSpacer: 0, virtualized, onScroll };
    }

    const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
    const visibleCount = Math.ceil(Math.max(viewportHeight, 1) / rowHeight) + overscan * 2;
    const endIndex = Math.min(items.length, startIndex + visibleCount);

    return {
      rows: items.slice(startIndex, endIndex),
      topSpacer: startIndex * rowHeight,
      bottomSpacer: Math.max(0, (items.length - endIndex) * rowHeight),
      virtualized,
      onScroll,
    };
  }, [items, rowHeight, overscan, virtualized, scrollTop, viewportHeight, onScroll]);
}