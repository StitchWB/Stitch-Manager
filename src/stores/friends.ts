import { getFriends, BackendError, type FriendItem } from '../lib/backend';
import { createAsyncStore } from '../lib/store/createAsyncStore';

interface FriendsState {
  friends: FriendItem[];
  friendsLoading: boolean;
  friendsError: string | null;

  fetchFriends: () => Promise<void>;
}

export const useFriendsStore = createAsyncStore<FriendsState>({
  name: 'friends-store',
  devtools: true,
  initial: {
    friends: [],
    friendsLoading: false,
    friendsError: null,
  },
  actions: (set) => ({
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
  }),
});
