import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';

type UseAccountsPageLifecycleArgs = {
  fetchAccounts: () => void | Promise<void>;
};

export function useAccountsPageLifecycle({ fetchAccounts }: UseAccountsPageLifecycleArgs) {
  useEffect(() => {
    // Initial load
    fetchAccounts();

    // Listen for account-created events from backend
    const unlistenPromise = listen('account-created', () => {
      fetchAccounts();
    });

    // Refresh on tab focus/visibility, not by a tight interval.
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchAccounts();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      unlistenPromise.then(unlisten => unlisten());
    };
  }, [fetchAccounts]);
}
