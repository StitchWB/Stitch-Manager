import {
  getMarketplace,
  installMarketplacePlugin,
  uninstallMarketplacePlugin,
  BackendError,
  type MarketplaceFeeds,
  type MarketplaceItem,
  type MarketplaceSource,
} from '../lib/backend';
import { detailToMessage } from '../lib/errorText';
import { createAsyncStore } from '../lib/store/createAsyncStore';

interface MarketplaceState {
  items: MarketplaceItem[];
  activated: boolean;
  feeds: MarketplaceFeeds | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  /** id of the plugin currently being installed/uninstalled, or null. */
  actionInProgress: string | null;

  fetchMarketplace: (reset?: boolean) => Promise<void>;
  installPlugin: (id: string, source: MarketplaceSource) => Promise<void>;
  uninstallPlugin: (id: string, source: MarketplaceSource) => Promise<void>;
}

export const useMarketplaceStore = createAsyncStore<MarketplaceState>({
  name: 'marketplace-store',
  devtools: true,
  initial: {
    items: [],
    activated: false,
    feeds: null,
    loading: false,
    refreshing: false,
    error: null,
    actionInProgress: null,
  },
  actions: (set, get) => ({
    fetchMarketplace: async (reset = false) => {
      const { loading, refreshing, items } = get();
      // an in-flight refresh blocks concurrent reset; only a first load sets `loading`
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
          feeds: data.feeds ?? null,
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
          throw new Error(detailToMessage(result.error, 'install failed'));
        }
        // fetchMarketplace does not touch `actionInProgress`, so clear it only after the refresh settles
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
          throw new Error(detailToMessage(result.error, 'uninstall failed'));
        }
        await get().fetchMarketplace(true);
      } finally {
        set({ actionInProgress: null });
      }
    },
  }),
});
