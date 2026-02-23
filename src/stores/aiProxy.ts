import { create } from 'zustand';
import type {
  ProxyStatus,
  ProxySettings,
  AiProxyAccount,
  AiProxyQuotaInfo,
} from '../types/generated';

export type AiProxyAccountDailyUsage = {
  accountId: number;
  requests: number;
  successful: number;
  failed: number;
  tokens: number;
};

interface AiProxyState {
  // Status
  status: ProxyStatus | null;
  loading: boolean;
  error: string | null;

  // Settings
  settings: ProxySettings | null;

  // Accounts
  accounts: AiProxyAccount[];

  // Provider quotas
  providerQuotas: Record<string, AiProxyQuotaInfo>;
  providerQuotasUpdatedAt: number | null;

  // Per-account daily usage
  accountDailyUsage: Record<number, AiProxyAccountDailyUsage>;
  accountDailyUsageUpdatedAt: number | null;

  // Actions
  setStatus: (status: ProxyStatus) => void;
  setSettings: (settings: ProxySettings) => void;
  setAccounts: (accounts: AiProxyAccount[]) => void;
  setProviderQuotas: (quotas: AiProxyQuotaInfo[], updatedAt?: number) => void;
  setAccountDailyUsage: (usage: AiProxyAccountDailyUsage[], updatedAt?: number) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

export const useAiProxyStore = create<AiProxyState>(set => ({
  status: null,
  loading: false,
  error: null,
  settings: null,
  accounts: [],
  providerQuotas: {},
  providerQuotasUpdatedAt: null,
  accountDailyUsage: {},
  accountDailyUsageUpdatedAt: null,

  setStatus: status => set({ status }),
  setSettings: settings => set({ settings }),
  setAccounts: accounts => set({ accounts }),
  setProviderQuotas: (quotas, updatedAt = Date.now()) =>
    set({
      providerQuotas: quotas.reduce<Record<string, AiProxyQuotaInfo>>((acc, quota) => {
        acc[quota.provider] = quota;
        return acc;
      }, {}),
      providerQuotasUpdatedAt: updatedAt,
    }),
  setAccountDailyUsage: (usage, updatedAt = Date.now()) =>
    set({
      accountDailyUsage: usage.reduce<Record<number, AiProxyAccountDailyUsage>>((acc, row) => {
        acc[row.accountId] = row;
        return acc;
      }, {}),
      accountDailyUsageUpdatedAt: updatedAt,
    }),
  setLoading: loading => set({ loading }),
  setError: error => set({ error }),
}));
