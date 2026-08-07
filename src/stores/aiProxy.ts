import { create } from 'zustand';
import type {
  ProxyStatus,
  ProxySettings,
  AiProxyAccount,
  AiProxyQuotaInfo,
} from '../types/generated';
import type { OpenAiAccountQuota } from '../lib/backend/modules/aiProxy';
import { getProxyStatus } from '../lib/backend/modules/aiProxy';
import { listen, type UnlistenFn } from '../lib/events';
import type { KiroAccountQuota } from '../types/generated';

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

  // Kiro account-level quotas
  kiroAccountQuotas: Record<number, KiroAccountQuota>;
  kiroAccountQuotasUpdatedAt: number | null;

  // Per-account daily usage
  accountDailyUsage: Record<number, AiProxyAccountDailyUsage>;
  accountDailyUsageUpdatedAt: number | null;

  // Actions
  setStatus: (status: ProxyStatus) => void;
  setSettings: (settings: ProxySettings) => void;
  setAccounts: (accounts: AiProxyAccount[]) => void;
  setProviderQuotas: (quotas: AiProxyQuotaInfo[], updatedAt?: number) => void;
  setOpenAiAccountQuotas: (quotas: OpenAiAccountQuota[], updatedAt?: number) => void;
  setKiroAccountQuotas: (quotas: KiroAccountQuota[], updatedAt?: number) => void;
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
  kiroAccountQuotas: {},
  kiroAccountQuotasUpdatedAt: null,
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
  setKiroAccountQuotas: (quotas, updatedAt = Date.now()) =>
    set({
      kiroAccountQuotas: quotas.reduce<Record<number, KiroAccountQuota>>((acc, quota) => {
        acc[quota.accountId] = quota;
        return acc;
      }, {}),
      kiroAccountQuotasUpdatedAt: updatedAt,
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

// ─── Proxy Status: WS-driven + heartbeat ────────────────────────────────────
// Single instance shared by all components.
// WS event 'proxy.status_changed' is the primary update path; the 60s
// heartbeat is a safety net (paused when the window is hidden).

let pollingSubscribers = 0;
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
let unlistenPromise: Promise<UnlistenFn> | null = null;
const HEARTBEAT_INTERVAL_MS = 60_000;

async function fetchProxyStatus() {
  try {
    const status = await getProxyStatus();
    useAiProxyStore.getState().setStatus(status);
  } catch (err) {
    console.warn('[aiProxy store] proxy status fetch failed:', err);
  }
}

function startHeartbeat() {
  if (heartbeatInterval) return;
  heartbeatInterval = setInterval(fetchProxyStatus, HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

// Pause/resume heartbeat on visibility change (registered once, module-level)
let visibilityListenerRegistered = false;
function ensureVisibilityListener() {
  if (visibilityListenerRegistered) return;
  visibilityListenerRegistered = true;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopHeartbeat();
    } else if (pollingSubscribers > 0) {
      fetchProxyStatus();
      startHeartbeat();
    }
  });
}

/** Start proxy status updates. Call on mount of components that need it. */
export function startProxyStatusPolling() {
  pollingSubscribers++;
  if (pollingSubscribers === 1) {
    ensureVisibilityListener();
    fetchProxyStatus();
    unlistenPromise = listen<ProxyStatus>('proxy.status_changed', (event) => {
      useAiProxyStore.getState().setStatus(event.payload);
    });
    startHeartbeat();
  }
}

/** Stop proxy status updates. Call on unmount. */
export function stopProxyStatusPolling() {
  pollingSubscribers = Math.max(0, pollingSubscribers - 1);
  if (pollingSubscribers === 0) {
    stopHeartbeat();
    if (unlistenPromise) {
      unlistenPromise.then((fn) => fn());
      unlistenPromise = null;
    }
  }
}

/** Get proxy status — returns cached value or fetches fresh if not available. */
export async function fetchProxyStatusNow() {
  const current = useAiProxyStore.getState().status;
  if (current) return current;
  await fetchProxyStatus();
  return useAiProxyStore.getState().status;
}

/** Force a fresh proxy status fetch (ignores cache). Use for manual refresh. */
export async function refreshProxyStatus() {
  await fetchProxyStatus();
  return useAiProxyStore.getState().status;
}
