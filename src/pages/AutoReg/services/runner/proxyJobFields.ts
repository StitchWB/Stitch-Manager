import type { ProxyIpPolicy, RegistrationConfig } from '../../../../stores/registration/types';

export interface ProxyJobFields {
  autoProxy: boolean;
  proxyIpPolicy: ProxyIpPolicy;
  proxyIpReuseCount: number;
  proxyUrl: string | null;
}

export function buildProxyJobFields(config: RegistrationConfig): ProxyJobFields {
  const proxy = config.proxy;
  const rotation = proxy.rotationEnabled === true;
  return {
    autoProxy: rotation,
    proxyIpPolicy: proxy.ipPolicy ?? 'per_run',
    proxyIpReuseCount: proxy.ipReuseCount ?? 1,
    proxyUrl: rotation ? null : proxy.enabled ? proxy.url : null,
  };
}
