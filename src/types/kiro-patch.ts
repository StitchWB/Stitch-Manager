/**
 * Kiro Patch V3 Configuration Types
 * 
 * V3 introduces per-account Machine ID rotation to prevent account bans.
 * Each account gets its own unique Machine ID that persists across sessions.
 */

export interface PatchModules {
  machineIdSpoofing: boolean;
  telemetryBlocking: boolean;
  rateLimitBypass: boolean;
  errorSuppression: boolean;
  osSpoofing: boolean;
  commandSpoofing: boolean;
  authWatcher: boolean;
  constantPatching: boolean;
  customPrompts: boolean;
  requestSpy: boolean;
}

export interface PatchConstants {
  writeLimit: string;
  graphTransitionLimit: number;
  subAgentGraphTransitionLimit: number;
  defaultMaxTokens: number;
  defaultContextLength: number;
  maxSnippetContentLength: number;
}

export interface KiroPatchConfig {
  version: number;
  modules: PatchModules;
  machineId: string;
  accountBindings: Record<string, string>; // accountId -> machineId
  currentAccountId: string | null;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  constants: PatchConstants;
  promptsPath: string | null;
}

export interface AccountBinding {
  accountId: string;
  machineId: string;
  accountName?: string;
}
