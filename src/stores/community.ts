import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import {
  getFriends,
  getRadarOffers,
  getRadarStats,
  BackendError,
  type FriendItem,
  type RadarOffer,
  type RadarStats,
  type RadarEffort,
} from '../lib/backend';

// ============================================
// Types
// ============================================

export type RadarTab = 'all' | 'easy' | 'medium' | 'hard' | 'dead';
export type RadarSort = 'top' | 'new' | 'amount';
export type RadarPeriod = 'all' | '24h' | '7d' | '30d';

export interface CommunityFilters {
  tab: RadarTab;
  q: string;
  sort: RadarSort;
  period: RadarPeriod;
}

interface CommunityState {
  // Friends
  friends: FriendItem[];
  friendsLoading: boolean;
  friendsError: string | null;

  // Radar offers (accumulated for infinite scroll)
  offers: RadarOffer[];
  totalCount: number;
  offersLoading: boolean;
  refreshing: boolean;
  loadingMore: boolean;
  offersError: string | null;
  hasMore: boolean;

  // Stats
  stats: RadarStats | null;
  statsLoading: boolean;

  // Filters
  filters: CommunityFilters;

  // Actions
  fetchFriends: () => Promise<void>;
  fetchStats: () => Promise<void>;
  fetchOffers: (reset?: boolean) => Promise<void>;
  setFilter: (patch: Partial<CommunityFilters>) => void;
}

// ============================================
// Constants
// ============================================

const PAGE_SIZE = 150;

const PERIOD_HOURS: Record<RadarPeriod, number | undefined> = {
  all: undefined,
  '24h': 24,
  '7d': 168,
  '30d': 720,
};

// ============================================
// Store
// ============================================

export const useCommunityStore = create<CommunityState>()(
  devtools(
    (set, get) => ({
      // Initial state
      friends: [],
      friendsLoading: false,
      friendsError: null,

  offers: [],
  totalCount: 0,
  offersLoading: false,
  refreshing: false,
  loadingMore: false,
  offersError: null,
  hasMore: true,

      stats: null,
      statsLoading: false,

      filters: {
        tab: 'all',
        q: '',
        sort: 'top',
        period: 'all',
      },

      // ============================================
      // Friends
      // ============================================

      fetchFriends: async () => {
        set({ friendsLoading: true, friendsError: null });
        try {
          const { items } = await getFriends();
          set({ friends: items, friendsLoading: false });
        } catch (error) {
          const message = error instanceof BackendError ? error.message : String(error);
          set({ friendsError: message, friendsLoading: false });
        }
      },

      // ============================================
      // Stats
      // ============================================

      fetchStats: async () => {
        set({ statsLoading: true });
        try {
          const stats = await getRadarStats();
          set({ stats, statsLoading: false });
        } catch (error) {
          const message = error instanceof BackendError ? error.message : String(error);
          set({ statsLoading: false });
          // Stats are non-fatal — surface the message via offersError only if
          // there is no richer offers error already.
          if (!get().offersError) {
            set({ offersError: message });
          }
        }
      },

      // ============================================
      // Offers (paginated, accumulated for infinite scroll)
      // ============================================

      fetchOffers: async (reset = false) => {
        const { filters, offers, loadingMore, offersLoading, refreshing } = get();

        // Guard against concurrent fetches of the same kind. A refresh (reset
        // with existing rows) blocks both reset and load-more until it settles.
        if (refreshing || (reset ? offersLoading : loadingMore)) return;

        const offset = reset ? 0 : offers.length;
        // A "refresh" is a reset that runs while rows are already on screen —
        // keep the existing offers visible (stale-while-revalidate) instead of
        // clearing them to a skeleton. Only a true first load (no rows yet)
        // sets offersLoading, which drives the skeleton.
        const isRefresh = reset && offers.length > 0;

        set(
          isRefresh
            ? { refreshing: true, offersError: null }
            : reset
              ? { offersLoading: true, offersError: null, hasMore: true }
              : { loadingMore: true }
        );

        // Build query params from filters.
        const params: Record<string, unknown> = {
          limit: PAGE_SIZE,
          offset,
        };

        if (filters.tab === 'dead') {
          params.status = 'dead';
        } else if (filters.tab !== 'all') {
          params.effort = filters.tab as RadarEffort;
        }

        if (filters.sort !== 'top') {
          params.sort = filters.sort;
        }

        const sinceHours = PERIOD_HOURS[filters.period];
        if (sinceHours !== undefined) {
          params.since_hours = sinceHours;
        }

        if (filters.q.trim()) {
          params.q = filters.q.trim();
        }

        try {
          const { count, items } = await getRadarOffers(params);
          const totalLoaded = offset + items.length;
          set(state => ({
            offers: reset ? items : [...state.offers, ...items],
            totalCount: count,
            // Stop paging when the batch was empty (guard against infinite loop
            // when count is stale or the backend returns a short page).
            hasMore: items.length > 0 && totalLoaded < count,
            offersLoading: false,
            loadingMore: false,
            refreshing: false,
            offersError: null,
          }));
        } catch (error) {
          const message = error instanceof BackendError ? error.message : String(error);
          set({
            offersLoading: false,
            loadingMore: false,
            refreshing: false,
            offersError: message,
          });
        }
      },

      // ============================================
      // Filters
      // ============================================

      setFilter: patch => {
        set(state => ({ filters: { ...state.filters, ...patch } }));
      },
    }),
    { name: 'community-store' }
  )
);
