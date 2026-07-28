/**
 * Kiro Patch V3 Configuration Types
 * 
 * V3 introduces per-account Machine ID rotation to prevent account bans.
 * Each account gets its own unique Machine ID that persists across sessions.
 */

export interface PatchModules {
  tokenTypeStripping: boolean; // V4: Strip TokenType header (fixes "Too Many Requests")
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
  proxyInjection: boolean; // Intercept all HTTP/HTTPS via reverse proxy
}

export interface PatchConstants {
  writeLimit: string;
  // V4: Renamed for Kiro V2+ compatibility
  iterationLimit: number;
  agentIterationLimit: number;
  defaultMaxTokens: number;
  defaultContextLength: number;
  // V4: Replaced maxSnippetContentLength with percentage
  maxSnippetPercentage: number;
}

export interface KiroPatchConfig {
  version: number;
  modules: PatchModules;
  machineId: string;
  accountBindings: Record<string, string>; // accountId -> machineId
  currentAccountId: string | null;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  proxyEnabled?: boolean; // Whether reverse proxy is enabled
  proxyPort: number; // Port for reverse proxy server (default: 5580)
  outboundProxy?: string; // Outbound proxy for geo-spoofing (format: host:port:user:pass)
  constants: PatchConstants;
  promptsPath: string | null;
}

export interface AccountBinding {
  accountId: string;
  machineId: string;
  accountName?: string;
}
