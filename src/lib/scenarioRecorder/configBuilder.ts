import type { ProfileSettingsRecord } from '@/lib/tauri/modules/profiles';
import {
  getProxyLibraryRuntimeProxyCatalog,
  getProxyLibraryRuntimeProxyMap,
  getProxyLibraryRuntimeProxyUrl,
} from '@/lib/tauri/modules/proxyLibrary';

export type RunnerConfigBuildResult = {
  config: Record<string, unknown>;
  configJson: string;
  startUrl: string;
  lastScenarioPath: string | null;
};

type BuildOptions = {
  defaultUrl: string;
  fallbackUrl?: string;
};

export async function buildRunnerConfigFromProfileSettings(
  record: ProfileSettingsRecord | null,
  options: BuildOptions
): Promise<RunnerConfigBuildResult> {
  const settings = record?.settings;

  const proxyEnabled = Boolean(settings?.network?.proxy?.enabled);
  const proxyLibraryId = settings?.network?.proxy?.proxyLibraryId?.trim();
  const proxyUrl = settings?.network?.proxy?.url?.trim();
  const proxyUsername = settings?.network?.proxy?.username?.trim();
  const proxyPassword = settings?.network?.proxy?.password?.trim();

  let proxyValue: string | undefined;
  if (proxyEnabled) {
    if (proxyLibraryId) {
      try {
        proxyValue = (await getProxyLibraryRuntimeProxyUrl(proxyLibraryId)) ?? undefined;
      } catch {
        proxyValue = undefined;
      }
    }

    if (!proxyValue && proxyUrl) {
      if (proxyUsername) {
        const hasScheme = proxyUrl.includes('://');
        const [scheme, rest] = hasScheme
          ? [
              proxyUrl.slice(0, proxyUrl.indexOf('://')),
              proxyUrl.slice(proxyUrl.indexOf('://') + 3),
            ]
          : ['http', proxyUrl];
        const password = proxyPassword ?? '';
        proxyValue = `${scheme}://${proxyUsername}:${password}@${rest}`;
      } else {
        proxyValue = proxyUrl;
      }
    }
  }

  let runtimeProxyMap: Record<string, string> = {};
  try {
    runtimeProxyMap = await getProxyLibraryRuntimeProxyMap();
  } catch {
    runtimeProxyMap = {};
  }

  let runtimeProxyCatalog: Array<{
    id: string;
    label: string;
    proxyType: string;
    host: string;
    port: number;
  }> = [];
  try {
    runtimeProxyCatalog = await getProxyLibraryRuntimeProxyCatalog();
  } catch {
    runtimeProxyCatalog = [];
  }

  const latitude = settings?.geo?.latitude;
  const longitude = settings?.geo?.longitude;
  const hasManualGeo = typeof latitude === 'number' && typeof longitude === 'number';

  const config: Record<string, unknown> = {
    locale: settings?.geo?.locale ?? undefined,
    timezone_id: settings?.geo?.timezone ?? 'Auto',
    geolocation: hasManualGeo
      ? {
          latitude,
          longitude,
          accuracy: 50,
        }
      : 'Auto',
    proxy: proxyValue,
    runtime_proxy_map: runtimeProxyMap,
    runtime_proxy_catalog: runtimeProxyCatalog,
    cookies: settings?.storage?.cookies ?? undefined,
  };

  const fromSettingsUrl = settings?.storage?.lastUrl?.trim();
  const startUrl =
    fromSettingsUrl ||
    options.defaultUrl.trim() ||
    options.fallbackUrl?.trim() ||
    'https://google.com';

  const fromSettingsScenarioPath = settings?.storage?.lastScenarioPath?.trim();

  return {
    config,
    configJson: JSON.stringify(config, null, 2),
    startUrl,
    lastScenarioPath: fromSettingsScenarioPath || null,
  };
}
