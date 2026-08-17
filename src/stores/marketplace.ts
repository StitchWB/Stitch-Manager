import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import {
  getMarketplace,
  installMarketplacePlugin,
  uninstallMarketplacePlugin,
  BackendError,
  type MarketplaceItem,
  type MarketplaceSource,
} from '../lib/backend';

// ============================================
// Types
// ============================================

interface MarketplaceState {
  items: MarketplaceItem[];
  activated: boolean;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  /** id of the plugin currently being installed/uninstalled, or null. */
  actionInProgress: string | null;

  fetchMarketplace: (reset?: boolean) => Promise<void>;
  installPlugin: (id: string, source: MarketplaceSource) => Promise<void>;
  uninstallPlugin: (id: string, source: MarketplaceSource) => Promise<void>;
}

// ============================================
// Store
// ============================================

export const useMarketplaceStore = create<MarketplaceState>()(
  devtools(
    (set, get) => ({
      items: [],
      activated: false,
      loading: false,
      refreshing: false,
      error: null,
      actionInProgress: null,

      fetchMarketplace: async (reset = false) => {
        const { loading, refreshing, items } = get();
        // Guard: a refresh (reset with existing rows) blocks both reset and
        // load-more until it settles. A true first load sets `loading`.
        if (refreshing || (reset && loading)) return;
        const isRefresh = reset && items.length > 0;
        set(
          isRefresh
            ? { refreshing: true, error: null }
            : { loading: true, error: null }
        );
        try {
          const data = await getMarketplace();
          set({
            items: data.items,
            activated: data.activated,
            loading: false,
            refreshing: false,
            error: null,
          });
        } catch (err) {
          const message = err instanceof BackendError ? err.message : String(err);
          set({ loading: false, refreshing: false, error: message });
        }
      },

      installPlugin: async (id, source) => {
        if (get().actionInProgress !== null) return;
        set({ actionInProgress: id });
        try {
          const result = await installMarketplacePlugin({ id, source });
          if (!result.success) {
            throw new Error(result.error ?? 'install failed');
          }
          // Refresh the list to reflect the new installed state. The refresh
          // sets `refreshing` but does not touch `actionInProgress`, so we
          // clear it explicitly after the refresh settles.
          await get().fetchMarketplace(true);
        } finally {
          set({ actionInProgress: null });
        }
      },

      uninstallPlugin: async (id, source) => {
        if (get().actionInProgress !== null) return;
        set({ actionInProgress: id });
        try {
          const result = await uninstallMarketplacePlugin({ id, source });
          if (!result.success) {
            throw new Error(result.error ?? 'uninstall failed');
          }
          await get().fetchMarketplace(true);
        } finally {
          set({ actionInProgress: null });
        }
      },
    }),
    { name: 'marketplace-store' }
  )
);
