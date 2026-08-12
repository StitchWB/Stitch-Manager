/**
 * Shared browser-engine identifiers and normalizer.
 *
 * Used by profile settings, scenario recorder/replay, config builder, and
 * the engine toggle UI. The single source of truth for engine identity so
 * the legacy 'cloackbrowser' typo never appears in types.
 */

export type BrowserEngineId = 'cloakbrowser' | 'shardbrowser';

/**
 * Normalize an arbitrary engine string to a valid BrowserEngineId.
 *
 * Accepts the legacy 'cloackbrowser' typo, 'cloakbrowser', empty, null, and
 * undefined — all map to 'cloakbrowser' (the default engine). The shard
 * engine is matched by 'shardbrowser', 'shardx', or 'shard'
 * (case-insensitive, trimmed).
 */
export function normalizeBrowserEngine(value: string | null | undefined): BrowserEngineId {
  const trimmed = (value ?? '').trim().toLowerCase();
  if (trimmed === 'shardbrowser' || trimmed === 'shardx' || trimmed === 'shard') {
    return 'shardbrowser';
  }
  // Everything else — including the legacy 'cloackbrowser' typo, 'cloakbrowser',
  // empty string, null, undefined — defaults to cloakbrowser.
  return 'cloakbrowser';
}

export const BROWSER_ENGINE_LABELS: Record<BrowserEngineId, string> = {
  cloakbrowser: 'CloakBrowser',
  shardbrowser: 'ShardBrowser',
};

export const BROWSER_ENGINE_SHORT_LABELS: Record<BrowserEngineId, string> = {
  cloakbrowser: 'Cloak',
  shardbrowser: 'Shard',
};
