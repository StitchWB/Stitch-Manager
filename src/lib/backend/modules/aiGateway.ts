import { safeInvoke } from '../core/invoke';

// ═══════════════════════════════════════════════════════════════════════════
// Types
//
// Response interfaces use camelCase to match the wire format produced by the
// backend's ``model_dump(by_alias=True)`` serialisation. Request param types
// use camelCase aliases too — the backend's ``populate_by_name=True`` accepts
// both, so camelCase (the alias) is the canonical form.
//
// Plain-dict return types (``migrateLegacyData``, ``discoverModelsForEndpoint``,
// ``CredentialProbeResult``) keep snake_case because those commands return
// raw dicts that pass through the dispatcher without alias conversion.
// ═══════════════════════════════════════════════════════════════════════════

export interface ProviderEndpoint {
  id: string;
  name: string;
  adapterType: string;
  baseUrl: string;
  enabled: boolean;
  defaultHeaders?: Record<string, string> | null;
  discoveryPolicy?: Record<string, unknown> | null;
  healthPolicy?: Record<string, unknown> | null;
  circuitState: string;
  circuitOpenedAt?: string | null;
  circuitRetryAt?: string | null;
  createdAt: string;
  updatedAt?: string | null;
}

export interface Credential {
  id: string;
  providerEndpointId: string;
  label?: string | null;
  authType: string;
  fingerprint: string;
  enabled: boolean;
  runtimeStatus: string;
  statusReason?: string | null;
  nextRetryAt?: string | null;
  quotaResetAt?: string | null;
  lastSuccessAt?: string | null;
  lastFailureAt?: string | null;
  consecutiveFailures: number;
  createdAt: string;
  updatedAt?: string | null;
  // ── Wave-2 scope fields (FE renders scope chips from these) ──────────────
  /** Owner user id. null = instance-shared (legacy) row. */
  ownerId?: number | null;
  /** Group ids the credential is shared to (camelCase wire alias). */
  sharedGroupIds?: string[];
  /** Group names matching `sharedGroupIds`, for chip labels. */
  sharedGroupNames?: string[];
}

export interface UpstreamModel {
  id: string;
  providerEndpointId: string;
  upstreamModelId: string;
  displayName?: string | null;
  enabled: boolean;
  discoverySource: string;
  lastDiscoveredAt?: string | null;
  capabilities?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt?: string | null;
}

export interface CredentialModelAccess {
  id: number;
  credentialId: string;
  upstreamModelId: string;
  status: string;
  lastVerifiedAt?: string | null;
  lastError?: string | null;
  createdAt: string;
  updatedAt?: string | null;
}

export interface PublicModel {
  id: string;
  displayName?: string | null;
  enabled: boolean;
  contract?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt?: string | null;
}

export interface RouteTarget {
  id: number;
  publicModelId: string;
  upstreamModelId: string;
  enabled: boolean;
  priority: number;
  weight: number;
  costModifier: number;
  createdAt: string;
  updatedAt?: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════
// ProviderEndpoint API
// ═══════════════════════════════════════════════════════════════════════════

export async function createProviderEndpoint(params: {
  name: string;
  adapterType: string;
  baseUrl: string;
  enabled?: boolean;
  defaultHeaders?: Record<string, string> | null;
  discoveryPolicy?: Record<string, unknown> | null;
  healthPolicy?: Record<string, unknown> | null;
}): Promise<ProviderEndpoint> {
  return safeInvoke('create_provider_endpoint', params);
}

export async function listProviderEndpoints(): Promise<ProviderEndpoint[]> {
  return safeInvoke('list_provider_endpoints', {});
}

export async function getProviderEndpoint(id: string): Promise<ProviderEndpoint | null> {
  return safeInvoke('get_provider_endpoint', { id });
}

export async function updateProviderEndpoint(params: {
  id: string;
  name?: string;
  adapterType?: string;
  baseUrl?: string;
  enabled?: boolean;
  defaultHeaders?: Record<string, string> | null;
  discoveryPolicy?: Record<string, unknown> | null;
  healthPolicy?: Record<string, unknown> | null;
}): Promise<ProviderEndpoint | null> {
  return safeInvoke('update_provider_endpoint', params);
}

export async function deleteProviderEndpoint(id: string): Promise<{ success: boolean }> {
  return safeInvoke('delete_provider_endpoint', { id });
}

// ═══════════════════════════════════════════════════════════════════════════
// Credential API
// ═══════════════════════════════════════════════════════════════════════════

export async function createCredential(params: {
  providerEndpointId: string;
  label?: string | null;
  authType: string;
  secret: string;
}): Promise<Credential> {
  return safeInvoke('create_credential', params);
}

export async function listCredentials(
  providerEndpointId?: string
): Promise<Credential[]> {
  return safeInvoke('list_credentials', { providerEndpointId });
}

export async function getCredential(id: string): Promise<Credential | null> {
  return safeInvoke('get_credential', { id });
}

export async function updateCredential(params: {
  id: string;
  label?: string | null;
  enabled?: boolean;
}): Promise<Credential | null> {
  return safeInvoke('update_credential', params);
}

export async function deleteCredential(id: string): Promise<{ success: boolean }> {
  return safeInvoke('delete_credential', { id });
}

export async function rotateCredentialSecret(params: {
  id: string;
  newSecret: string;
}): Promise<Credential | null> {
  return safeInvoke('rotate_credential_secret', params);
}

// ═══════════════════════════════════════════════════════════════════════════
// UpstreamModel API
// ═══════════════════════════════════════════════════════════════════════════

export async function createUpstreamModel(params: {
  providerEndpointId: string;
  upstreamModelId: string;
  displayName?: string | null;
  enabled?: boolean;
  discoverySource?: string;
  capabilities?: Record<string, unknown> | null;
}): Promise<UpstreamModel> {
  return safeInvoke('create_upstream_model', params);
}

export async function listUpstreamModels(
  providerEndpointId?: string
): Promise<UpstreamModel[]> {
  return safeInvoke('list_upstream_models', { providerEndpointId });
}

export async function getUpstreamModel(id: string): Promise<UpstreamModel | null> {
  return safeInvoke('get_upstream_model', { id });
}

export async function updateUpstreamModel(params: {
  id: string;
  displayName?: string | null;
  enabled?: boolean;
  capabilities?: Record<string, unknown> | null;
}): Promise<UpstreamModel | null> {
  return safeInvoke('update_upstream_model', params);
}

export async function deleteUpstreamModel(id: string): Promise<{ success: boolean }> {
  return safeInvoke('delete_upstream_model', { id });
}

// ═══════════════════════════════════════════════════════════════════════════
// CredentialModelAccess API
// ═══════════════════════════════════════════════════════════════════════════

export async function upsertCredentialModelAccess(params: {
  credentialId: string;
  upstreamModelId: string;
  status?: string;
  lastError?: string | null;
}): Promise<CredentialModelAccess> {
  return safeInvoke('upsert_credential_model_access', params);
}

export async function listCredentialModelAccess(params?: {
  credentialId?: string;
  upstreamModelId?: string;
}): Promise<CredentialModelAccess[]> {
  return safeInvoke('list_credential_model_access', params || {});
}

export async function deleteCredentialModelAccess(id: number): Promise<{ success: boolean }> {
  return safeInvoke('delete_credential_model_access', { id });
}

// ═══════════════════════════════════════════════════════════════════════════
// PublicModel API
// ═══════════════════════════════════════════════════════════════════════════

export async function createPublicModel(params: {
  id: string;
  displayName?: string | null;
  enabled?: boolean;
  contract?: Record<string, unknown> | null;
}): Promise<PublicModel> {
  return safeInvoke('create_public_model', params);
}

export async function listPublicModels(): Promise<PublicModel[]> {
  return safeInvoke('list_public_models', {});
}

export async function getPublicModel(id: string): Promise<PublicModel | null> {
  return safeInvoke('get_public_model', { id });
}

export async function updatePublicModel(params: {
  id: string;
  displayName?: string | null;
  enabled?: boolean;
  contract?: Record<string, unknown> | null;
}): Promise<PublicModel | null> {
  return safeInvoke('update_public_model', params);
}

export async function deletePublicModel(id: string): Promise<{ success: boolean }> {
  return safeInvoke('delete_public_model', { id });
}

// ═══════════════════════════════════════════════════════════════════════════
// RouteTarget API
// ═══════════════════════════════════════════════════════════════════════════

export async function createRouteTarget(params: {
  publicModelId: string;
  upstreamModelId: string;
  enabled?: boolean;
  priority?: number;
  weight?: number;
  costModifier?: number;
}): Promise<RouteTarget> {
  return safeInvoke('create_route_target', params);
}

export async function listRouteTargetsForPublicModel(
  publicModelId: string
): Promise<RouteTarget[]> {
  return safeInvoke('list_route_targets_for_public_model', { publicModelId });
}

export async function getRouteTarget(id: number): Promise<RouteTarget | null> {
  return safeInvoke('get_route_target', { id });
}

export async function updateRouteTarget(params: {
  id: number;
  enabled?: boolean;
  priority?: number;
  weight?: number;
  costModifier?: number;
}): Promise<RouteTarget | null> {
  return safeInvoke('update_route_target', params);
}

export async function deleteRouteTarget(id: number): Promise<{ success: boolean }> {
  return safeInvoke('delete_route_target', { id });
}

// ═══════════════════════════════════════════════════════════════════════════
// Migration API
// Returns a plain dict (no Pydantic alias conversion) — snake_case keys are
// the wire format.
// ═══════════════════════════════════════════════════════════════════════════

export async function migrateLegacyData(): Promise<{
  endpoints_created: number;
  credentials_created: number;
}> {
  return safeInvoke('migrate_ai_gateway_legacy_data', {});
}

// ═══════════════════════════════════════════════════════════════════════════
// On-demand Discovery & Probe API
// Both return plain dicts (no Pydantic alias conversion) — snake_case keys
// are the wire format.
// ═══════════════════════════════════════════════════════════════════════════

export async function discoverModelsForEndpoint(
  id: string
): Promise<{ models_count: number }> {
  return safeInvoke('discover_models_for_endpoint', { id });
}

export interface CredentialProbeResult {
  success: boolean;
  latency_ms?: number;
  http_status?: number | null;
  error?: string | null;
}

export async function testCredentialConnection(
  id: string
): Promise<CredentialProbeResult> {
  return safeInvoke('test_credential_connection', { id });
}

// ═══════════════════════════════════════════════════════════════════════════
// User proxy keys (per-user auth tokens for /v1/*)
//
// Wire shapes (camelCase aliases, verified against
// ``ProxyKeyResponse`` / ``ProxyKeyListResponse`` / ``ProxyKeyCreatedResponse``
// in ``domains/ai_gateway/schemas.py``):
//   proxy_keys_list   → { baseUrl, keys: ProxyKey[], pool: ProxyKeyPool }
//   proxy_keys_create → { key: string (RAW, shown once), id: string }
//   proxy_keys_revoke → { success: true }
// ═══════════════════════════════════════════════════════════════════════════

export interface ProxyKey {
  id: string;
  label: string | null;
  maskedKey: string;
  enabled: boolean;
  createdAt: string;
  lastUsedAt: string | null;
  isDefault: boolean;
}

export interface ProxyKeyPoolGroup {
  id: string;
  name: string;
  keys: number;
}

export interface ProxyKeyPool {
  personal: number;
  legacy: number;
  groups: ProxyKeyPoolGroup[];
}

export interface ProxyKeyListResponse {
  baseUrl: string;
  keys: ProxyKey[];
  pool: ProxyKeyPool;
}

export interface ProxyKeyCreatedResponse {
  /** Raw key — shown ONCE at creation, never persisted or returned again. */
  key: string;
  id: string;
}

export async function proxyKeysList(): Promise<ProxyKeyListResponse> {
  return safeInvoke('proxy_keys_list', {}, { noCache: true });
}

export async function proxyKeysCreate(params: {
  label?: string | null;
}): Promise<ProxyKeyCreatedResponse> {
  return safeInvoke('proxy_keys_create', params, { noCache: true });
}

export async function proxyKeysRevoke(id: string): Promise<{ success: boolean }> {
  return safeInvoke('proxy_keys_revoke', { id }, { noCache: true });
}
