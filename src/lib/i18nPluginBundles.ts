/**
 * Plugin i18n bundle registry.
 *
 * Stores per-plugin ru/en translation bundles registered at runtime by the
 * plugin host (via `list_service_plugins`). Consumed by `t()` in `i18n.ts` as a
 * fallback for keys shaped `plugin.{id}.{key}` — AFTER the core locale lookup
 * fails and BEFORE returning the raw key.
 *
 * Design notes:
 * - Language-aware: tries the requested locale first, then falls back to the
 *   other locale if the requested one is missing or lacks the key.
 * - Never throws: malformed bundle shapes (non-object, null) are treated as
 *   "no bundle for that locale" and the lookup returns undefined.
 * - No subscriber notification: components re-render on install/uninstall
 *   events elsewhere; this module is a passive lookup table.
 */

// A plugin bundle is a nested object whose string leaves are translations.
type PluginBundle = Record<string, unknown>;

interface PluginBundles {
  ru?: PluginBundle;
  en?: PluginBundle;
}

const registry = new Map<string, PluginBundles>();

/**
 * Register (or replace) the i18n bundles for a plugin.
 * Last registration wins; re-registering overwrites the previous bundles.
 */
export function registerPluginBundles(
  pluginId: string,
  bundles: PluginBundles,
): void {
  registry.set(pluginId, bundles);
}

/**
 * Remove a plugin's i18n bundles from the registry.
 * After this, `t('plugin.{id}.*')` returns the raw key.
 */
export function unregisterPluginBundles(pluginId: string): void {
  registry.delete(pluginId);
}

/**
 * Walk a dot-notation path through a bundle object, returning the string leaf
 * if found. Returns undefined on any miss or non-string leaf. Never throws.
 */
function walkBundle(bundle: unknown, parts: readonly string[]): string | undefined {
  let value: unknown = bundle;
  for (const part of parts) {
    if (value && typeof value === 'object' && part in (value as Record<string, unknown>)) {
      value = (value as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return typeof value === 'string' ? value : undefined;
}

/**
 * Look up a translation for a `plugin.{id}.{key...}` path.
 *
 * @param key   - Full dot-notation key (must start with `plugin.`).
 * @param locale - Current app locale (e.g. 'ru', 'en').
 * @returns The translated string, or undefined if not found / not a plugin key.
 */
export function lookupPluginBundle(key: string, locale: string): string | undefined {
  const parts = key.split('.');
  // parts[0] === 'plugin', parts[1] === pluginId, parts[2..] === key path
  if (parts.length < 3 || parts[0] !== 'plugin' || parts[1] === '') {
    return undefined;
  }
  const pluginId = parts[1];
  const bundles = registry.get(pluginId);
  if (!bundles) {
    return undefined;
  }
  const keyPath = parts.slice(2);

  // Try the requested locale first, then fall back to the other locale.
  const fallback = locale === 'ru' ? 'en' : 'ru';
  return (
    walkBundle(bundles[locale as 'ru' | 'en'], keyPath) ??
    walkBundle(bundles[fallback as 'ru' | 'en'], keyPath)
  );
}
