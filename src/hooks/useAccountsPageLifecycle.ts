import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useAccountsStore } from '@/stores/accounts';

type UseAccountsPageLifecycleArgs = {
  fetchAccounts: () => void | Promise<void>;
};

interface QuotaUpdatedPayload {
  accountId: number;
  quotaUsed: number;
  quotaLimit: number;
  resetsAt: string | null;
}

export function useAccountsPageLifecycle({ fetchAccounts }: UseAccountsPageLifecycleArgs) {
  const setProviderQuota = useAccountsStore(state => state.setProviderQuota);
  const clearQuotaCheckError = useAccountsStore(state => state.clearQuotaCheckError);

  useEffect(() => {
    // Initial load
    fetchAccounts();

    // Listen for account-created events from backend
    const unlistenCreated = listen('account-created', () => {
      fetchAccounts();
    });

    // Listen for quota-updated events from background manager
    const unlistenQuota = listen('account:quota-updated', event => {
      const payload = event.payload as QuotaUpdatedPayload;
      const { accountId, quotaUsed, quotaLimit } = payload;
      
      // Always clear any previous error for this account
      clearQuotaCheckError(accountId);
      
      // Always set quota — 0/0 means "checked, nothing available" (expired/invalid key)
      setProviderQuota(accountId, {
        limit: quotaLimit,
        used: quotaUsed,
        remaining: Math.max(0, quotaLimit - quotaUsed),
        checkedAt: Date.now(),
      });
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
      unlistenCreated.then(unlisten => unlisten());
      unlistenQuota.then(unlisten => unlisten());
    };
  }, [fetchAccounts, setProviderQuota, clearQuotaCheckError]);
}
