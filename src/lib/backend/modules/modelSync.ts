import { safeInvoke } from '../core/invoke';

/**
 * Typed bindings for the Model Sync backend commands.
 *
 * The field names intentionally mirror python/stitch_backend/domains/ai_proxy/
 * model_sync/service.py — command params are camelCase and responses are the
 * exact dictionaries returned by the backend (no client-side renaming).
 */

export type ModelSyncTarget = 'opencode' | 'omp';
export type ModelSyncSchemaOverride = 'auto' | 'v1' | 'v2';
export type OpenCodeSchemaVersion = 'v1' | 'v2' | 'unknown';

/** Exact omp role vocabulary accepted by update_config_yaml(). */
export const OMP_ROLES = [
  'default',
  'smol',
  'slow',
  'plan',
  'commit',
  'vision',
  'task',
  'advisor',
  'tiny',
] as const;

/** Exact omp reasoning-effort vocabulary accepted by validate_effort(). */
export const OMP_EFFORTS = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;

export type ModelSyncOmpRole = (typeof OMP_ROLES)[number];

export interface ModelSyncCatalogModel {
  id: string;
  name: string;
  contextTokens: number;
  outputTokens: number;
  inputModalities: string[];
  outputModalities: string[];
  tools: boolean;
  reasoning: boolean | null;
}

export interface ModelSyncCatalogResponse {
  ok: boolean;
  models?: ModelSyncCatalogModel[];
  count?: number;
  error?: string;
}

export interface OpenCodeDetectedVersion {
  version: OpenCodeSchemaVersion;
  source: string;
  raw: string | null;
}

export type OpenCodeCredentialStatus =
  | 'credential-match'
  | 'credential-mismatch'
  | 'no-credential'
  | 'no-database'
  | 'unknown';

export interface OpenCodeCredentialState {
  status: OpenCodeCredentialStatus;
  detail: string;
}

export interface ModelSyncOpenCodeStatus {
  detectedVersion: OpenCodeDetectedVersion;
  writeTarget: string;
  writeTargetExists: boolean;
  secondaryPath: string | null;
  configJsonPresent: boolean;
  warnings: string[];
  stitchModels: string[];
  sha256?: string;
  credential: OpenCodeCredentialState;
  /** Current top-level "model" selector, when the config has one. */
  defaultModel?: string;
  /** Current top-level "small_model" selector, when the config has one. */
  smallModel?: string;
}

export interface ModelSyncOmpProfile {
  name: string;
  agentDir: string;
  exists: boolean;
  modelsPath: string;
  configPath: string;
  isDefault: boolean;
  stitchModels: string[];
  parseError?: string;
}

export interface ModelSyncStatusResponse {
  ok: boolean;
  gatewayRunning?: boolean;
  baseUrl?: string;
  opencode?: ModelSyncOpenCodeStatus;
  omp?: {
    profiles: ModelSyncOmpProfile[];
    profileHint: string | null;
    /** Detected omp binary path — null when no binary was found. */
    binaryPath?: string | null;
    /** Detected omp version — null when unknown (probe failure tolerated). */
    version?: string | null;
  };
  error?: string;
}

export type ModelSyncOmpEffort =
  | 'off'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max';

export interface ModelSyncRoleUpdate {
  role: string;
  model: string;
  effort?: ModelSyncOmpEffort;
}

/**
 * Exact top-level params consumed by build_plan() in model_sync/service.py.
 * Unknown fields are deliberately not represented here.
 */
export interface ModelSyncPlanParams {
  targets?: ModelSyncTarget[];
  models?: string[];
  schema?: ModelSyncSchemaOverride;
  opencodeConfigPath?: string;
  opencodeConfigDir?: string;
  defaultModel?: string;
  /** v1-only top-level small_model selector ("stitch/<id>"). Ignored for v2. */
  smallModel?: string;
  ompProfile?: string;
  pruneUnselected?: boolean;
  roles?: ModelSyncRoleUpdate[];
  ensureEnabled?: boolean;
  ompModelsPath?: string;
  ompConfigPath?: string;
}

export interface ModelDiffSummary {
  added: string[];
  removed: string[];
  updated: string[];
  unchanged: string[];
}

export interface ModelSyncPreviewFile {
  path: string;
  kind: 'omp-models' | 'omp-config' | 'opencode-secondary' | 'opencode-primary' | string;
  target: ModelSyncTarget;
  exists: boolean;
  sha256: string | null;
  changed: boolean;
  /** Unified diff. The backend redacts the gateway token as ********. */
  diff: string;
}

export interface ModelSyncPreviewResponse {
  ok: boolean;
  errors?: string[];
  warnings?: string[];
  schema?: 'v1' | 'v2' | null;
  detectedVersion?: OpenCodeDetectedVersion | null;
  modelDiffs?: Partial<Record<ModelSyncTarget, ModelDiffSummary>>;
  unknownModelIds?: string[];
  files?: ModelSyncPreviewFile[];
  expectedSha256?: Record<string, string | null>;
  error?: string;
}

export interface ModelSyncApplyParams extends ModelSyncPlanParams {
  expectedSha256: Record<string, string | null>;
}

export interface ModelSyncApplyFileResult {
  path: string;
  kind: string;
  written: boolean;
  backupPath: string | null;
  rolledBack: boolean;
  unchanged?: boolean;
  skipped?: boolean;
  error?: string;
  rollbackError?: string;
}

export interface ModelSyncShaMismatch {
  path: string;
  error: string;
  expected: string | null;
  actual: string | null;
}

export interface ModelSyncApplyResponse {
  ok: boolean;
  error?: string;
  status?: number;
  mismatches?: ModelSyncShaMismatch[];
  errors?: string[];
  files?: ModelSyncApplyFileResult[];
  warnings?: string[];
  schema?: 'v1' | 'v2' | null;
  modelDiffs?: Partial<Record<ModelSyncTarget, ModelDiffSummary>>;
}

export interface ModelSyncRestoreEntry {
  path: string;
  backupPath: string;
  expectedSha256?: string | null;
}

export interface ModelSyncRestoreParams {
  entries?: ModelSyncRestoreEntry[];
  path?: string;
  backupPath?: string;
  expectedSha256?: string | null;
}

export interface ModelSyncRestoreFileResult {
  ok: boolean;
  path: string;
  restoredFrom?: string;
  safetyBackupPath?: string | null;
  error?: string;
}

export interface ModelSyncRestoreResponse {
  ok: boolean;
  files?: ModelSyncRestoreFileResult[];
  error?: string;
}

function planArgs(params: ModelSyncPlanParams): Record<string, unknown> {
  // Pass the plan object through unchanged: the backend consumes these exact
  // top-level keys and ignores absent optional values.
  return { ...params } as Record<string, unknown>;
}

export async function modelSyncCatalog(): Promise<ModelSyncCatalogResponse> {
  return safeInvoke<ModelSyncCatalogResponse>('model_sync_catalog', {}, { noCache: true });
}

export async function modelSyncStatus(
  params: Pick<ModelSyncPlanParams, 'opencodeConfigPath' | 'opencodeConfigDir'> = {},
): Promise<ModelSyncStatusResponse> {
  return safeInvoke<ModelSyncStatusResponse>('model_sync_status', { ...params }, { noCache: true });
}

export async function modelSyncPreview(
  params: ModelSyncPlanParams,
): Promise<ModelSyncPreviewResponse> {
  return safeInvoke<ModelSyncPreviewResponse>('model_sync_preview', planArgs(params), {
    noCache: true,
  });
}

export async function modelSyncApply(
  params: ModelSyncApplyParams,
): Promise<ModelSyncApplyResponse> {
  return safeInvoke<ModelSyncApplyResponse>('model_sync_apply', planArgs(params), {
    noCache: true,
  });
}

export async function modelSyncRestore(
  params: ModelSyncRestoreParams,
): Promise<ModelSyncRestoreResponse> {
  return safeInvoke<ModelSyncRestoreResponse>(
    'model_sync_restore',
    { ...params } as Record<string, unknown>,
    { noCache: true },
  );
}
