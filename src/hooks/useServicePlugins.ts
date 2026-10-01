import { useEffect, useSyncExternalStore } from 'react';
import {
  fetchServicePlugins,
  getServicePlugins,
  subscribeServicePlugins,
  type ServicePluginInfo,
} from '@/lib/backend/modules/servicePlugins';

/**
 * Subscribed snapshot of the service-plugins cache; fetches once on mount.
 * No polling — refetch happens via invalidate() from install/restart flows.
 */
export function useServicePlugins(): ServicePluginInfo[] {
  const plugins = useSyncExternalStore(
    subscribeServicePlugins,
    getServicePlugins,
    getServicePlugins,
  );
  useEffect(() => {
    void fetchServicePlugins();
  }, []);
  return plugins;
}
