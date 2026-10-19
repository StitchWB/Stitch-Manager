import { safeInvoke } from '../core/invoke';

export interface OpenCodeConfig {
  provider?: Record<string, ProviderConfig>;
  model?: string;
  small_model?: string;
  agent?: Record<string, AgentConfig>;
  compaction?: CompactionConfig;
  disabled_providers?: string[];
  plugin?: string[];
  mcp?: Record<string, McpServerConfig>;
  [key: string]: unknown;
}

export interface McpServerConfig {
  enabled?: boolean;
  type?: string;
  command?: string[];
  [key: string]: unknown;
}

export interface ProviderConfig {
  npm?: string;
  name?: string;
  options?: {
    baseURL?: string;
    apiKey?: string;
    timeout?: number;
    headerTimeout?: number;
    [key: string]: unknown;
  };
  models?: Record<string, ModelConfig>;
  [key: string]: unknown;
}

export interface ModelConfig {
  name?: string;
  family?: string;
  limit?: {
    context?: number;
    output?: number;
  };
  temperature?: boolean;
  tool_call?: boolean;
  reasoning?: boolean;
  options?: Record<string, unknown>;
  variants?: Record<string, unknown>;
  attachment?: boolean;
  modalities?: {
    input?: string[];
    output?: string[];
  };
  [key: string]: unknown;
}

export interface AgentConfig {
  model?: string;
  fallback_models?: Array<{ model: string }>;
  [key: string]: unknown;
}

export interface CompactionConfig {
  auto?: boolean;
  tail_turns?: number;
  preserve_recent_tokens?: number;
  reserved?: number;
  [key: string]: unknown;
}

export interface OhMyOpenAgentConfig {
  default_model?: string;
  google_auth?: boolean;
  hooks?: Record<string, unknown>;
  agents?: Record<string, AgentConfig>;
  models?: Record<string, unknown>;
  skip_agents?: {
    delegate?: string[];
    parallel_delegate?: string[];
  };
  [key: string]: unknown;
}

export interface ApiTestResult {
  success: boolean;
  models?: Array<{
    id: string;
    owned_by?: string;
    vision?: boolean;
    reasoning?: boolean;
    tool_call?: boolean;
    status?: 'stable' | 'experimental';
    limit?: { context?: number; output?: number };
    modalities?: { input?: string[]; output?: string[] };
  }>;
  normalized_url?: string;
  error?: string;
}

export interface BulkTestKeyResult {
  key: string;
  status: 'ok' | 'rate_limited' | 'invalid' | 'error';
  models?: string[];
  error?: string;
}

export interface BulkTestResult {
  success: boolean;
  results: BulkTestKeyResult[];
  normalized_url?: string;
  error?: string;
}

/**
 * Validate model configs across all providers.
 * Returns array of error messages — empty array means valid.
 */
export function validateModelConfig(config: OpenCodeConfig): string[] {
  const errors: string[] = [];
  const providers = config.provider || {};
  for (const [providerId, provider] of Object.entries(providers)) {
    const models = provider.models || {};
    for (const [modelId, model] of Object.entries(models)) {
      if (!model.limit?.context || model.limit.context <= 0) {
        errors.push(`Model "${modelId}" in provider "${providerId}" missing required limit.context`);
      }
      if (!model.limit?.output || model.limit.output <= 0) {
        errors.push(`Model "${modelId}" in provider "${providerId}" missing required limit.output`);
      }
    }
  }
  return errors;
}

/**
 * Read opencode.json configuration
 */
export async function getOpenCodeConfig(): Promise<OpenCodeConfig> {
  return safeInvoke<OpenCodeConfig>('get_opencode_config');
}

/**
 * Write opencode.json configuration
 */
export async function setOpenCodeConfig(config: OpenCodeConfig): Promise<void> {
  return safeInvoke<void>('set_opencode_config', { config });
}

/**
 * Read oh-my-openagent.json configuration
 */
export async function getOhMyOpenAgentConfig(): Promise<OhMyOpenAgentConfig> {
  return safeInvoke<OhMyOpenAgentConfig>('get_oh_my_openagent_config');
}

/**
 * Write oh-my-openagent.json configuration
 */
export async function setOhMyOpenAgentConfig(config: OhMyOpenAgentConfig): Promise<void> {
  return safeInvoke<void>('set_oh_my_openagent_config', { config });
}

/**
 * Test API endpoint and discover available models
 */
export async function testOpenCodeApi(baseUrl: string, apiKey: string): Promise<ApiTestResult> {
  return safeInvoke<ApiTestResult>('test_opencode_api', { baseUrl, apiKey });
}

/**
 * Test multiple API keys against the same base URL in parallel
 */
export async function bulkTestOpenCodeApi(
  baseUrl: string,
  apiKeys: string[],
  concurrency: number = 10
): Promise<BulkTestResult> {
  return safeInvoke<BulkTestResult>('bulk_test_opencode_api', {
    baseUrl,
    apiKeys,
    concurrency,
  });
}
