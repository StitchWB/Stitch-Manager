/**
 * Service Plugins Module
 *
 * Thin wrapper around the `list_service_plugins` backend command. Provides a
 * module-level cache with subscriber notification (for React's
 * useSyncExternalStore) and an `invalidate()` entry point for install/
 * uninstall success handlers.
 *
 * On fetch, plugin i18n bundles from the manifest are registered into the
 * `t()` fallback chain (see i18nPluginBundles.ts); on refetch, stale bundles
 * for removed plugins are unregistered before the new set is registered.
 *
 * The backend command may 404 when the service-plugin bridge (todo 4) is not
 * yet wired — `fetchServicePlugins()` catches that and degrades to [].
 */
import { safeInvoke } from '../core';
import {
  registerPluginBundles,
  unregisterPluginBundles,
} from '@/lib/i18nPluginBundles';

// ============================================
// Types
// ============================================

export interface ServicePluginTab {
  id: string;
  label: string;
  icon?: string;
  page?: unknown;
}

/** Status dict returned by ``host.status()`` via ``list_service_plugins``. */
export interface ServicePluginStatus {
  status: string;
  port: number | null;
  pid: number | null;
  uptimeSeconds: number | null;
  error: string | null;
  plugin_id: string;
  restarts: number;
  stopping: boolean;
}

export interface ServicePluginInfo {
  id: string;
  version: string;
  status: ServicePluginStatus;
  ui?: {
    kind: 'declarative' | 'core_page';
    page?: unknown;
    tabs?: ServicePluginTab[];
  };
  i18n?: {
    ru?: Record<string, unknown>;
    en?: Record<string, unknown>;
  };
}

// ============================================
// Cache + subscriber store
// ============================================

const subscribers = new Set<() => void>();
let cache: ServicePluginInfo[] = [];
let fetchInFlight: Promise<void> | null = null;

/**
 * Snapshot for useSyncExternalStore. Returns a stable reference between
 * fetches — the same array object until fetchServicePlugins replaces it.
 */
export function getServicePlugins(): ServicePluginInfo[] {
  return cache;
}

/**
 * Subscribe to cache changes. Returns an unsubscribe function. Used by
 * useSyncExternalStore in React components (e.g. AiTopTabs).
 */
export function subscribeServicePlugins(listener: () => void): () => void {
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
  };
}

function notify(): void {
  for (const listener of subscribers) {
    listener();
  }
}

/**
 * Register i18n bundles for new plugins and unregister bundles for plugins
 * no longer present in the response. Reads the current cache to detect
 * removals — must be called BEFORE replacing the cache.
 */
function syncBundles(next: ServicePluginInfo[]): void {
  const newIds = new Set(next.map(p => p.id));
  for (const prev of cache) {
    if (!newIds.has(prev.id)) {
      unregisterPluginBundles(prev.id);
    }
  }
  for (const p of next) {
    if (p.i18n) {
      registerPluginBundles(p.id, p.i18n);
    }
  }
}

/**
 * Fetch the list of installed service plugins and update the cache. Dedupes
 * concurrent calls via fetchInFlight. On backend error (including 404 when
 * the bridge is not yet wired), the cache is set to [] and no throw escapes.
 */
export async function fetchServicePlugins(): Promise<void> {
  if (fetchInFlight) return fetchInFlight;
  fetchInFlight = (async () => {
    try {
      const plugins = await safeInvoke<ServicePluginInfo[]>('list_service_plugins');
      const next = Array.isArray(plugins) ? plugins : [];
      syncBundles(next);
      cache = next;
    } catch {
      cache = [];
    } finally {
      fetchInFlight = null;
      notify();
    }
  })();
  return fetchInFlight;
}

/**
 * Invalidate the cache and trigger a refetch. Called by install/uninstall
 * success handlers when wired, or on window focus as a passive refresh.
 * The refetch updates the cache and notifies subscribers on settle.
 */
export function invalidate(): void {
  fetchInFlight = null;
  void fetchServicePlugins();
}

/**
 * Reset module-level state. Test-only — production code uses invalidate().
 */
export function _resetForTests(): void {
  cache = [];
  fetchInFlight = null;
  subscribers.clear();
}
