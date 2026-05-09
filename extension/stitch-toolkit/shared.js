// Shared constants for Stitch Toolkit extension
export const TOOLKIT_VERSION = '0.2.0';

// Bridge ports (kept for backward compat with existing Python runners)
export const BRIDGE_PORTS = Object.freeze({
  record: 9123,
  replay: 9124,
  health: 9125,
});

export function bridgeUrl(kind) {
  const port = BRIDGE_PORTS[kind];
  if (!port) return null;
  return `ws://127.0.0.1:${port}`;
}

export function syncApiUrl(path) {
  const base = 'http://127.0.0.1:9876';
  return `${base}${path}`;
}

// Storage keys
export const STORAGE_KEYS = Object.freeze({
  scenarios: 'stitch:scenarios',
  selectedScenarioId: 'stitch:selectedScenarioId',
  sessionBackup: 'stitch:sessionBackup',
  toolkitCollapsed: 'toolkit:collapsed',
  toolkitActiveTool: 'toolkit:activeTool',
});
