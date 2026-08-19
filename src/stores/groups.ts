import { create } from 'zustand';
import type {
  Group,
  GroupSummary,
  GroupInviteSummary,
  GroupDetailResponse,
  GroupInvite,
  PoolItem,
} from '@/lib/backend/modules/groups';
import * as api from '@/lib/backend/modules/groups';

interface GroupsState {
  // Data
  groups: GroupSummary[];
  invites: GroupInviteSummary[];
  detail: GroupDetailResponse | null;
  pool: PoolItem[];

  // Loading states
  loading: {
    list: boolean;
    detail: boolean;
    pool: boolean;
    action: boolean;
  };

  // Errors
  errors: {
    list: string | null;
    detail: string | null;
    pool: string | null;
    action: string | null;
  };

  // Actions
  fetchList: () => Promise<void>;
  fetchDetail: (groupId: string) => Promise<void>;
  fetchPool: (groupId: string) => Promise<void>;

  createGroup: (params: { name: string }) => Promise<Group>;
  updateGroup: (params: { groupId: string; name: string }) => Promise<Group>;
  deleteGroup: (groupId: string) => Promise<void>;

  inviteMember: (params: { groupId: string; username: string }) => Promise<GroupInvite>;
  resolveInvite: (params: { inviteId: string; accept: boolean }) => Promise<void>;
  revokeInvite: (inviteId: string) => Promise<void>;
  removeMember: (params: { groupId: string; userId: number }) => Promise<void>;
  leaveGroup: (groupId: string) => Promise<void>;

  clearDetail: () => void;
  clearActionError: () => void;
}

export const useGroupsStore = create<GroupsState>((set, get) => ({
  groups: [],
  invites: [],
  detail: null,
  pool: [],

  loading: {
    list: false,
    detail: false,
    pool: false,
    action: false,
  },

  errors: {
    list: null,
    detail: null,
    pool: null,
    action: null,
  },

  fetchList: async () => {
    set(s => ({ loading: { ...s.loading, list: true }, errors: { ...s.errors, list: null } }));
    try {
      const res = await api.groupsList();
      set({ groups: res.groups ?? [], invites: res.invites ?? [] });
    } catch (e) {
      set(s => ({ errors: { ...s.errors, list: e instanceof Error ? e.message : String(e) } }));
    } finally {
      set(s => ({ loading: { ...s.loading, list: false } }));
    }
  },

  fetchDetail: async (groupId) => {
    set(s => ({ loading: { ...s.loading, detail: true }, errors: { ...s.errors, detail: null } }));
    try {
      const detail = await api.groupsGet({ groupId });
      set({ detail });
    } catch (e) {
      set(s => ({ errors: { ...s.errors, detail: e instanceof Error ? e.message : String(e) } }));
    } finally {
      set(s => ({ loading: { ...s.loading, detail: false } }));
    }
  },

  fetchPool: async (groupId) => {
    set(s => ({ loading: { ...s.loading, pool: true }, errors: { ...s.errors, pool: null } }));
    try {
      const res = await api.groupsPoolList(groupId);
      set({ pool: res.items ?? [] });
    } catch (e) {
      set(s => ({ errors: { ...s.errors, pool: e instanceof Error ? e.message : String(e) } }));
    } finally {
      set(s => ({ loading: { ...s.loading, pool: false } }));
    }
  },

  createGroup: async (params) => {
    set(s => ({ loading: { ...s.loading, action: true }, errors: { ...s.errors, action: null } }));
    try {
      const group = await api.groupsCreate(params);
      // Refresh the list so the new group appears.
      await get().fetchList();
      return group;
    } finally {
      set(s => ({ loading: { ...s.loading, action: false } }));
    }
  },

  updateGroup: async (params) => {
    set(s => ({ loading: { ...s.loading, action: true }, errors: { ...s.errors, action: null } }));
    try {
      const group = await api.groupsUpdate(params);
      // Patch the detail in place so the UI updates without a refetch.
      const detail = get().detail;
      if (detail && detail.group.id === group.id) {
        set({ detail: { ...detail, group } });
      }
      // Patch the summary in the list.
      set(s => ({ groups: s.groups.map(g => g.id === group.id ? { ...g, name: group.name } : g) }));
      return group;
    } finally {
      set(s => ({ loading: { ...s.loading, action: false } }));
    }
  },

  deleteGroup: async (groupId) => {
    set(s => ({ loading: { ...s.loading, action: true }, errors: { ...s.errors, action: null } }));
    try {
      await api.groupsDelete(groupId);
      set(s => ({
        groups: s.groups.filter(g => g.id !== groupId),
        detail: null,
        pool: [],
      }));
    } finally {
      set(s => ({ loading: { ...s.loading, action: false } }));
    }
  },

  inviteMember: async (params) => {
    set(s => ({ loading: { ...s.loading, action: true }, errors: { ...s.errors, action: null } }));
    try {
      const invite = await api.groupsInvite(params);
      // Refresh detail so the pending invite appears.
      await get().fetchDetail(params.groupId);
      return invite;
    } finally {
      set(s => ({ loading: { ...s.loading, action: false } }));
    }
  },

  resolveInvite: async (params) => {
    set(s => ({ loading: { ...s.loading, action: true }, errors: { ...s.errors, action: null } }));
    try {
      await api.groupsInviteResolve(params);
      // Refresh the list: accepted invites add the group, declined remove the invite.
      await get().fetchList();
    } finally {
      set(s => ({ loading: { ...s.loading, action: false } }));
    }
  },

  revokeInvite: async (inviteId) => {
    set(s => ({ loading: { ...s.loading, action: true }, errors: { ...s.errors, action: null } }));
    try {
      await api.groupsInviteRevoke(inviteId);
      // Refresh detail so the revoked invite disappears.
      const detail = get().detail;
      if (detail) {
        await get().fetchDetail(detail.group.id);
      }
    } finally {
      set(s => ({ loading: { ...s.loading, action: false } }));
    }
  },

  removeMember: async (params) => {
    set(s => ({ loading: { ...s.loading, action: true }, errors: { ...s.errors, action: null } }));
    try {
      await api.groupsRemoveMember(params);
      await get().fetchDetail(params.groupId);
    } finally {
      set(s => ({ loading: { ...s.loading, action: false } }));
    }
  },

  leaveGroup: async (groupId) => {
    set(s => ({ loading: { ...s.loading, action: true }, errors: { ...s.errors, action: null } }));
    try {
      await api.groupsLeave(groupId);
      set(s => ({
        groups: s.groups.filter(g => g.id !== groupId),
        detail: null,
        pool: [],
      }));
    } finally {
      set(s => ({ loading: { ...s.loading, action: false } }));
    }
  },

  clearDetail: () => set({ detail: null, pool: [] }),
  clearActionError: () => set(s => ({ errors: { ...s.errors, action: null } })),
}));
