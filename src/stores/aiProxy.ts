import { create } from 'zustand';
import type {
  ProxyStatus,
  ProxySettings,
  AiProxyAccount,
  AiProxyQuotaInfo,
} from '../types/generated';
import type { OpenAiAccountQuota } from '../lib/tauri/modules/aiProxy';

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

  // OpenAI account-level quotas (Primary/Weekly windows)
  openAiAccountQuotas: Record<string, OpenAiAccountQuota>;
  openAiAccountQuotasUpdatedAt: number | null;

  // Per-account daily usage
  accountDailyUsage: Record<number, AiProxyAccountDailyUsage>;
  accountDailyUsageUpdatedAt: number | null;

  // Actions
  setStatus: (status: ProxyStatus) => void;
  setSettings: (settings: ProxySettings) => void;
  setAccounts: (accounts: AiProxyAccount[]) => void;
  setProviderQuotas: (quotas: AiProxyQuotaInfo[], updatedAt?: number) => void;
  setOpenAiAccountQuotas: (quotas: OpenAiAccountQuota[], updatedAt?: number) => void;
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
  openAiAccountQuotas: {},
  openAiAccountQuotasUpdatedAt: null,
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
  setOpenAiAccountQuotas: (quotas, updatedAt = Date.now()) =>
    set({
      openAiAccountQuotas: quotas.reduce<Record<string, OpenAiAccountQuota>>((acc, quota) => {
        const keys = new Set<string>();
        const norm = (raw: string): string =>
          raw
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .replace(/\.(json|jsonc)$/i, '')
            .trim();

        if (quota.accountEmail) keys.add(norm(quota.accountEmail));
        if (quota.accountName) {
          keys.add(norm(quota.accountName));
          keys.add(norm(`codex-${quota.accountName}`));
          keys.add(norm(`${quota.accountName}.json`));
          keys.add(norm(`codex-${quota.accountName}.json`));

          // Some UI surfaces store account name as "openai (codex-...json)".
          // Index extra keys to match that format.
          keys.add(norm(`openai (${quota.accountName}.json)`));
          keys.add(norm(`openai (codex-${quota.accountName}.json)`));
        }

        for (const key of keys) {
          if (key) acc[key] = quota;
        }
        return acc;
      }, {}),
      openAiAccountQuotasUpdatedAt: updatedAt,
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
