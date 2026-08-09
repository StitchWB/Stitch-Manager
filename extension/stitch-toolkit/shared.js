// Shared constants for Stitch Toolkit extension (unified runner + toolkit).
export const TOOLKIT_VERSION = '0.7.0';

// Bridge ports must match python/run_extension_record.py / run_extension_replay.py
// and python/probe_extension_bridge.py (health).
export const BRIDGE_PORTS = Object.freeze({
  record: 18731,
  replay: 18732,
  health: 18733,
});

// Storage keys
export const STORAGE_KEYS = Object.freeze({
  scenarios: 'stitch:scenarios',
  selectedScenarioId: 'stitch:selectedScenarioId',
  sessionBackup: 'stitch:sessionBackup',
  toolkitCollapsed: 'toolkit:collapsed',
  toolkitActiveTool: 'toolkit:activeTool',
});
