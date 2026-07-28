import { safeInvoke } from '../core/invoke';
import type {
  ProxyStatus,
  ProxySettings,
  AiProxyAccount,
  AuthFile,
  KiroAccountQuota,
  ModelInfo,
} from '../../../types/generated';

const isNotFoundError = (error: unknown): boolean => {
  return error instanceof Error && /404\s*Not\s*Found/i.test(error.message);
};

const isIpcUnavailableError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  return (
    /ERR_CONNECTION_REFUSED/i.test(error.message) ||
    /ipc\.localhost/i.test(error.message) ||
    /Failed to fetch/i.test(error.message)
  );
};

const isAiProxyBackendUnavailableError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  return (
    /Failed to list models/i.test(error.message) ||
    /Failed to get usage stats/i.test(error.message) ||
    /Management API returned error/i.test(error.message) ||
    /timed out/i.test(error.message) ||
    /connection refused/i.test(error.message)
  );
};

// Backoff: avoid hammering an unreachable backend for a short period.
let _backoffUntil = 0;
const _inBackoff = (): boolean => Date.now() < _backoffUntil;
const _startBackoff = (): void => { _backoffUntil = Date.now() + 5000; };

export interface ProviderCapability {
  provider: string;
  supportsApiKeys: boolean;
  supportsOauth: boolean;
  totalAccounts: number;
  enabledAccounts: number;
  totalApiKeys: number;
  configured: boolean;
}

export interface ProviderModelMapping {
  modelPattern: string;
  provider: string;
  modelId?: string | null;
}

export interface ProviderConnectionTestResult {
  success: boolean;
  provider: string;
  modelId?: string | null;
  message: string;
}

export interface OpenAiQuotaWindow {
  usedPercent: number;
  resetAt: number | null;
  resetAfterSeconds: number | null;
  totalCount: number | null;
  remainingCount: number | null;
  windowSeconds: number | null;
}

export interface OpenAiAccountQuota {
  accountId: number | null;
  accountName: string;
  accountEmail: string | null;
  planType: string | null;
  primary: OpenAiQuotaWindow;
  secondary: OpenAiQuotaWindow | null;
  fetchedAt: number;
  error: string | null;
}

export interface ProviderAuthFlowStartRequest {
  provider: string;
  runId?: string;
  alias?: string;
  inboxProvider?: string;
}

export interface ProviderAuthFlowStartResponse {
  sessionId: string;
  provider: string;
  authUrl: string;
  state: string;
  callbackUrl: string | null;
  expiresAt: number | null;
  flowType: 'device_code' | 'auth_code' | null;
  userCode: string | null;
  verificationUri: string | null;
}

export interface ProviderAuthFlowStatusRequest {
  sessionId: string;
}

export interface ProviderAuthFlowStatusResponse {
  sessionId: string;
  provider: string;
  phase:
  | 'pending'
  | 'awaiting_user'
  | 'callback_received'
  | 'token_ready'
  | 'failed'
  | 'expired'
  | 'cancelled';
  state: string;
  error: string | null;
  updatedAt: number;
}

export interface ProxyDebugLog {
  id?: number | null;
  method: string;
  path: string;
  requestHeaders?: string | null;
  requestBody?: string | null;
  responseStatus?: number | null;
  responseHeaders?: string | null;
  responseBody?: string | null;
  durationMs?: number | null;
  errorMessage?: string | null;
  createdAt: number;
}

export interface ProviderAuthFlowCancelRequest {
  state: string;
}

export interface ProviderAuthFlowCancelResponse {
  ok: boolean;
}

export interface AuthImportEntry {
  provider: string;
  accountName: string;
  path: string;
  action: string;
  message: string;
}

export interface AuthImportResult {
  dryRun: boolean;
  scanned: number;
  imported: number;
  skipped: number;
  entries: AuthImportEntry[];
}

export type AiProxyAccountsExportFormat = 'json' | 'csv';

/**
 * Start the AI Proxy server
 */
export async function startAiProxy(): Promise<ProxyStatus> {
  return safeInvoke<ProxyStatus>('start_ai_proxy');
}

/**
 * Stop the AI Proxy server
 */
export async function stopAiProxy(): Promise<ProxyStatus> {
  return safeInvoke<ProxyStatus>('stop_ai_proxy');
}

/**
 * Get proxy status
 */
export async function getProxyStatus(): Promise<ProxyStatus> {
  return safeInvoke<ProxyStatus>('get_proxy_status');
}

/**
 * Get proxy settings
 */
export async function getProxySettings(): Promise<ProxySettings> {
  return safeInvoke<ProxySettings>('get_proxy_settings');
}

/**
 * Update proxy settings
 */
export async function updateProxySettings(settings: ProxySettings): Promise<void> {
  return safeInvoke<void>('update_proxy_settings', { settings });
}

/**
 * Get all AI proxy accounts
 */
export async function getAiProxyAccounts(): Promise<AiProxyAccount[]> {
  return safeInvoke<AiProxyAccount[]>('get_ai_proxy_accounts');
}

/**
 * Create AI proxy account
 */
export async function createAiProxyAccount(account: AiProxyAccount): Promise<number> {
  return safeInvoke<number>('create_ai_proxy_account', { account });
}

/**
 * Update AI proxy account
 */
export async function updateAiProxyAccount(account: AiProxyAccount): Promise<void> {
  return safeInvoke<void>('update_ai_proxy_account', { account });
}

/**
 * Delete AI proxy account
 */
export async function deleteAiProxyAccount(id: number): Promise<void> {
  return safeInvoke<void>('delete_ai_proxy_account', { id });
}

/**
 * Contract v1: start provider auth flow with state-bound session.
 */
export async function providerAuthFlowStart(
  request: ProviderAuthFlowStartRequest
): Promise<ProviderAuthFlowStartResponse> {
  return safeInvoke<ProviderAuthFlowStartResponse>('provider_auth_flow_start', { request });
}

/**
 * Contract v1: poll provider auth flow status by session.
 */
export async function providerAuthFlowStatus(
  request: ProviderAuthFlowStatusRequest
): Promise<ProviderAuthFlowStatusResponse> {
  return safeInvoke<ProviderAuthFlowStatusResponse>('provider_auth_flow_status', { request });
}

/**
 * Get available models from AI proxy management API
 */
export async function getAvailableModels(): Promise<ModelInfo[]> {
  try {
    return await safeInvoke('get_available_models');
  } catch (error) {
    if (isNotFoundError(error)) {
      return [];
    }
    throw error;
  }
}

export async function getAvailableModelsSafe(): Promise<ModelInfo[]> {
  if (_inBackoff()) return [];
  try {
    return await getAvailableModels();
  } catch (error) {
    if (
      isIpcUnavailableError(error) ||
      isNotFoundError(error) ||
      isAiProxyBackendUnavailableError(error)
    ) {
      _startBackoff();
      return [];
    }
    throw error;
  }
}

/**
 * Get provider capabilities summary
 */
export async function getProviderCapabilities(): Promise<ProviderCapability[]> {
  return safeInvoke<ProviderCapability[]>('get_provider_capabilities');
}

/**
 * Get enabled model IDs for OpenCode (provider `stitch`).
 */
export async function getEnabledModels(): Promise<string[]> {
  return safeInvoke<string[]>('get_enabled_models');
}

/**
 * Set enabled model IDs for OpenCode (provider `stitch`).
 */
export async function setEnabledModels(models: string[]): Promise<string[]> {
  await safeInvoke<void>('set_enabled_models', { models });
  return getEnabledModels();
}

/**
 * Get provider-model mappings
 */
export async function getProviderModelMappings(): Promise<ProviderModelMapping[]> {
  return safeInvoke<ProviderModelMapping[]>('get_provider_model_mappings');
}

/**
 * Set provider-model mappings
 */
export async function setProviderModelMappings(mappings: ProviderModelMapping[]): Promise<void> {
  return safeInvoke<void>('set_provider_model_mappings', { mappings });
}

/**
 * Test provider connection/configuration
 */
export async function testProviderConnection(
  provider: string,
  modelId?: string
): Promise<ProviderConnectionTestResult> {
  return safeInvoke<ProviderConnectionTestResult>('test_provider_connection', {
    provider,
    model_id: modelId,
  });
}

/**
 * Open URL in default browser
 */
export async function openUrlInBrowser(url: string): Promise<void> {
  return safeInvoke<void>('open_url_in_browser', { url });
}

/**
 * Detect installed IDEs for AI Proxy configuration
 */
export async function detectAiProxyIdes(): Promise<
  Array<{
    name: string;
    displayName: string;
    path: string;
    configPath: string;
    installed: boolean;
    configured: boolean;
  }>
> {
  return safeInvoke('detect_ai_proxy_ides');
}

/**
 * Configure an IDE for a specific provider key (reusable providering module).
 */
export async function configureAiProxyIdeForProvider(
  ideName: string,
  configPath: string,
  providerKey: string
): Promise<void> {
  return safeInvoke<void>('configure_ai_proxy_ide', { ideName, configPath, providerKey });
}

/**
 * Restore IDE configuration from backup
 */
export async function restoreAiProxyIdeConfig(configPath: string): Promise<void> {
  return safeInvoke<void>('restore_ai_proxy_ide_config', { configPath });
}

/**
 * Get IDE config preview for an explicit provider key.
 */
export async function getAiProxyIdeConfigPreviewForProvider(
  ideName: string,
  providerKey: string
): Promise<string> {
  return safeInvoke<string>('get_ai_proxy_ide_config_preview', { ideName, providerKey });
}

/**
 * Get model usage statistics
 */
export async function getModelUsage(): Promise<
  Array<import('../../../types/generated').ModelUsage>
> {
  return safeInvoke('get_model_usage');
}

/**
 * Get request history with pagination
 */
export async function getRequestHistory(
  limit: number,
  offset: number
): Promise<Array<import('../../../types/generated').RequestLog>> {
  type RequestLog = import('../../../types/generated').RequestLog;
  const result = await safeInvoke<RequestLog[] | { items?: RequestLog[] }>(
    'get_request_history',
    { limit, offset }
  );
  if (Array.isArray(result)) return result;
  return Array.isArray(result?.items) ? result.items : [];
}

export async function getRequestHistorySafe(
  limit: number,
  offset: number
): Promise<Array<import('../../../types/generated').RequestLog>> {
  if (_inBackoff()) return [];
  try {
    return await getRequestHistory(limit, offset);
  } catch (error) {
    if (isIpcUnavailableError(error)) {
      _startBackoff();
      return [];
    }
    throw error;
  }
}

/**
 * Clear request history
 */
export async function clearRequestHistory(): Promise<void> {
  return safeInvoke<void>('clear_request_history');
}

/**
 * Get daily statistics
 */
export async function getDailyStats(): Promise<import('../../../types/generated').DailyStats> {
  return safeInvoke('get_daily_stats');
}

export async function getDailyStatsSafe(): Promise<import('../../../types/generated').DailyStats | null> {
  if (_inBackoff()) return null;
  try { return await getDailyStats(); } catch (error) {
    if (isIpcUnavailableError(error)) { _startBackoff(); return null; }
    throw error;
  }
}

/**
 * Get cost estimate
 */
export async function getCostEstimate(): Promise<number> {
  return safeInvoke<number>('get_cost_estimate');
}

export async function getCostEstimateSafe(): Promise<number | null> {
  if (_inBackoff()) return null;
  try { return await getCostEstimate(); } catch (error) {
    if (isIpcUnavailableError(error)) { _startBackoff(); return null; }
    throw error;
  }
}

export async function fetchAllQuotas(): Promise<Array<import('../../../types/generated').AiProxyQuotaInfo>> {
  return safeInvoke('fetch_all_quotas_cmd');
}

export async function fetchAllQuotasSafe(): Promise<Array<import('../../../types/generated').AiProxyQuotaInfo>> {
  if (_inBackoff()) return [];
  try { return await fetchAllQuotas(); } catch (error) {
    if (isIpcUnavailableError(error)) { _startBackoff(); return []; }
    throw error;
  }
}

export async function fetchOpenAiAccountQuotas(): Promise<OpenAiAccountQuota[]> {
  return safeInvoke<OpenAiAccountQuota[]>('fetch_openai_account_quotas_cmd');
}

export async function fetchOpenAiAccountQuotasSafe(): Promise<OpenAiAccountQuota[]> {
  if (_inBackoff()) return [];
  try { return await fetchOpenAiAccountQuotas(); } catch (error) {
    if (isIpcUnavailableError(error)) { _startBackoff(); return []; }
    throw error;
  }
}

export async function fetchKiroAccountQuotas(): Promise<KiroAccountQuota[]> {
  return safeInvoke<KiroAccountQuota[]>('fetch_kiro_account_quotas_cmd');
}

export async function fetchKiroAccountQuotasSafe(): Promise<KiroAccountQuota[]> {
  if (_inBackoff()) return [];
  try { return await fetchKiroAccountQuotas(); } catch (error) {
    if (isIpcUnavailableError(error)) { _startBackoff(); return []; }
    throw error;
  }
}

/**
 * Get weekly statistics for charting
 */
export async function getWeeklyStats(): Promise<
  Array<import('../../../types/generated').DailyStatsPoint>
> {
  return safeInvoke('get_weekly_stats');
}

export async function debugRunAiProxyMigration(): Promise<string> {
  return safeInvoke<string>('debug_run_ai_proxy_migration');
}

/**
 * Scan local auth/token files for supported providers
 */
export async function scanAuthFiles(): Promise<AuthFile[]> {
  return safeInvoke<AuthFile[]>('scan_auth_files');
}

/**
 * Auto-import discovered local auth files into AI Proxy accounts.
 * dryRun=true returns what would be imported without writing DB rows.
 */
export async function autoImportAiProxyAuthFiles(dryRun: boolean): Promise<AuthImportResult> {
  return safeInvoke<AuthImportResult>('auto_import_ai_proxy_auth_files', { dryRun });
}

/**
 * Export AI proxy accounts payload (optionally includes secrets).
 *
 * NOTE: When includeSecrets=true, the returned payload may contain API keys/tokens.
 */
export async function exportAiProxyAccountsPayload(
  format: AiProxyAccountsExportFormat = 'json',
  includeSecrets: boolean = false
): Promise<string> {
  return safeInvoke<string>('export_ai_proxy_accounts_payload', {
    format,
    include_secrets: includeSecrets,
  });
}

export async function importAiProxyAccountsPayload(payload: string): Promise<number> {
  return safeInvoke<number>('import_ai_proxy_accounts_payload', { payload });
}

/**
 * Get proxy debug logs (recent request/response traces)
 */
export async function getProxyDebugLogs(limit: number = 100): Promise<ProxyDebugLog[]> {
  return safeInvoke<ProxyDebugLog[]>('get_proxy_debug_logs', { limit });
}

/**
 * Clear proxy debug logs older than N days
 */
export async function clearProxyDebugLogs(days: number = 7): Promise<number> {
  return safeInvoke<number>('clear_proxy_debug_logs', { days });
}
