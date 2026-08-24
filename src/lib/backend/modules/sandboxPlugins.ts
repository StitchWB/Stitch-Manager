/**
 * Sandbox Plugins Module
 *
 * Thin wrappers around the per-user developer-sandbox backend commands
 * (`sandbox_install`, `sandbox_list`, `sandbox_logs`, `sandbox_restart`,
 * `sandbox_uninstall` — see python/stitch_backend/domains/plugin_runtime/
 * sandbox_commands.py).
 *
 * Unlike `servicePlugins.ts`, this module keeps NO module-level cache or
 * subscriber store: the sandbox list is owned by the React component that
 * renders it (the Plugins page gates it behind authentication). These are
 * pure request helpers — state stays in the UI layer.
 *
 * `sandbox_install` returns a business result (`{success, ...}`) rather than
 * throwing on a refused install, so callers inspect `.success` and surface
 * `.error` / `.reason` inline (e.g. the TOFU `pin_mismatch` force path).
 */
import { safeInvoke } from '../core';

// ============================================
// Types
// ============================================

/**
 * Host status dict returned by `host.status()` for a RUNNING sandbox host,
 * or `null` when the host is not running (see `list_sandbox_plugins`).
 * Only the fields the UI renders are typed here; the backend may include
 * more (capabilities, supported, port, pid, ...).
 */
export interface SandboxPluginStatus {
  /** Host state string: "running" | "error" | "stopped" | ... */
  status: string;
  /** Total command calls served by this host. */
  calls?: number;
  /** Total command errors served by this host. */
  errors?: number;
  /** Number of crash restarts. */
  restarts?: number;
  /** Human-readable error when the host is dead / crash-looping. */
  error?: string | null;
  /** True while the host is shutting down. */
  stopping?: boolean;
  /** Origin of the host — always "sandbox" for sandbox hosts. */
  source?: string;
}

/** Scoped TOFU pin recorded for (user, plugin), or null when absent. */
export interface SandboxPinnedSource {
  /** Pinned commit SHA (git) or release sha256. */
  sha: string;
  /** Source URL the plugin was installed from. */
  url: string;
  /** ISO timestamp of when the pin was recorded. */
  installed_at?: string;
}

/** One entry of `sandbox_list`. */
export interface SandboxPluginInfo {
  id: string;
  version: string;
  /** Host status dict, or null when the host is not running. */
  status: SandboxPluginStatus | null;
  /** Scoped TOFU pin, or null when no pin is recorded. */
  pinned_source: SandboxPinnedSource | null;
}

/** Success shape of `sandbox_install`. */
export interface SandboxInstallOk {
  success: true;
  plugin_id: string;
  version: string;
  pinned_sha: string;
}

/** Failure shape of `sandbox_install` (business error, not an HTTP error). */
export interface SandboxInstallErr {
  success: false;
  error: string;
  /** e.g. "pin_mismatch", "dev_gate", "engine_too_new", ... */
  reason?: string;
}

export type SandboxInstallResult = SandboxInstallOk | SandboxInstallErr;

/** Params accepted by `sandbox_install` (git mode is the UI's scope). */
export interface SandboxInstallParams {
  url: string;
  ref?: string;
  sha256?: string;
  trust?: boolean;
  force?: boolean;
}

// ============================================
// Helpers
// ============================================

/**
 * Fetch the caller's sandbox plugins. `noCache` bypasses safeInvoke's short
 * response cache so a post-mutation refresh always sees fresh host status.
 */
export async function sandboxList(): Promise<SandboxPluginInfo[]> {
  const result = await safeInvoke<SandboxPluginInfo[]>('sandbox_list', {}, { noCache: true });
  return Array.isArray(result) ? result : [];
}

/**
 * Install a plugin into the caller's sandbox. Resolves to a business result
 * — inspect `.success` (a refused install is NOT a thrown error).
 */
export async function sandboxInstall(params: SandboxInstallParams): Promise<SandboxInstallResult> {
  const payload: Record<string, unknown> = { url: params.url };
  if (params.ref !== undefined && params.ref !== '') payload.ref = params.ref;
  if (params.sha256 !== undefined && params.sha256 !== '') payload.sha256 = params.sha256;
  if (params.trust !== undefined) payload.trust = params.trust;
  if (params.force !== undefined) payload.force = params.force;
  return safeInvoke<SandboxInstallResult>('sandbox_install', payload);
}

/** Return the last `lines` log lines from the plugin's stderr ring buffer. */
export async function sandboxLogs(pluginId: string, lines = 100): Promise<string[]> {
  const result = await safeInvoke<string[]>(
    'sandbox_logs',
    { plugin_id: pluginId, lines },
    { noCache: true },
  );
  return Array.isArray(result) ? result : [];
}

/** Restart the caller's sandbox plugin host. */
export async function sandboxRestart(pluginId: string): Promise<unknown> {
  return safeInvoke('sandbox_restart', { plugin_id: pluginId });
}

/** Uninstall the caller's sandbox plugin (stops host, removes dirs + pin). */
export async function sandboxUninstall(pluginId: string): Promise<unknown> {
  return safeInvoke('sandbox_uninstall', { plugin_id: pluginId });
}

/** Abbreviate a pinned SHA for display (matches the backend's 12-char style). */
export function shortSha(sha: string): string {
  return sha.length > 12 ? `${sha.slice(0, 12)}…` : sha;
}
