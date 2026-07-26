import { create } from 'zustand';
import {
  listTotpKeys,
  addTotpKey,
  updateTotpKey,
  removeTotpKey,
  linkTotpKey,
  type TotpKey,
  type AddTotpKeyParams,
  type UpdateTotpKeyParams,
  type LinkTotpKeyParams,
} from '@/lib/tauri/modules/totp';

interface TotpState {
  keys: TotpKey[];
  loading: boolean;
  error: string | null;

  fetchKeys: () => Promise<void>;
  addKey: (params: AddTotpKeyParams) => Promise<TotpKey>;
  updateKey: (params: UpdateTotpKeyParams) => Promise<TotpKey>;
  removeKey: (id: string) => Promise<void>;
  linkKey: (params: LinkTotpKeyParams) => Promise<TotpKey>;

  /** Returns all keys linked to the given account id */
  getKeysForAccount: (accountId: string) => TotpKey[];
}

export const useTotpStore = create<TotpState>((set, get) => ({
  keys: [],
  loading: false,
  error: null,

  fetchKeys: async () => {
    set({ loading: true, error: null });
    try {
      const keys = await listTotpKeys();
      set({ keys, loading: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), loading: false });
    }
  },

  addKey: async (params) => {
    const key = await addTotpKey(params);
    set((s) => ({ keys: [key, ...s.keys] }));
    return key;
  },

  updateKey: async (params) => {
    const updated = await updateTotpKey(params);
    set((s) => ({
      keys: s.keys.map((k) => (k.id === updated.id ? updated : k)),
    }));
    return updated;
  },

  removeKey: async (id) => {
    await removeTotpKey(id);
    set((s) => ({ keys: s.keys.filter((k) => k.id !== id) }));
  },

  linkKey: async (params) => {
    const updated = await linkTotpKey(params);
    set((s) => ({
      keys: s.keys.map((k) => (k.id === updated.id ? updated : k)),
    }));
    return updated;
  },

  getKeysForAccount: (accountId) => {
    return get().keys.filter(
      (k) => k.enabled && k.accountId === accountId
    );
  },
}));
