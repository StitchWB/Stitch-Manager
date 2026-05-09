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
  engine?: 'cloackbrowser' | 'camoufox';
};

function parseRuntimeProxyUrl(raw: string): {
  proxyType: 'http' | 'socks5';
  host: string;
  port: number;
} | null {
  const value = raw.trim();
  if (!value) return null;

  try {
    const url = new URL(value);
    const host = url.hostname?.trim();
    const port = Number(url.port || 0);
    if (!host || !Number.isInteger(port) || port <= 0 || port > 65535) {
      return null;
    }
    const scheme = (url.protocol || '').replace(':', '').toLowerCase();
    return {
      proxyType: scheme === 'socks5' ? 'socks5' : 'http',
      host,
      port,
    };
  } catch {
    return null;
  }
}

export async function buildRunnerConfigFromProfileSettings(
  record: ProfileSettingsRecord | null,
  options: BuildOptions
): Promise<RunnerConfigBuildResult> {
  const settings = record?.settings;

  const proxyEnabled = Boolean(settings?.network?.proxy?.enabled);
  const proxyLibraryId = settings?.network?.proxy?.proxyLibraryId?.trim();

  let proxyValue: string | undefined;
  if (proxyEnabled) {
    if (proxyLibraryId) {
      try {
        proxyValue = (await getProxyLibraryRuntimeProxyUrl(proxyLibraryId)) ?? undefined;
      } catch {
        proxyValue = undefined;
      }
    }
  }

  let runtimeProxyMap: Record<string, string> = {};
  try {
    runtimeProxyMap = await getProxyLibraryRuntimeProxyMap();
  } catch {
    runtimeProxyMap = {};
  }

  // Robust fallback: even if full map loading fails, keep the selected
  // profile proxy available for recorder overlay/runtime switching.
  if (proxyEnabled && proxyLibraryId && proxyValue && !runtimeProxyMap[proxyLibraryId]) {
    runtimeProxyMap[proxyLibraryId] = proxyValue;
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

  // Fallback: if catalog is unavailable but runtime map has entries,
  // synthesize a minimal catalog so recorder overlay can still list/select proxies.
  if (!runtimeProxyCatalog.length && Object.keys(runtimeProxyMap).length > 0) {
    const fallbackCatalog: Array<{
      id: string;
      label: string;
      proxyType: string;
      host: string;
      port: number;
    }> = [];

    for (const [id, url] of Object.entries(runtimeProxyMap)) {
      const parsed = parseRuntimeProxyUrl(url);
      if (!parsed) continue;
      fallbackCatalog.push({
        id,
        label: id,
        proxyType: parsed.proxyType,
        host: parsed.host,
        port: parsed.port,
      });
    }

    runtimeProxyCatalog = fallbackCatalog;
  }

  const latitude = settings?.geo?.latitude;
  const longitude = settings?.geo?.longitude;
  const hasManualGeo = typeof latitude === 'number' && typeof longitude === 'number';

  const rawWindow = settings?.hardware?.browserWindow;
  const windowMode =
    rawWindow?.mode === 'fixed' || rawWindow?.mode === 'auto' || rawWindow?.mode === 'fit-screen'
      ? rawWindow.mode
      : 'fit-screen';
  const windowWidth =
    typeof rawWindow?.width === 'number' && Number.isFinite(rawWindow.width) && rawWindow.width > 0
      ? Math.round(rawWindow.width)
      : null;
  const windowHeight =
    typeof rawWindow?.height === 'number' &&
    Number.isFinite(rawWindow.height) &&
    rawWindow.height > 0
      ? Math.round(rawWindow.height)
      : null;
  const maximizeOnStart = Boolean(rawWindow?.maximizeOnStart);

  const config: Record<string, unknown> = {
    engine: options.engine ?? 'cloackbrowser',
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
    proxy_library_id: proxyEnabled && proxyLibraryId ? proxyLibraryId : undefined,
    runtime_proxy_map: runtimeProxyMap,
    runtime_proxy_catalog: runtimeProxyCatalog,
    cookies: settings?.storage?.cookies ?? undefined,
    browser_window: {
      mode: windowMode,
      width: windowMode === 'fixed' ? windowWidth : null,
      height: windowMode === 'fixed' ? windowHeight : null,
      maximize_on_start: maximizeOnStart,
    },
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
