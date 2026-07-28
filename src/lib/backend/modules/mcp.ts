import type {
  ComposedFlowItem,
  ComposedFlowRunRequest,
  ComposedFlowUpsertRequest,
  PythonJobStartResponse,
  PythonJobStatus,
  ScenarioRecordItem,
} from './pythonJobs';

export interface McpToolPayload {
  [key: string]: unknown;
}

export interface McpToolRequest<TPayload extends McpToolPayload = McpToolPayload> {
  alias: string;
  payload: TPayload;
}

export type McpScenarioSummary = ScenarioRecordItem;
export type McpFlowSummary = ComposedFlowItem;
export type McpFlowUpsertRequest = ComposedFlowUpsertRequest;
export type McpFlowRunRequest = ComposedFlowRunRequest;
export type McpFlowRunResponse = PythonJobStartResponse;
export type McpJobStatus = PythonJobStatus;
export type McpJobState = PythonJobStatus['state'];

export interface McpScenarioListRequest {
  alias: string;
  limit?: number;
}

export interface McpScenarioReadRequest {
  scenarioPath: string;
}

export interface McpScenarioWriteRequest {
  scenarioPath: string;
  scenarioJson: Record<string, unknown>;
}

export interface McpFlowListRequest {
  alias: string;
  limit?: number;
}

export interface McpJobStatusRequest {
  jobId: string;
}

export interface McpJobCancelRequest {
  jobId: string;
}

export interface McpJobWaitRequest {
  jobId: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export interface McpAliasSummary {
  alias: string;
  scenarioCount: number;
  flowCount: number;
}

export interface McpServerInfo {
  name: string;
  version: string;
  autonomyEnabled: boolean;
  dryRun: boolean;
  allowAccountPersist: boolean;
  killSwitchPath: string;
  criticalJournalPath: string;
  scenarioRoots: string[];
}
