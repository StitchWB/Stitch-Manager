import { useCallback } from 'react';
import { useUIPreferencesStore } from '../stores/uiPreferences';
import { useUISessionStore } from '../stores/uiSession';

export type UIStateScope = 'persist' | 'session';

/**
 * Universal UI state hook for the UI Kit pattern.
 *
 * @param key          Unique state key (e.g. "autoreg-tabs", "accounts-modal")
 * @param defaultValue Default value when no state is stored
 * @param scope        'persist' = survive app restart (Zustand + localStorage)
 *                     'session' = reset on app restart (Zustand in-memory)
 *
 * @example
 * const [activeTab, setActiveTab] = useUIState('autoreg-tabs', 'identity', 'persist');
 * const [isOpen, setIsOpen]     = useUIState('details-panel', false, 'session');
 */
export function useUIState<T>(
  key: string,
  defaultValue: T,
  scope: UIStateScope = 'session'
): [T, (value: T | ((prev: T) => T)) => void] {
  if (scope === 'persist') {
    // Persisted state via uiPreferences store
    const value = useUIPreferencesStore(
      useCallback(
        state =>
          key in state.componentPreferences
            ? (state.componentPreferences[key] as T)
            : defaultValue,
        [key, defaultValue]
      )
    );

    const setValue = useCallback(
      (next: T | ((prev: T) => T)) => {
        const store = useUIPreferencesStore.getState();
        const prev =
          key in store.componentPreferences
            ? (store.componentPreferences[key] as T)
            : defaultValue;
        const resolved = typeof next === 'function' ? (next as (prev: T) => T)(prev) : next;
        store.setComponentPreference(key, resolved);
      },
      [key, defaultValue]
    );

    return [value, setValue];
  }

  // Session state via uiSession store (runtime-only)
  const value = useUISessionStore(
    useCallback(
      state =>
        key in state.componentStates
          ? (state.componentStates[key] as T)
          : defaultValue,
      [key, defaultValue]
    )
  );

  const setValue = useCallback(
    (next: T | ((prev: T) => T)) => {
      const store = useUISessionStore.getState();
      const prev =
        key in store.componentStates
          ? (store.componentStates[key] as T)
          : defaultValue;
      const resolved = typeof next === 'function' ? (next as (prev: T) => T)(prev) : next;
      store.setComponentState(key, resolved);
    },
    [key, defaultValue]
  );

  return [value, setValue];
}

/**
 * Convenience hook for persisted UI state (survives app restart).
 */
export function useUIPersistedState<T>(key: string, defaultValue: T) {
  return useUIState(key, defaultValue, 'persist');
}

/**
 * Convenience hook for session UI state (resets on app restart).
 */
export function useUISessionState<T>(key: string, defaultValue: T) {
  return useUIState(key, defaultValue, 'session');
}
