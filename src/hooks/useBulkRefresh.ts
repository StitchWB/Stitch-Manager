import { useState, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { checkAccountStatus } from '../lib/tauri';
import { useAccountsStore } from '../stores/accounts';
import { t } from '../lib/i18n';

interface BulkRefreshState {
  isRefreshing: boolean;
  progress: { current: number; total: number };
  results: { success: number; failed: number };
  refreshingIds: Set<number>;
}

interface UseBulkRefreshOptions {
  concurrency?: number;
  delayMs?: number;
  onAccountRefreshed?: (accountId: number, success: boolean) => void;
}

/**
 * Hook for bulk refreshing accounts with concurrency control
 * Uses a queue system to avoid rate limiting from provider APIs
 */
export function useBulkRefresh(options: UseBulkRefreshOptions = {}) {
  const { concurrency = 3, delayMs = 500, onAccountRefreshed } = options;
  
  const [state, setState] = useState<BulkRefreshState>({
    isRefreshing: false,
    progress: { current: 0, total: 0 },
    results: { success: 0, failed: 0 },
    refreshingIds: new Set(),
  });
  
  const abortRef = useRef(false);
  const { refreshAccount } = useAccountsStore.getState();

  /**
   * Refresh a single account with live status check
   */
  const refreshSingleAccount = useCallback(async (accountId: number): Promise<boolean> => {
    try {
      // Mark as refreshing
      setState(prev => ({
        ...prev,
        refreshingIds: new Set([...prev.refreshingIds, accountId]),
      }));

      // Call the live status check API
      const statusInfo = await checkAccountStatus({ accountId });
      
      // If we got status info, the account data is updated in the backend
      // Now refresh from DB to get updated data
      await refreshAccount(accountId);
      
      return statusInfo.isActive;
    } catch (error) {
      console.error(`Failed to refresh account ${accountId}:`, error);
      return false;
    } finally {
      // Remove from refreshing set
      setState(prev => {
        const newSet = new Set(prev.refreshingIds);
        newSet.delete(accountId);
        return { ...prev, refreshingIds: newSet };
      });
    }
  }, [refreshAccount]);

  /**
   * Process accounts in batches with concurrency limit
   */
  const processBatch = useCallback(async (
    accountIds: number[],
    startIndex: number,
    onProgress: (current: number, success: number, failed: number) => void
  ): Promise<{ success: number; failed: number }> => {
    let success = 0;
    let failed = 0;
    
    // Process in chunks of `concurrency` size
    for (let i = startIndex; i < accountIds.length && !abortRef.current; i += concurrency) {
      const batch = accountIds.slice(i, i + concurrency);
      
      // Process batch in parallel
      const results = await Promise.all(
        batch.map(async (id) => {
          const result = await refreshSingleAccount(id);
          onAccountRefreshed?.(id, result);
          return result;
        })
      );
      
      // Count results
      results.forEach(result => {
        if (result) success++;
        else failed++;
      });
      
      // Update progress
      const current = Math.min(i + concurrency, accountIds.length);
      onProgress(current, success, failed);
      
      // Delay between batches to avoid rate limiting
      if (i + concurrency < accountIds.length && !abortRef.current) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
    
    return { success, failed };
  }, [concurrency, delayMs, refreshSingleAccount, onAccountRefreshed]);

  /**
   * Start bulk refresh for selected accounts
   */
  const startBulkRefresh = useCallback(async (accountIds: number[]) => {
    if (accountIds.length === 0) return;
    
    abortRef.current = false;
    
    setState({
      isRefreshing: true,
      progress: { current: 0, total: accountIds.length },
      results: { success: 0, failed: 0 },
      refreshingIds: new Set(),
    });

    const { success, failed } = await processBatch(
      accountIds,
      0,
      (current, successCount, failedCount) => {
        setState(prev => ({
          ...prev,
          progress: { current, total: accountIds.length },
          results: { success: successCount, failed: failedCount },
        }));
      }
    );

    setState(prev => ({
      ...prev,
      isRefreshing: false,
      results: { success, failed },
    }));

    // Show toast summary
    if (failed === 0) {
      toast.success(
        t('accounts.syncComplete', { success: success.toString() }) || 
        `Synced ${success} accounts`
      );
    } else {
      toast.warning(
        t('accounts.syncPartial', { success: success.toString(), failed: failed.toString() }) ||
        `Synced ${success}, ${failed} failed`
      );
    }

    return { success, failed };
  }, [processBatch]);

  /**
   * Stop the bulk refresh process
   */
  const stopBulkRefresh = useCallback(() => {
    abortRef.current = true;
  }, []);

  /**
   * Check if a specific account is currently being refreshed
   */
  const isAccountRefreshing = useCallback((accountId: number) => {
    return state.refreshingIds.has(accountId);
  }, [state.refreshingIds]);

  return {
    ...state,
    startBulkRefresh,
    stopBulkRefresh,
    isAccountRefreshing,
  };
}
