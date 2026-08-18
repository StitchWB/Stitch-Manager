import { useEffect, useRef } from 'react';
import { listen } from '@/lib/events';
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

  // Hold the latest fetchAccounts in a ref so event listeners always call the
  // current version without being listed as effect deps (which would cause the
  // effect to re-run — and re-register all listeners — on every store update).
  const fetchAccountsRef = useRef(fetchAccounts);
  useEffect(() => {
    fetchAccountsRef.current = fetchAccounts;
  });

  // setProviderQuota / clearQuotaCheckError are Zustand actions — stable refs,
  // but still extracted into refs to keep the pattern consistent.
  const setProviderQuotaRef = useRef(setProviderQuota);
  const clearQuotaCheckErrorRef = useRef(clearQuotaCheckError);
  useEffect(() => {
    setProviderQuotaRef.current = setProviderQuota;
    clearQuotaCheckErrorRef.current = clearQuotaCheckError;
  });

  useEffect(() => {
    // Initial load on mount
    Promise.resolve(fetchAccountsRef.current()).catch(() => { });

    // Listen for account-created events from backend
    const unlistenCreated = listen('account-created', () => {
      Promise.resolve(fetchAccountsRef.current()).catch(() => { });
    });

    // Listen for accounts persisted by the registration pipeline.
    // Registration emits `registration.account_added` (mapped to ACCOUNT_ADDED),
    // which is a *different* event from `account-created`. Without this listener
    // a freshly registered account would not appear until a manual refresh.
    const unlistenRegAdded = listen('ACCOUNT_ADDED', () => {
      Promise.resolve(fetchAccountsRef.current()).catch(() => { });
    });

    // Listen for quota-updated events from background manager
    const unlistenQuota = listen('account:quota-updated', event => {
      const payload = event.payload as QuotaUpdatedPayload;
      const { accountId, quotaUsed, quotaLimit } = payload;

      clearQuotaCheckErrorRef.current(accountId);
      setProviderQuotaRef.current(accountId, {
        limit: quotaLimit,
        used: quotaUsed,
        remaining: Math.max(0, quotaLimit - quotaUsed),
        checkedAt: Date.now(),
      });
    });

    // Refresh on tab focus/visibility change
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        Promise.resolve(fetchAccountsRef.current()).catch(() => { });
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      unlistenCreated.then(unlisten => unlisten());
      unlistenRegAdded.then(unlisten => unlisten());
      unlistenQuota.then(unlisten => unlisten());
    };
    // Empty deps: register listeners once on mount, clean up on unmount.
    // fetchAccounts / store actions are accessed via refs above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
