import { safeInvoke } from '../core';

export interface PythonJobStartRequest {
  scriptPath: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  timeoutMs?: number;
  correlationId?: string;
  pythonBinary?: string;
}

export interface PythonJobStartResponse {
  jobId: string;
}

export type PythonJobState =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'timedout';

export interface PythonJobStatus {
  jobId: string;
  state: PythonJobState;
  startedAt: string;
  finishedAt: string | null;
  exitCode: number | null;
  error: string | null;
  correlationId: string | null;
  resultPayload: unknown | null;
}

export interface PythonJobControlRequest {
  commandFilePath: string;
  command: 'resume' | 'continue' | 'abort' | 'cancel' | 'stop';
  payload?: unknown;
}

export interface ReplayPreflightIssue {
  index: number;
  reason: string;
}

export interface ReplayPreflightResult {
  valid: boolean;
  totalSteps: number;
  droppedSteps: number;
  issues: ReplayPreflightIssue[];
  healthScore: number;
  healthNotes: string[];
}

export interface ScenarioMetadata {
  description?: string | null;
  tags: string[];
  lastStatus?: string | null;
  lastDurationMs?: number | null;
  lastRunAt?: number | null;
}

export interface ScenarioRecordUpsertRequest {
  alias: string;
  name: string;
  scenarioPath: string;
  runId?: string | null;
  startedUrl?: string | null;
  stepsCount?: number;
  createdAt?: string | null;
  metadata?: ScenarioMetadata | null;
}

export interface ScenarioRecordUpdateRequest {
  scenarioId: string;
  name?: string | null;
  scenarioPath?: string | null;
  startedUrl?: string | null;
  stepsCount?: number | null;
  metadata?: ScenarioMetadata | null;
  revisionReason?: string | null;
}

export interface ScenarioDuplicateRequest {
  scenarioId: string;
  newName?: string | null;
}

export interface ScenarioRollbackRequest {
  scenarioId: string;
  versionNo: number;
}

export interface ScenarioRevisionItem {
  id: number;
  scenarioId: string;
  versionNo: number;
  reason?: string | null;
  snapshotJson: string;
  createdAt: string;
}

export interface ScenarioRunAppendRequest {
  alias: string;
  scenarioPath: string;
  startedUrl?: string | null;
  status: string;
  dryRun?: boolean;
  startedAt: number;
  finishedAt?: number | null;
  durationMs?: number | null;
  error?: string | null;
  reportPath?: string | null;
  tracePath?: string | null;
  artifactsDir?: string | null;
}

export interface ScenarioRunItem {
  id: number;
  scenarioId?: string | null;
  alias: string;
  scenarioPath: string;
  startedUrl?: string | null;
  status: string;
  dryRun: boolean;
  startedAt: number;
  finishedAt?: number | null;
  durationMs?: number | null;
  error?: string | null;
  reportPath?: string | null;
  tracePath?: string | null;
  artifactsDir?: string | null;
}

export interface ScenarioRecordItem {
  id: string;
  alias: string;
  name: string;
  scenarioPath: string;
  runId?: string | null;
  startedUrl?: string | null;
  stepsCount: number;
  createdAt: string;
  updatedAt: string;
  lastPlayedAt?: string | null;
  playCount: number;
  favorite: boolean;
  healthScore?: number | null;
  missing: boolean;
  metadata?: ScenarioMetadata | null;
  activeVersion?: number;
  min_role?: string;
  locked?: boolean;
}

export interface ScenarioReindexResult {
  scannedFiles: number;
  indexed: number;
  skipped: number;
  roots: string[];
}

export interface ComposedFlowItem {
  id: string;
  alias: string;
  name: string;
  flowJson: string;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: number | null;
  runCount: number;
}

export interface ComposedFlowUpsertRequest {
  id?: string | null;
  alias: string;
  name: string;
  flowJson: string;
}

export interface ComposedFlowRunRequest {
  alias: string;
  planJson: string;
  correlationId?: string | null;
  timeoutMs?: number;
  headless?: boolean;
  persistAccounts?: boolean;
}

export async function startPythonJob(
  request: PythonJobStartRequest
): Promise<PythonJobStartResponse> {
  return safeInvoke<PythonJobStartResponse>('start_python_job', { request });
}

export async function cancelPythonJob(jobId: string): Promise<boolean> {
  return safeInvoke<boolean>('cancel_python_job', { jobId });
}

export async function getPythonJobStatus(jobId: string): Promise<PythonJobStatus | null> {
  return safeInvoke<PythonJobStatus | null>('get_python_job_status', { jobId });
}

export async function sendPythonJobControl(request: PythonJobControlRequest): Promise<boolean> {
  return safeInvoke<boolean>('send_python_job_control', { request });
}

export async function replayPreflight(scenarioPath: string): Promise<ReplayPreflightResult> {
  return safeInvoke<ReplayPreflightResult>('replay_preflight', { scenarioPath });
}

export async function upsertRecordedScenario(request: ScenarioRecordUpsertRequest): Promise<void> {
  return safeInvoke<void>('upsert_recorded_scenario', { request });
}

export async function updateRecordedScenario(
  request: ScenarioRecordUpdateRequest
): Promise<ScenarioRecordItem> {
  return safeInvoke<ScenarioRecordItem>('update_recorded_scenario', { request });
}

export async function duplicateRecordedScenario(
  request: ScenarioDuplicateRequest
): Promise<ScenarioRecordItem> {
  return safeInvoke<ScenarioRecordItem>('duplicate_recorded_scenario', { request });
}

export async function deleteRecordedScenario(scenarioId: string): Promise<void> {
  return safeInvoke<void>('delete_recorded_scenario', { scenarioId });
}

export async function listScenarioRevisions(params: {
  scenarioId: string;
  limit?: number;
}): Promise<ScenarioRevisionItem[]> {
  return safeInvoke<ScenarioRevisionItem[]>('list_scenario_revisions', {
    scenarioId: params.scenarioId,
    limit: params.limit,
  });
}

export async function rollbackRecordedScenario(
  request: ScenarioRollbackRequest
): Promise<ScenarioRecordItem> {
  return safeInvoke<ScenarioRecordItem>('rollback_recorded_scenario', { request });
}

export async function appendScenarioRun(request: ScenarioRunAppendRequest): Promise<number> {
  return safeInvoke<number>('append_scenario_run', { request });
}

export async function listScenarioRuns(params: {
  alias: string;
  limit?: number;
}): Promise<ScenarioRunItem[]> {
  return safeInvoke<ScenarioRunItem[]>('list_scenario_runs', {
    alias: params.alias,
    limit: params.limit ?? 80,
  });
}

export async function listRecordedScenarios(params: {
  alias: string;
  limit?: number;
}): Promise<ScenarioRecordItem[]> {
  return safeInvoke<ScenarioRecordItem[]>('list_recorded_scenarios', {
    alias: params.alias,
    limit: params.limit ?? 50,
  });
}

export async function setRecordedScenarioFavorite(params: {
  scenarioId: string;
  favorite: boolean;
}): Promise<void> {
  return safeInvoke<void>('set_recorded_scenario_favorite', {
    scenarioId: params.scenarioId,
    favorite: params.favorite,
  });
}

export async function setRecordedScenarioTier(scenarioId: string, minRole: string): Promise<void> {
  return safeInvoke<void>('set_recorded_scenario_tier', {
    scenarioId,
    min_role: minRole,
  });
}

export async function markRecordedScenarioPlayed(params: { scenarioPath: string }): Promise<void> {
  return safeInvoke<void>('mark_recorded_scenario_played', {
    scenarioPath: params.scenarioPath,
  });
}

export async function reindexRecordedScenarios(params: {
  alias?: string | null;
}): Promise<ScenarioReindexResult> {
  return safeInvoke<ScenarioReindexResult>('reindex_recorded_scenarios', {
    alias: params.alias ?? null,
  });
}

export async function upsertComposedFlow(
  request: ComposedFlowUpsertRequest
): Promise<ComposedFlowItem> {
  return safeInvoke<ComposedFlowItem>('upsert_composed_flow', { request });
}

export async function listComposedFlows(params: {
  alias: string;
  limit?: number;
}): Promise<ComposedFlowItem[]> {
  return safeInvoke<ComposedFlowItem[]>('list_composed_flows', {
    alias: params.alias,
    limit: params.limit ?? 50,
  });
}

export async function deleteComposedFlow(flowId: string): Promise<void> {
  return safeInvoke<void>('delete_composed_flow', { flowId });
}

export async function markComposedFlowRan(flowId: string): Promise<void> {
  return safeInvoke<void>('mark_composed_flow_ran', { flowId });
}

export async function startComposedFlowJob(
  request: ComposedFlowRunRequest
): Promise<PythonJobStartResponse> {
  return safeInvoke<PythonJobStartResponse>('start_composed_flow_job', { request });
}
