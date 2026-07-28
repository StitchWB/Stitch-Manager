import { useEffect } from 'react';
import type { ScenarioRecordItem } from '@/lib/backend/modules/pythonJobs';

function isTextInputTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable ||
    Boolean(target.closest('[contenteditable="true"]'))
  );
}

type UseReplayStartHotkeyParams = {
  isOpen: boolean;
  canStart: boolean;
  onStart: () => void;
};

export function useReplayStartHotkey({ isOpen, canStart, onStart }: UseReplayStartHotkeyParams) {
  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key !== 'Enter') return;
      if (!canStart) return;
      if (isTextInputTarget(event.target)) return;

      event.preventDefault();
      onStart();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [canStart, isOpen, onStart]);
}

type UseReplayListNavigationParams = {
  isOpen: boolean;
  items: ScenarioRecordItem[];
  selectedPath: string;
  onSelectPath: (path: string) => void;
};

export function useReplayListNavigation({
  isOpen,
  items,
  selectedPath,
  onSelectPath,
}: UseReplayListNavigationParams) {
  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (isTextInputTarget(event.target)) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (items.length === 0) return;

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const currentIndex = items.findIndex(item => item.scenarioPath === selectedPath.trim());
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        const nextIndex =
          currentIndex === -1
            ? delta > 0
              ? 0
              : items.length - 1
            : (currentIndex + delta + items.length) % items.length;
        const next = items[nextIndex];
        if (!next) return;
        onSelectPath(next.scenarioPath);
        return;
      }

      if (event.key === 'Enter') {
        const alreadySelected = items.some(item => item.scenarioPath === selectedPath.trim());
        if (!alreadySelected) {
          event.preventDefault();
          onSelectPath(items[0]?.scenarioPath ?? '');
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, items, onSelectPath, selectedPath]);
}
