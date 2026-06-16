// Hook for managing proxy configuration

import { useState, useEffect, useCallback } from 'react';
import { safeInvoke } from '../lib/tauri/core';
import type { ProxyConfig } from '../types/generated';

const defaultProxyConfig: ProxyConfig = {
  enabled: false,
  proxyType: 'http',
  proxies: [],
};

export function useProxyConfig() {
  const [config, setConfig] = useState<ProxyConfig | null>(defaultProxyConfig);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadConfig = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await safeInvoke<ProxyConfig>('get_proxy_config');
      setConfig(data);
    } catch (err) {
      console.error('Failed to load proxy config:', err);
      setError(err instanceof Error ? err.message : 'Failed to load proxy config');
      // Fallback to default to keep settings UI usable even if legacy
      // proxy config storage is absent or malformed.
      setConfig(defaultProxyConfig);
    } finally {
      setLoading(false);
    }
  }, []);

  const saveConfig = useCallback(async (newConfig: ProxyConfig) => {
    try {
      setError(null);
      await safeInvoke('save_proxy_config', { config: newConfig });
      setConfig(newConfig);
      return true;
    } catch (err) {
      console.error('Failed to save proxy config:', err);
      setError(err instanceof Error ? err.message : 'Failed to save proxy config');
      return false;
    }
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  return {
    config,
    loading,
    error,
    reload: loadConfig,
    save: saveConfig,
  };
}
