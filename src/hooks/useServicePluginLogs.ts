import { useCallback, useState } from 'react';
import { safeInvoke } from '@/lib/backend/core';

interface ServicePluginLogsView {
  openPluginId: string | null;
  /** Lines for the open plugin; undefined while the first fetch is pending. */
  lines: string[] | undefined;
  loading: boolean;
  /** Toggles: opening the already-open plugin closes the view. */
  open: (pluginId: string) => Promise<void>;
  close: () => void;
}

/**
 * Logs-viewer state machine for service plugins: single open plugin,
 * per-plugin line cache (re-open does not refetch), single in-flight fetch.
 */
export function useServicePluginLogs(): ServicePluginLogsView {
  const [openPluginId, setOpenPluginId] = useState<string | null>(null);
  const [cache, setCache] = useState<Record<string, string[]>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const open = useCallback(
    async (pluginId: string) => {
      if (openPluginId === pluginId) {
        setOpenPluginId(null);
        return;
      }
      setOpenPluginId(pluginId);
      if (cache[pluginId] !== undefined) return;
      setLoadingId(pluginId);
      try {
        const lines = await safeInvoke<string[]>('get_service_plugin_logs', {
          plugin_id: pluginId,
          lines: 100,
        });
        setCache(prev => ({ ...prev, [pluginId]: Array.isArray(lines) ? lines : [] }));
      } catch {
        setCache(prev => ({ ...prev, [pluginId]: [] }));
      } finally {
        setLoadingId(null);
      }
    },
    [openPluginId, cache],
  );

  const close = useCallback(() => setOpenPluginId(null), []);

  return {
    openPluginId,
    lines: openPluginId === null ? undefined : cache[openPluginId],
    loading: openPluginId !== null && loadingId === openPluginId,
    open,
    close,
  };
}
